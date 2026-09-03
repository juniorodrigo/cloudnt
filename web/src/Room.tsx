import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import * as api from "./api.ts";
import {
  ApiError,
  type FileItem,
  type HistoryItem,
  type Member,
  type PendingRequest,
  type Snapshot,
  type Usage,
} from "./api.ts";
import { connect, type ConnectionStatus, type ServerEvent } from "./transport.ts";
import { clearsOnPin, renameCode, saveClearsOnPin, saveStackWidth, savedStackWidth } from "./store.ts";
import { sendFile } from "./uploads.ts";
import { Logo } from "./Logo.tsx";
import { Icon } from "./icons.tsx";
import { Menu, Modal } from "./ui.tsx";
import { imageTag, isEmpty, sanitize, serialize, toPlain } from "./rich.ts";
import { currentLang, setLang, strings, useT } from "./i18n.ts";
import {
  copyText,
  downloadText,
  formatAge,
  formatBytes,
  formatPercent,
  formatRemaining,
  formatSize,
} from "./format.ts";

/**
 * Downloads answer application/octet-stream on purpose, and an <img> refuses to
 * render that, so an embedded image is re-typed from its name. Only formats a
 * browser paints are here: anything else stays a plain room file.
 */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

const imageType = (name: string) => IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];

/** The extension has to hold up on the other member's screen too, not just here. */
const isImage = (file: File) => file.type.startsWith("image/") && imageType(file.name) !== undefined;

/** Everything the sanitizer lets through and a keyboard cannot already reach. */
const FORMATS = [
  { command: "bold", key: "bold", label: "B" },
  { command: "italic", key: "italic", label: "I" },
  { command: "strikeThrough", key: "strike", label: "S" },
  { command: "insertUnorderedList", key: "bullets", label: "•" },
  { command: "insertOrderedList", key: "numbers", label: "1." },
] as const;

type State = {
  ready: boolean;
  code: string;
  role: "owner" | "member";
  memberId: string;
  serverText: string;
  serverRev: number;
  draft: string;
  conflict: { text: string; rev: number } | null;
  members: Member[];
  pending: PendingRequest[];
  history: HistoryItem[];
  files: FileItem[];
  usage: Usage;
  expiresAt: number;
  autoApproveUntil: number;
  status: ConnectionStatus;
  renewedAt: number;
};

type Action =
  | { type: "snapshot"; snap: Snapshot }
  | { type: "draft"; text: string }
  | { type: "commit"; text: string; rev: number }
  | { type: "conflict"; text: string; rev: number }
  | { type: "takeTheirs" }
  | { type: "dropConflict" }
  | { type: "status"; status: ConnectionStatus }
  | { type: "event"; event: ServerEvent };

const initial: State = {
  ready: false,
  code: "",
  role: "member",
  memberId: "",
  serverText: "",
  serverRev: 0,
  draft: "",
  conflict: null,
  members: [],
  pending: [],
  history: [],
  files: [],
  usage: { used: 0, limit: 0 },
  expiresAt: 0,
  autoApproveUntil: 0,
  status: "connecting",
  renewedAt: 0,
};

const isDirty = (s: State) => s.draft !== s.serverText;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "snapshot": {
      const { snap } = action;
      const base: State = {
        ...state,
        ready: true,
        code: snap.code,
        role: snap.role,
        memberId: snap.memberId,
        members: snap.members,
        pending: snap.pending,
        history: snap.history,
        files: snap.files,
        usage: snap.usage,
        expiresAt: snap.expiresAt,
        autoApproveUntil: snap.autoApproveUntil,
      };
      // Re-syncing after a reconnect must not overwrite what the user typed
      // while the connection was down.
      if (state.ready && isDirty(state) && snap.text !== state.serverText) {
        return { ...base, conflict: { text: snap.text, rev: snap.rev } };
      }
      return { ...base, serverText: snap.text, serverRev: snap.rev, draft: snap.text };
    }

    case "draft":
      return { ...state, draft: action.text };

    case "commit":
      return { ...state, serverText: action.text, serverRev: action.rev };

    case "conflict":
      return { ...state, conflict: { text: action.text, rev: action.rev } };

    case "takeTheirs":
      return state.conflict
        ? {
            ...state,
            serverText: state.conflict.text,
            serverRev: state.conflict.rev,
            draft: state.conflict.text,
            conflict: null,
          }
        : state;

    case "dropConflict":
      return { ...state, conflict: null };

    case "status":
      return { ...state, status: action.status };

    case "event": {
      const e = action.event;
      switch (e.type) {
        case "text": {
          const text = String(e.text);
          const rev = Number(e.rev);
          if (e.authorId === state.memberId) return { ...state, serverText: text, serverRev: rev };
          if (isDirty(state)) return { ...state, conflict: { text, rev } };
          return { ...state, serverText: text, serverRev: rev, draft: text };
        }
        case "roster":
          return { ...state, members: e.members as Member[] };
        case "pending":
          return { ...state, pending: e.pending as PendingRequest[] };
        case "history":
          return { ...state, history: e.items as HistoryItem[] };
        case "files":
          return { ...state, files: e.items as FileItem[] };
        case "usage":
          return { ...state, usage: { used: Number(e.used), limit: Number(e.limit) } };
        case "expiry":
          return { ...state, expiresAt: Number(e.expiresAt), renewedAt: Date.now() };
        case "code":
          return { ...state, code: String(e.code) };
        case "autoApprove":
          return { ...state, autoApproveUntil: Number(e.until) };
        default:
          return state;
      }
    }
  }
}

const STACK_DEFAULT = 420;
const STACK_MIN = 280;
/** The editor keeps this much room no matter how far the divider is dragged. */
const EDITOR_MIN = 360;

const clampStack = (width: number) =>
  Math.max(STACK_MIN, Math.min(width, Math.max(STACK_MIN, window.innerWidth - EDITOR_MIN)));

type Confirmation = {
  title: string;
  body: string;
  label: string;
  run: () => void;
};

type Props = {
  token: string;
  onExit: (reason?: string) => void;
  /** Leaving on purpose, unlike onExit: the token is kept so coming back skips the approval. */
  onHome: () => void;
  /** The code can rotate live; the URL must follow it or there would be no token on reload. */
  onCode: (code: string) => void;
};

export function Room({ token, onExit, onHome, onCode }: Props) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [tab, setTab] = useState<"text" | "files">("text");
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [stackWidth, setStackWidth] = useState(() => clampStack(savedStackWidth() ?? STACK_DEFAULT));
  const [clearAfterPin, setClearAfterPin] = useState(clearsOnPin);
  const editorRef = useRef<HTMLDivElement>(null);
  /** What this tab last typed, so a remote update is told apart from an echo. */
  const lastTyped = useRef("");
  const pickerRef = useRef<HTMLInputElement>(null);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);
  /** The picked File never leaves the tab: it is what a resume reads from. */
  const localFiles = useRef(new Map<string, File>());
  /** Object URLs behind the embedded images, one per file id. */
  const blobs = useRef(new Map<string, string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const t = useT();

  const isOwner = state.role === "owner";
  const dirty = isDirty(state);
  const { used, limit } = state.usage;
  const usedPercent = limit > 0 ? (used / limit) * 100 : 0;
  const full = state.ready && limit > 0 && used >= limit;
  const remaining = state.expiresAt - now;
  const expiringSoon = state.ready && remaining < 10 * 60 * 1000;
  const expiringNow = state.ready && remaining < 5 * 60 * 1000;
  const justRenewed = now - state.renewedAt < 1500;

  /* The clock re-renders the list every second and the list has no cap, so the
     previews are parsed once per change instead of once per tick. Each is a
     prefix of the stored markup, cut mid-tag as often as not; DOMParser closes
     what is dangling and the card shows text. */
  const previews = useMemo(
    () => new Map(state.history.map((item) => [item.id, toPlain(item.preview)])),
    [state.history],
  );

  const notify = (text: string, undo?: () => void) => {
    setToast({ text, undo });
    window.setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 6000);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* app.tsx owns the title, but the last minutes have to be readable from a
     background tab: that is where a room gets forgotten until it is gone. */
  useEffect(() => {
    if (!expiringNow) return;
    document.title = `${formatRemaining(remaining)} · ${state.code}`;
    return () => void (document.title = `${state.code} · cloudnt`);
  }, [expiringNow, remaining, state.code]);

  /* Repainting on every keystroke would drop the caret, so the editor is only
     rewritten when the text did not come from this tab. */
  useEffect(() => {
    const el = editorRef.current;
    if (!el || state.draft === lastTyped.current) return;
    lastTyped.current = state.draft;
    el.innerHTML = sanitize(state.draft);
    paintImages();
  }, [state.draft]);

  useEffect(() => {
    const urls = blobs.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const snap = await api.getState(token);
        if (!alive) return;
        dispatch({ type: "snapshot", snap });
        onCode(snap.code);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
          onExit(strings().app.noRoom);
        }
      }
    };

    void load();

    const stop = connect({
      token,
      onResync: load,
      onStatus: (status) => dispatch({ type: "status", status }),
      onEvent: (event) => {
        if (event.type === "kicked") return onExit(strings().room.kicked);
        if (event.type === "closed") {
          const s = strings().room;
          return onExit(event.reason === "expired" ? s.expired : s.closed);
        }
        if (event.type === "code") {
          renameCode(token, String(event.code));
          onCode(String(event.code));
        }
        dispatch({ type: "event", event });
      },
    });

    return () => {
      alive = false;
      stop();
    };
  }, [token]);

  // Debounced write: batches keystrokes into one write every 300 ms.
  useEffect(() => {
    if (!state.ready || state.conflict || !dirty) return;
    // A full room refuses anything longer than what it already holds, so writing
    // it out would fail once per keystroke. Shorter still goes: that is the way
    // back under the limit.
    if (full && state.draft.length > state.serverText.length) return;
    const pending = state.draft;
    const timer = setTimeout(async () => {
      try {
        const { rev } = await api.putText(token, pending, state.serverRev);
        dispatch({ type: "commit", text: pending, rev });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          dispatch({
            type: "conflict",
            text: String(error.payload.text ?? ""),
            rev: Number(error.payload.rev ?? 0),
          });
        } else if (error instanceof ApiError) {
          notify(error.message);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [state.draft, state.serverText, state.serverRev, state.conflict, state.ready, full]);

  /**
   * The handlers read state that changes without the listener noticing — the
   * debounced write bumps serverRev on its own — so the listener goes through a
   * ref every render refreshes. A dependency list would have to enumerate
   * everything the three shortcuts touch, and a stale rev pins against the wrong
   * revision and fails as a conflict.
   */
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (event: KeyboardEvent) => {
    if (!event.altKey) return;
    if (event.key === "c") {
      event.preventDefault();
      void handleCopy();
    }
    if (event.key === "s") {
      event.preventDefault();
      downloadText(toPlain(state.draft), `cloudnt-${state.code}.txt`);
    }
    if (event.key === "n") {
      event.preventDefault();
      void pinCurrent();
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onResize = () => setStackWidth((width) => clampStack(width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleCopy = async () => {
    if (await copyText(toPlain(state.draft))) return notify(t.room.copied);
    const el = editorRef.current;
    if (el) getSelection()?.selectAllChildren(el);
    notify(t.room.noClipboardSelected);
  };

  const pinCurrent = async () => {
    if (isEmpty(state.draft)) return;
    if (full) return notify(t.room.fullPin);
    await guard(async () => {
      // Pinning takes the server's copy, so the debounced write has to land
      // first or the entry misses the last keystrokes of a fresh paste.
      let rev = state.serverRev;
      if (dirty) {
        ({ rev } = await api.putText(token, state.draft, rev));
        dispatch({ type: "commit", text: state.draft, rev });
      }
      await api.pinText(token);

      if (clearAfterPin) {
        // Committing the empty text as well as drafting it keeps the editor from
        // looking unsaved and stops the debounce from writing the old text back.
        const cleared = await api.putText(token, "", rev);
        dispatch({ type: "draft", text: "" });
        dispatch({ type: "commit", text: "", rev: cleared.rev });
      }

      setTab("text");
      notify(clearAfterPin ? t.room.pinnedCleared : t.room.pinned);
    });
  };

  const copyEntry = (id: number) =>
    guard(async () => {
      const { content } = await api.entryContent(token, id);
      notify((await copyText(toPlain(content))) ? t.room.entryCopied : t.room.noClipboard);
    });

  /** The old single-buffer behaviour, kept as one deliberate action. */
  const copyAll = () =>
    guard(async () => {
      const bodies = await Promise.all(state.history.map((item) => api.entryContent(token, item.id)));
      const all = [state.draft, ...bodies.map((body) => body.content)]
        .map(toPlain)
        .filter((text) => text !== "")
        .join("\n\n");
      notify((await copyText(all)) ? t.room.allCopied : t.room.noClipboard);
    });

  const keepMine = async () => {
    if (!state.conflict) return;
    try {
      const { rev } = await api.putText(token, state.draft, state.conflict.rev, true);
      dispatch({ type: "commit", text: state.draft, rev });
      dispatch({ type: "dropConflict" });
    } catch (error) {
      if (error instanceof ApiError) notify(error.message);
    }
  };

  const confirmClose = () =>
    setConfirming({
      title: t.room.closeTitle,
      body: t.room.closeBody,
      label: t.room.close,
      run: () => void guard(() => api.closeRoom(token)),
    });

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError) notify(error.message);
    }
  };

  /** Uploads run one at a time: two at once only split the same bad link in half. */
  const runUpload = (id: string) => {
    setFailed((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    queue.current = queue.current.then(async () => {
      const file = localFiles.current.get(id);
      if (!file) return;
      try {
        await sendFile(token, id, file);
        localFiles.current.delete(id);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : strings().room.uploadCut;
        setFailed((current) => ({ ...current, [id]: message }));
      }
    });
  };

  const addFiles = async (picked: Iterable<File> | null) => {
    if (full) return notify(t.room.fullUpload);
    for (const file of Array.from(picked ?? [])) {
      try {
        const created = await api.createFile(token, file.name, file.size);
        localFiles.current.set(created.id, file);
        runUpload(created.id);
      } catch (error) {
        if (error instanceof ApiError) notify(t.room.uploadFailed(file.name, error.message));
      }
    }
  };

  const blobFor = async (fileId: string, name: string): Promise<string | null> => {
    const cached = blobs.current.get(fileId);
    if (cached) return cached;
    const type = imageType(name);
    if (!type) return null;
    // The uploader still has the bytes in hand; everyone else pays for a ticket.
    let data: Blob | undefined = localFiles.current.get(fileId);
    if (!data) {
      const { ticket } = await api.downloadTicket(token, fileId);
      const response = await fetch(`/api/download/${ticket}`);
      if (!response.ok) return null;
      data = await response.blob();
    }
    const url = URL.createObjectURL(new Blob([data], { type }));
    blobs.current.set(fileId, url);
    return url;
  };

  /** The document only ever names a file; the bytes are looked up here, once. */
  const paintImages = () => {
    const el = editorRef.current;
    if (!el) return;
    for (const img of el.querySelectorAll<HTMLImageElement>("img[data-file]:not([src])")) {
      const id = img.dataset.file;
      if (!id) continue;
      void blobFor(id, img.alt)
        .then((url) => {
          if (url) img.setAttribute("src", url);
        })
        .catch(() => {});
    }
  };

  const commitEditor = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = serialize(el);
    lastTyped.current = html;
    dispatch({ type: "draft", text: html });
    paintImages();
  };

  const insertImages = async (picked: File[]) => {
    if (full) return notify(t.room.fullUpload);
    for (const file of picked) {
      try {
        const created = await api.createFile(token, file.name, file.size);
        localFiles.current.set(created.id, file);
        runUpload(created.id);
        // execCommand is the only insertion that leaves the caret and the undo
        // stack where the browser put them, and it needs the editor focused.
        editorRef.current?.focus();
        document.execCommand("insertHTML", false, imageTag(created.id, file.name));
        commitEditor();
      } catch (error) {
        if (error instanceof ApiError) notify(t.room.uploadFailed(file.name, error.message));
      }
    }
  };

  /** In the editor an image joins the text; everywhere else it is a room file. */
  const receive = (picked: File[], target: EventTarget | null) => {
    const inEditor = editorRef.current?.contains(target as Node) ?? false;
    const inline = inEditor ? picked.filter(isImage) : [];
    const rest = picked.filter((file) => !inline.includes(file));
    if (inline.length) void insertImages(inline);
    if (rest.length) {
      setTab("files");
      void addFiles(rest);
    }
  };

  if (!state.ready) {
    return (
      <div class="center-note">
        <Logo />
        <p style="color: var(--ink-muted)">{t.room.opening}</p>
      </div>
    );
  }

  return (
    <div class="room">
      <header class="room-bar">
        <button
          type="button"
          class="room-back"
          aria-label={t.room.home}
          data-tip={t.room.homeTip}
          onClick={onHome}
        >
          <Icon name="home" />
        </button>

        <button
          type="button"
          class="room-code"
          title={t.room.copyLink}
          onClick={async () => {
            const link = `${location.origin}/${state.code}`;
            notify((await copyText(link)) ? t.room.linkCopied : link);
          }}
        >
          <Logo mark />
          {state.code}
        </button>

        <div class="bar-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-tip={t.room.copyTip}
            onClick={() => void handleCopy()}
          >
            <Icon name="copy" />
            <span class="btn-label">{t.room.copy}</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-tip={t.room.pinTip}
            disabled={isEmpty(state.draft) || full}
            onClick={() => void pinCurrent()}
          >
            <Icon name="pin" />
            <span class="btn-label">{t.room.pin}</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-tip={t.room.downloadTip}
            onClick={() => downloadText(toPlain(state.draft), `cloudnt-${state.code}.txt`)}
          >
            <Icon name="download" />
            <span class="btn-label">{t.room.download}</span>
          </button>
        </div>

        <span class="room-bar-spacer" />

        <Menu
          title={t.room.devices}
          label={
            <>
              <Icon name="devices" />
              {state.members.length}
              {isOwner && state.pending.length > 0 ? <span class="badge">{state.pending.length}</span> : null}
            </>
          }
        >
          {isOwner && state.pending.length > 0 ? (
            <div class="menu-group">
              <h3>{t.room.waitingApproval}</h3>
              {state.pending.map((request) => (
                <div key={request.id} class="pending">
                  <div class="pending-fingerprint">{request.fingerprint}</div>
                  <div class="pending-meta" title={request.userAgent}>
                    {request.ip} · {formatAge(request.createdAt)}
                  </div>
                  <div class="pending-actions">
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      onClick={() => void guard(() => api.approve(token, request.id))}
                    >
                      {t.room.approve}
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      onClick={() =>
                        void guard(async () => {
                          await api.reject(token, request.id);
                          notify(t.room.rejected(request.fingerprint), () =>
                            void guard(() => api.approve(token, request.id)),
                          );
                        })
                      }
                    >
                      {t.room.reject}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div class="menu-group">
            <h3>{t.room.deviceCount(state.members.length)}</h3>
            {state.members.map((member) => (
              <div key={member.id} class="member-row">
                <span class={`member-dot${member.online ? " online" : ""}`} aria-hidden="true" />
                <span class="member-name">{member.fingerprint}</span>
                {member.id === state.memberId ? <span class="tag">{t.room.you}</span> : null}
                {member.role === "owner" ? <span class="tag">{t.room.owner}</span> : null}
                {isOwner && member.role !== "owner" ? (
                  <button
                    type="button"
                    class="icon-btn"
                    title={t.room.kick(member.fingerprint)}
                    onClick={() => void guard(() => api.kick(token, member.id))}
                  >
                    <Icon name="close" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Menu>

        <Menu title={t.room.settings} label={<Icon name="settings" />}>
          <div class="menu-group">
            <h3>{t.room.thisDevice}</h3>
            <button
              type="button"
              class="menu-item menu-item-toggle"
              onClick={() => setLang(currentLang() === "es" ? "en" : "es")}
            >
              {t.room.language}
              <span class="tag">{t.langName}</span>
            </button>
            <button
              type="button"
              class="menu-item menu-item-toggle"
              role="menuitemcheckbox"
              aria-checked={clearAfterPin}
              onClick={() => {
                const next = !clearAfterPin;
                setClearAfterPin(next);
                saveClearsOnPin(next);
              }}
            >
              {t.room.clearOnPin}
              <span class="tag">{clearAfterPin ? t.room.yes : t.room.no}</span>
            </button>
          </div>

          {isOwner ? (
            <>
              <div class="menu-group">
                <h3>{t.room.access}</h3>
                <button
                  type="button"
                  class="menu-item"
                  onClick={() =>
                    void guard(async () => {
                      const active = state.autoApproveUntil > Date.now();
                      await api.setAutoApprove(token, active ? 0 : 5);
                      notify(active ? t.room.autoApproveDisabled : t.room.autoApproveEnabled);
                    })
                  }
                >
                  {state.autoApproveUntil > Date.now()
                    ? t.room.autoApproveOn(formatRemaining(state.autoApproveUntil - now))
                    : t.room.autoApproveOff}
                </button>
                <button
                  type="button"
                  class="menu-item"
                  onClick={() =>
                    void guard(async () => {
                      await api.rotate(token);
                      notify(t.room.rotated);
                    })
                  }
                >
                  {t.room.rotate}
                </button>
              </div>

              <div class="menu-group">
                <h3>{t.room.danger}</h3>
                <button
                  type="button"
                  class="menu-item danger"
                  onClick={() =>
                    setConfirming({
                      title: t.room.wipeTitle,
                      body: t.room.wipeBody,
                      label: t.room.wipeLabel,
                      run: () =>
                        void guard(async () => {
                          const { rev } = await api.clearRoom(token);
                          // Own echo does not update the draft, to avoid overwriting ongoing
                          // typing. Clearing is the exception: the editor must end up empty.
                          dispatch({ type: "draft", text: "" });
                          dispatch({ type: "commit", text: "", rev });
                          notify(t.room.wiped);
                        }),
                    })
                  }
                >
                  {t.room.wipe}
                </button>
                <button
                  type="button"
                  class="menu-item danger"
                  onClick={confirmClose}
                >
                  {t.room.close}
                </button>
              </div>
            </>
          ) : null}
        </Menu>
      </header>

      {state.conflict ? (
        <div class="banner banner-conflict" role="alert">
          <strong>{t.room.conflictTitle}</strong>
          <span>{t.room.conflictBody}</span>
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => dispatch({ type: "takeTheirs" })}>
            {t.room.takeTheirs}
          </button>
          <button type="button" class="btn btn-primary btn-sm" onClick={() => void keepMine()}>
            {t.room.keepMine}
          </button>
        </div>
      ) : null}

      {full ? (
        <div class="banner banner-error" role="alert">
          <strong>{t.room.fullTitle}</strong>
          <span>{t.room.fullBody(formatSize(limit))}</span>
          {isOwner ? (
            <button type="button" class="btn btn-danger btn-sm" onClick={confirmClose}>
              {t.room.close}
            </button>
          ) : null}
        </div>
      ) : null}

      {expiringSoon ? (
        <div class={`banner ${expiringNow ? "banner-error" : "banner-warn"}`} role={expiringNow ? "alert" : "status"}>
          <strong>{expiringNow ? t.room.expiresNow(formatRemaining(remaining)) : t.room.expiresIn(formatRemaining(remaining))}</strong>
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => void guard(() => api.keepAlive(token))}>
            {t.room.keepAlive}
          </button>
        </div>
      ) : null}

      <div
        class={`room-body${dragging ? " dropping" : ""}`}
        style={`--stack-w:${stackWidth}px`}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        // Moving onto a child fires dragleave on the container; without the
        // containment check the overlay flickers on every hop.
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer?.files.length) return;
          event.preventDefault();
          setDragging(false);
          receive(Array.from(event.dataTransfer.files), event.target);
        }}
        // Screenshots arrive on the clipboard as files, so the paste that would
        // otherwise drop nothing into the editor becomes an upload instead.
        onPaste={(event) => {
          if (!event.clipboardData?.files.length) return;
          event.preventDefault();
          receive(Array.from(event.clipboardData.files), event.target);
        }}
      >
        <div class="editor-pane">
          <div class="editor-tools" role="toolbar" aria-label={t.room.formatting}>
            {FORMATS.map(({ command, key, label }) => (
              <button
                key={command}
                type="button"
                class="tool"
                title={t.room[key]}
                aria-label={t.room[key]}
                // The editor loses focus on mousedown, and execCommand without a
                // selection formats nothing.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editorRef.current?.focus();
                  document.execCommand(command);
                  commitEditor();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            ref={editorRef}
            class="editor"
            contentEditable
            role="textbox"
            aria-multiline="true"
            spellcheck={false}
            aria-label={t.room.editorLabel}
            data-placeholder={t.room.editorPlaceholder}
            data-empty={isEmpty(state.draft) ? "" : undefined}
            onInput={commitEditor}
          />
        </div>

        <div
          class="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.room.resizer}
          aria-valuenow={stackWidth}
          aria-valuemin={STACK_MIN}
          aria-valuemax={Math.round(window.innerWidth - EDITOR_MIN)}
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeFrom.current = { x: event.clientX, width: stackWidth };
          }}
          onPointerMove={(event) => {
            const from = resizeFrom.current;
            if (from) setStackWidth(clampStack(from.width - (event.clientX - from.x)));
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            resizeFrom.current = null;
            saveStackWidth(stackWidth);
          }}
          onKeyDown={(event) => {
            const step = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
            if (step === 0) return;
            event.preventDefault();
            const next = clampStack(stackWidth + step);
            setStackWidth(next);
            saveStackWidth(next);
          }}
        />

        <aside class="stack">
          <div class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "text"}
              class={`tab${tab === "text" ? " active" : ""}`}
              onClick={() => setTab("text")}
            >
              {t.room.tabPastes}
              <span class="tab-n">{state.history.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "files"}
              class={`tab${tab === "files" ? " active" : ""}`}
              onClick={() => setTab("files")}
            >
              {t.room.tabFiles}
              <span class="tab-n">{state.files.length}</span>
            </button>
          </div>

          <div class="stack-tools">
            {tab === "text" ? (
              <button type="button" class="btn btn-secondary btn-sm" onClick={() => void copyAll()}>
                <Icon name="copy" />
                {t.room.copyAll}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  disabled={full}
                  title={full ? t.room.fullShort : undefined}
                  onClick={() => pickerRef.current?.click()}
                >
                  <Icon name="plus" />
                  {t.room.upload}
                </button>
                <input
                  ref={pickerRef}
                  type="file"
                  multiple
                  class="sr-only"
                  onChange={(event) => {
                    void addFiles(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </>
            )}
          </div>

          <div class="stack-body">
            {tab === "text" ? (
              state.history.length === 0 ? (
                <p class="empty">{t.room.emptyPastes}</p>
              ) : (
                state.history.map((item) => (
                  <article key={item.id} class="entry">
                    <pre class="entry-preview">{previews.get(item.id)}</pre>
                    <div class="entry-foot">
                      <span class="entry-meta">
                        {formatSize(item.bytes)} · {formatAge(item.created_at)}
                      </span>
                      <span class="room-bar-spacer" />
                      <button
                        type="button"
                        class="icon-btn"
                        title={t.room.copyEntry}
                        onClick={() => void copyEntry(item.id)}
                      >
                        <Icon name="copy" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        title={t.room.restoreEntry}
                        onClick={() =>
                          void guard(async () => {
                            const { content } = await api.entryContent(token, item.id);
                            dispatch({ type: "draft", text: content });
                          })
                        }
                      >
                        <Icon name="history" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        title={t.room.removeEntry}
                        onClick={() => void guard(() => api.removeEntry(token, item.id))}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </article>
                ))
              )
            ) : state.files.length === 0 ? (
              <p class="empty">{t.room.emptyFiles}</p>
            ) : (
              state.files.map((item) => {
                const percent = Math.round((item.received / item.chunks) * 100);
                const error = failed[item.id];
                const ready = item.status === "ready";
                return (
                  <article key={item.id} class="entry">
                    <div class="file-main">
                      <span class="file-name" title={item.name}>
                        {item.name}
                      </span>
                      {ready ? null : (
                        <span class="file-bar">
                          <span style={`width:${percent}%`} />
                        </span>
                      )}
                    </div>
                    <div class="entry-foot">
                      <span class={`entry-meta${error ? " file-error" : ""}`}>
                        {formatSize(item.size)}
                        {ready ? "" : ` · ${percent}%`}
                        {error ? ` · ${error}` : ""}
                      </span>
                      <span class="room-bar-spacer" />
                      {ready ? (
                        <button
                          type="button"
                          class="icon-btn"
                          title={t.room.download}
                          onClick={() =>
                            void guard(async () => {
                              const { ticket } = await api.downloadTicket(token, item.id);
                              location.href = `/api/download/${ticket}`;
                            })
                          }
                        >
                          <Icon name="download" />
                        </button>
                      ) : error && localFiles.current.has(item.id) ? (
                        <button type="button" class="btn btn-primary btn-sm" onClick={() => runUpload(item.id)}>
                          {t.room.resume}
                        </button>
                      ) : null}
                      {isOwner || item.authorId === state.memberId ? (
                        <button
                          type="button"
                          class="icon-btn"
                          title={t.room.remove}
                          onClick={() =>
                            void guard(async () => {
                              localFiles.current.delete(item.id);
                              await api.removeFile(token, item.id);
                            })
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </aside>

        {dragging ? (
          <div class="drop-veil" aria-hidden="true">
            <Icon name="download" />
            <span>{t.room.dropHere}</span>
          </div>
        ) : null}
      </div>

      <footer class="room-foot">
        <span class={`status-dot${state.status === "online" ? "" : " offline"}`}>
          {state.status === "online" ? t.room.online : t.room.offline}
        </span>
        <span
          class={`usage${full ? " usage-full" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          aria-label={t.room.usageLabel}
          title={t.room.usageTitle(formatSize(used), formatSize(limit))}
        >
          <span class="usage-bar" aria-hidden="true">
            <span class="usage-fill" style={`width:${Math.min(100, usedPercent)}%`} />
          </span>
          {t.room.usageOf(formatPercent(usedPercent), formatSize(limit))}
        </span>

        <span>
          {formatBytes(state.draft)} ·{" "}
          <span class={dirty ? "foot-dirty" : undefined}>{dirty ? t.room.unsaved : t.room.synced}</span>
        </span>

        <span class="room-bar-spacer" />

        <span class={`clock${expiringSoon ? " urgent" : ""}`}>
          {t.room.clock(formatRemaining(remaining))}
          {justRenewed ? <span class="clock-renewed">{t.room.renewed}</span> : null}
        </span>
      </footer>

      {confirming ? (
        <Modal title={confirming.title} onClose={() => setConfirming(null)}>
          <p>{confirming.body}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onClick={() => setConfirming(null)}>
              {t.room.cancel}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              onClick={() => {
                confirming.run();
                setConfirming(null);
              }}
            >
              {confirming.label}
            </button>
          </div>
        </Modal>
      ) : null}

      {toast ? (
        <div class="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              {t.room.undo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
