import { useCallback, useEffect, useState } from "preact/hooks";
import * as api from "./api.ts";
import { ApiError, CODE_ALPHABET, CODE_LENGTH } from "./api.ts";
import { Home } from "./Home.tsx";
import { Waiting } from "./Waiting.tsx";
import { Room } from "./Room.tsx";
import { connect } from "./transport.ts";
import { forget, remember, tokenFor } from "./store.ts";

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

type View =
  | { k: "home"; error?: string }
  | { k: "opening" }
  | { k: "waiting"; code: string; pendingId: string; fingerprint: string; rejected: boolean }
  | { k: "room"; token: string };

const codeFromPath = (): string | null => {
  const candidate = location.pathname.slice(1).toLowerCase();
  return CODE_RE.test(candidate) ? candidate : null;
};

export function App() {
  const [view, setView] = useState<View>({ k: "opening" });

  const goHome = useCallback((error?: string) => {
    history.pushState(null, "", "/");
    setView({ k: "home", error });
  }, []);

  const openRoom = useCallback((code: string, token: string, role: "owner" | "member") => {
    remember({ code, token, role, savedAt: Date.now() });
    history.replaceState(null, "", `/${code}`);
    setView({ k: "room", token });
  }, []);

  const enter = useCallback(
    async (rawCode: string) => {
      const code = rawCode.toLowerCase();
      if (!CODE_RE.test(code)) return setView({ k: "home", error: "Ese código no es válido." });

      setView({ k: "opening" });

      // A saved token skips the waiting room: reopening the tab recovers
      // access without bothering the owner again.
      const saved = tokenFor(code);
      if (saved) {
        try {
          const snap = await api.getState(saved);
          return openRoom(snap.code, saved, snap.role);
        } catch {
          forget(saved);
        }
      }

      try {
        const result = await api.joinRoom(code);
        if (result.status === "approved") return openRoom(code, result.token, "member");
        history.pushState(null, "", `/${code}`);
        setView({
          k: "waiting",
          code,
          pendingId: result.pendingId,
          fingerprint: result.fingerprint,
          rejected: false,
        });
      } catch (error) {
        setView({
          k: "home",
          error: error instanceof ApiError ? error.message : "No se pudo contactar con el servidor.",
        });
      }
    },
    [openRoom],
  );

  useEffect(() => {
    const route = () => {
      const code = codeFromPath();
      if (code) void enter(code);
      else setView({ k: "home" });
    };
    route();
    addEventListener("popstate", route);
    return () => removeEventListener("popstate", route);
  }, [enter]);

  // Waiting room channel: only reaches the visitor themselves.
  useEffect(() => {
    if (view.k !== "waiting") return;
    const { code, pendingId } = view;

    return connect({
      pending: pendingId,
      onStatus: () => {},
      onResync: () => {},
      onEvent: (event) => {
        if (event.type === "approved") openRoom(String(event.code ?? code), String(event.token), "member");
        else if (event.type === "rejected") setView({ ...view, rejected: true });
        else if (event.type === "closed") goHome("Esa sala ya no existe.");
      },
    });
  }, [view.k, view.k === "waiting" ? view.pendingId : null]);

  switch (view.k) {
    case "opening":
      return (
        <div class="center-note">
          <span class="wordmark">cloudnt</span>
          <p style="color: var(--ink-muted)">Un momento...</p>
        </div>
      );

    case "waiting":
      return (
        <Waiting
          code={view.code}
          fingerprint={view.fingerprint}
          rejected={view.rejected}
          onBack={() => goHome()}
        />
      );

    case "room":
      return (
        <Room
          token={view.token}
          onCode={(code) => history.replaceState(null, "", `/${code}`)}
          onExit={(reason) => {
            forget(view.token);
            goHome(reason);
          }}
        />
      );

    case "home":
      return (
        <Home
          error={view.error}
          onEnter={(code) => void enter(code)}
          onCreate={async () => {
            try {
              const { code, token } = await api.createRoom();
              openRoom(code, token, "owner");
            } catch (error) {
              setView({
                k: "home",
                error: error instanceof ApiError ? error.message : "No se pudo crear la sala.",
              });
            }
          }}
        />
      );
  }
}
