import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import * as api from "./api.ts";
import {
  ApiError,
  type FileItem,
  type HistoryItem,
  type Member,
  type PendingRequest,
  type Snapshot,
} from "./api.ts";
import { connect, type ConnectionStatus, type ServerEvent } from "./transport.ts";
import { renameCode, saveStackWidth, savedStackWidth } from "./store.ts";
import { sendFile } from "./uploads.ts";
import { Logo } from "./Logo.tsx";
import { Icon } from "./icons.tsx";
import { Menu, Modal } from "./ui.tsx";
import { copyText, downloadText, formatAge, formatBytes, formatRemaining, formatSize } from "./format.ts";

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
  /** The code can rotate live; the URL must follow it or there would be no token on reload. */
  onCode: (code: string) => void;
};

export function Room({ token, onExit, onCode }: Props) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [tab, setTab] = useState<"text" | "files">("text");
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [stackWidth, setStackWidth] = useState(() => clampStack(savedStackWidth() ?? STACK_DEFAULT));
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);
  /** The picked File never leaves the tab: it is what a resume reads from. */
  const localFiles = useRef(new Map<string, File>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const isOwner = state.role === "owner";
  const dirty = isDirty(state);
  const remaining = state.expiresAt - now;
  const expiringSoon = state.ready && remaining < 10 * 60 * 1000;
  const justRenewed = now - state.renewedAt < 1500;

  const notify = (text: string, undo?: () => void) => {
    setToast({ text, undo });
    window.setTimeout(() => setToast((current) => (current?.text === text ? null : current)), 6000);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
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
          onExit("Esa sala ya no existe.");
        }
      }
    };

    void load();

    const stop = connect({
      token,
      onResync: load,
      onStatus: (status) => dispatch({ type: "status", status }),
      onEvent: (event) => {
        if (event.type === "kicked") return onExit("El dueño te sacó de la sala.");
        if (event.type === "closed") {
          return onExit(event.reason === "expired" ? "La sala expiró." : "El dueño cerró la sala.");
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
  }, [state.draft, state.serverText, state.serverRev, state.conflict, state.ready]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "c") {
        event.preventDefault();
        void handleCopy();
      }
      if (event.key === "s") {
        event.preventDefault();
        downloadText(state.draft, `cloudnt-${state.code}.txt`);
      }
      if (event.key === "n") {
        event.preventDefault();
        void pinCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.draft, state.code]);

  useEffect(() => {
    const onResize = () => setStackWidth((width) => clampStack(width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleCopy = async () => {
    if (await copyText(state.draft)) return notify("Copiado al portapapeles");
    editorRef.current?.select();
    notify("Sin permiso de portapapeles: el texto quedó seleccionado, pulsa Ctrl+C");
  };

  const pinCurrent = async () => {
    if (state.draft.trim() === "") return;
    await guard(async () => {
      // Pinning takes the server's copy, so the debounced write has to land
      // first or the entry misses the last keystrokes of a fresh paste.
      if (dirty) {
        const { rev } = await api.putText(token, state.draft, state.serverRev);
        dispatch({ type: "commit", text: state.draft, rev });
      }
      await api.pinText(token);
      setTab("text");
      notify("Fijado como pegada");
    });
  };

  const copyEntry = async (text: string) => {
    notify((await copyText(text)) ? "Pegada copiada" : "Sin permiso de portapapeles");
  };

  /** The old single-buffer behaviour, kept as one deliberate action. */
  const copyAll = async () => {
    const all = [state.draft, ...state.history.map((item) => item.content)]
      .filter((text) => text.trim() !== "")
      .join("\n\n");
    notify((await copyText(all)) ? "Todo copiado al portapapeles" : "Sin permiso de portapapeles");
  };

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
        const message = error instanceof ApiError ? error.message : "se cortó la subida";
        setFailed((current) => ({ ...current, [id]: message }));
      }
    });
  };

  const addFiles = async (picked: FileList | null) => {
    for (const file of Array.from(picked ?? [])) {
      try {
        const created = await api.createFile(token, file.name, file.size);
        localFiles.current.set(created.id, file);
        runUpload(created.id);
      } catch (error) {
        if (error instanceof ApiError) notify(`${file.name}: ${error.message}`);
      }
    }
  };

  if (!state.ready) {
    return (
      <div class="center-note">
        <Logo />
        <p style="color: var(--ink-muted)">Abriendo la sala...</p>
      </div>
    );
  }

  return (
    <div class="room">
      <header class="room-bar">
        <button
          type="button"
          class="room-code"
          title="Copiar el enlace de la sala"
          onClick={async () => {
            const link = `${location.origin}/${state.code}`;
            notify((await copyText(link)) ? "Enlace copiado" : link);
          }}
        >
          <Logo mark />
          {state.code}
        </button>

        <div class="bar-actions">
          <button type="button" class="btn btn-secondary btn-sm" title="Alt+C" onClick={() => void handleCopy()}>
            <Icon name="copy" />
            <span class="btn-label">Copiar</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            title="Alt+N · guarda este texto como una pegada aparte, para que el siguiente no lo pise"
            disabled={state.draft.trim() === ""}
            onClick={() => void pinCurrent()}
          >
            <Icon name="pin" />
            <span class="btn-label">Nueva pegada</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            title="Alt+S"
            onClick={() => downloadText(state.draft, `cloudnt-${state.code}.txt`)}
          >
            <Icon name="download" />
            <span class="btn-label">Descargar</span>
          </button>
        </div>

        <span class="room-bar-spacer" />

        <Menu
          title="Dispositivos en la sala"
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
              <h3>Esperando aprobación</h3>
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
                      Aprobar
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      onClick={() =>
                        void guard(async () => {
                          await api.reject(token, request.id);
                          notify(`Rechazado ${request.fingerprint}`, () =>
                            void guard(() => api.approve(token, request.id)),
                          );
                        })
                      }
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div class="menu-group">
            <h3>Dispositivos ({state.members.length})</h3>
            {state.members.map((member) => (
              <div key={member.id} class="member-row">
                <span class={`member-dot${member.online ? " online" : ""}`} aria-hidden="true" />
                <span class="member-name">{member.fingerprint}</span>
                {member.id === state.memberId ? <span class="tag">tú</span> : null}
                {member.role === "owner" ? <span class="tag">dueño</span> : null}
                {isOwner && member.role !== "owner" ? (
                  <button
                    type="button"
                    class="icon-btn"
                    title={`Expulsar a ${member.fingerprint}`}
                    onClick={() => void guard(() => api.kick(token, member.id))}
                  >
                    <Icon name="close" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Menu>

        {isOwner ? (
          <Menu title="Ajustes de la sala" label={<Icon name="settings" />}>
            <div class="menu-group">
              <h3>Acceso</h3>
              <button
                type="button"
                class="menu-item"
                onClick={() =>
                  void guard(async () => {
                    const active = state.autoApproveUntil > Date.now();
                    await api.setAutoApprove(token, active ? 0 : 5);
                    notify(active ? "Auto-aprobar desactivado" : "Auto-aprobar activo 5 min");
                  })
                }
              >
                {state.autoApproveUntil > Date.now()
                  ? `Auto-aprobar: ${formatRemaining(state.autoApproveUntil - now)}`
                  : "Auto-aprobar 5 min"}
              </button>
              <button
                type="button"
                class="menu-item"
                onClick={() =>
                  void guard(async () => {
                    await api.rotate(token);
                    notify("Código rotado");
                  })
                }
              >
                Cambiar el código
              </button>
            </div>
            <div class="menu-group">
              <h3>Zona de riesgo</h3>
              <button
                type="button"
                class="menu-item danger"
                onClick={() =>
                  setConfirming({
                    title: "¿Vaciar la sala?",
                    body: "Se borran el texto y las pegadas de todos los que estén dentro. Los archivos se quedan. No se puede deshacer.",
                    label: "Vaciar",
                    run: () =>
                      void guard(async () => {
                        const { rev } = await api.clearRoom(token);
                        // Own echo does not update the draft, to avoid overwriting ongoing
                        // typing. Clearing is the exception: the editor must end up empty.
                        dispatch({ type: "draft", text: "" });
                        dispatch({ type: "commit", text: "", rev });
                        notify("Sala vaciada");
                      }),
                  })
                }
              >
                Vaciar el contenido
              </button>
              <button
                type="button"
                class="menu-item danger"
                onClick={() =>
                  setConfirming({
                    title: "¿Cerrar la sala?",
                    body: "La sala desaparece ahora mismo con el texto, las pegadas y los archivos, y todos los conectados salen. No se puede deshacer.",
                    label: "Cerrar la sala",
                    run: () => void guard(() => api.closeRoom(token)),
                  })
                }
              >
                Cerrar la sala
              </button>
            </div>
          </Menu>
        ) : null}
      </header>

      {state.conflict ? (
        <div class="banner banner-conflict" role="alert">
          <strong>Alguien más editó el texto.</strong>
          <span>Tu versión no se ha perdido: elige cuál se queda.</span>
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => dispatch({ type: "takeTheirs" })}>
            Traer la nueva
          </button>
          <button type="button" class="btn btn-primary btn-sm" onClick={() => void keepMine()}>
            Conservar la mía
          </button>
        </div>
      ) : null}

      {expiringSoon ? (
        <div class="banner banner-warn" role="status">
          <strong>Esta sala se borra en {formatRemaining(remaining)}.</strong>
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => void guard(() => api.keepAlive(token))}>
            Mantener viva
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
          setTab("files");
          void addFiles(event.dataTransfer.files);
        }}
      >
        <div class="editor-pane">
          <textarea
            ref={editorRef}
            class="editor"
            value={state.draft}
            spellcheck={false}
            autocomplete="off"
            aria-label="Contenido compartido de la sala"
            placeholder="Pega aquí lo que quieras mover a la otra máquina."
            onInput={(event) => dispatch({ type: "draft", text: event.currentTarget.value })}
          />
        </div>

        <div
          class="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ancho del panel lateral"
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
              Pegadas<span class="tab-n">{state.history.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "files"}
              class={`tab${tab === "files" ? " active" : ""}`}
              onClick={() => setTab("files")}
            >
              Archivos<span class="tab-n">{state.files.length}</span>
            </button>
          </div>

          <div class="stack-tools">
            {tab === "text" ? (
              <button type="button" class="btn btn-secondary btn-sm" onClick={() => void copyAll()}>
                <Icon name="copy" />
                Copiar todo
              </button>
            ) : (
              <>
                <button type="button" class="btn btn-secondary btn-sm" onClick={() => pickerRef.current?.click()}>
                  <Icon name="plus" />
                  Subir archivo
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
                <p class="empty">
                  Cada vez que alguien pega algo distinto, lo anterior queda aquí como una pegada aparte. También
                  puedes fijar el texto actual sin esperar a que lo reemplacen.
                </p>
              ) : (
                state.history.map((item) => (
                  <article key={item.id} class="entry">
                    <pre class="entry-preview">{item.content.slice(0, 400)}</pre>
                    <div class="entry-foot">
                      <span class="entry-meta">
                        {formatBytes(item.content)} · {formatAge(item.created_at)}
                      </span>
                      <span class="room-bar-spacer" />
                      <button
                        type="button"
                        class="icon-btn"
                        title="Copiar esta pegada"
                        onClick={() => void copyEntry(item.content)}
                      >
                        <Icon name="copy" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        title="Traerla al editor"
                        onClick={() => dispatch({ type: "draft", text: item.content })}
                      >
                        <Icon name="history" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        title="Quitar esta pegada"
                        onClick={() => void guard(() => api.removeEntry(token, item.id))}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </article>
                ))
              )
            ) : state.files.length === 0 ? (
              <p class="empty">Arrastra un archivo a la sala o pulsa Subir. Se borran con ella.</p>
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
                          title="Descargar"
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
                          Reanudar
                        </button>
                      ) : null}
                      {isOwner || item.authorId === state.memberId ? (
                        <button
                          type="button"
                          class="icon-btn"
                          title="Quitar"
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
            <span>Suelta para subirlo a la sala</span>
          </div>
        ) : null}
      </div>

      <footer class="room-foot">
        <span class={`status-dot${state.status === "online" ? "" : " offline"}`}>
          {state.status === "online" ? "conectado" : "reconectando"}
        </span>
        <span class={`clock${expiringSoon ? " urgent" : ""}`}>
          se borra en {formatRemaining(remaining)} sin actividad
          {justRenewed ? <span class="clock-renewed"> · reiniciado</span> : null}
        </span>

        <span class="room-bar-spacer" />

        <span>
          {formatBytes(state.draft)} ·{" "}
          <span class={dirty ? "foot-dirty" : undefined}>{dirty ? "sin guardar" : "sincronizado"}</span>
        </span>
        <span class="tools-hint">Alt+C copiar · Alt+N nueva pegada · Alt+S descargar</span>
      </footer>

      {confirming ? (
        <Modal title={confirming.title} onClose={() => setConfirming(null)}>
          <p>{confirming.body}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onClick={() => setConfirming(null)}>
              Cancelar
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
              Deshacer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
