import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import * as api from "./api.ts";
import {
  ApiError,
  CLIENT_ID,
  type BlockItem,
  type Doc,
  type FileItem,
  type Member,
  type PendingRequest,
  type Snapshot,
  type Usage,
} from "./api.ts";
import { connect, type ConnectionStatus, type ServerEvent } from "./transport.ts";
import { renameCode, saveStackWidth, savedStackWidth } from "./store.ts";
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

/** Matches BLOCK_PREVIEW_CHARS on the server, so a live edit redraws the card. */
const PREVIEW_CHARS = 400;

const byteLength = (text: string) => new Blob([text]).size;

type State = {
  ready: boolean;
  code: string;
  role: "owner" | "member";
  memberId: string;
  /**
   * The block this tab is looking at, or null for the shared draft. It lives
   * here and nowhere else: another device opening its own block is none of this
   * one's business, which is the whole point of the split.
   */
  openId: number | null;
  /** The open block refuses writes, so the editor stops taking them too. */
  locked: boolean;
  /** The open document as the server has it — the draft or the block. */
  serverText: string;
  serverRev: number;
  text: string;
  /**
   * Counts the texts that did not come from the editor. Typing outruns the
   * render, so the effect cannot tell an echo from a remote change by comparing
   * text — it would repaint stale text over what is being typed and drop the
   * caret with it. Only a bump here repaints.
   */
  repaint: number;
  /**
   * The shared draft while a block is open: kept up to date so going back to it
   * is instant, and so a deleted block has somewhere to land.
   */
  shadow: Doc;
  conflict: { text: string; rev: number } | null;
  members: Member[];
  pending: PendingRequest[];
  blocks: BlockItem[];
  /** Changed elsewhere while this tab was looking at something else. */
  unseen: Set<number>;
  unseenFiles: Set<string>;
  files: FileItem[];
  usage: Usage;
  expiresAt: number;
  autoApproveUntil: number;
  status: ConnectionStatus;
  renewedAt: number;
};

type Action =
  | { type: "snapshot"; snap: Snapshot }
  /** `external` marks text the editor has to be repainted with. */
  | { type: "edit"; text: string; external?: boolean }
  | { type: "open"; id: number | null; text: string; rev: number; locked: boolean }
  | { type: "shadow"; doc: Doc }
  | { type: "commit"; text: string; rev: number }
  | { type: "conflict"; text: string; rev: number }
  | { type: "takeTheirs" }
  | { type: "dropConflict" }
  | { type: "seenFiles" }
  | { type: "status"; status: ConnectionStatus }
  | { type: "event"; event: ServerEvent };

const initial: State = {
  ready: false,
  code: "",
  role: "member",
  memberId: "",
  openId: null,
  locked: false,
  serverText: "",
  serverRev: 0,
  text: "",
  repaint: 0,
  shadow: { text: "", rev: 0 },
  conflict: null,
  members: [],
  pending: [],
  blocks: [],
  unseen: new Set(),
  unseenFiles: new Set(),
  files: [],
  usage: { used: 0, limit: 0 },
  expiresAt: 0,
  autoApproveUntil: 0,
  status: "connecting",
  renewedAt: 0,
};

const isDirty = (s: State) => s.text !== s.serverText;

/** Landing on a document: the editor is repainted and the conflict is moot. */
const land = (state: State, id: number | null, text: string, rev: number, locked: boolean): State => ({
  ...state,
  openId: id,
  locked,
  serverText: text,
  serverRev: rev,
  text,
  repaint: state.repaint + 1,
  conflict: null,
  unseen: without(state.unseen, id),
  // On the draft the shadow is the same document, so it can never go stale.
  shadow: id === null ? { text, rev } : state.shadow,
});

function without<T>(set: Set<T>, value: T | null): Set<T> {
  if (value === null || !set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
}

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
        blocks: snap.blocks,
        files: snap.files,
        usage: snap.usage,
        shadow: snap.draft,
        expiresAt: snap.expiresAt,
        autoApproveUntil: snap.autoApproveUntil,
      };
      // The block this tab asked for may have been deleted while it was away;
      // the draft is where it falls back to.
      const doc = snap.open ?? { id: null, ...snap.draft, locked: false };
      // Re-syncing after a reconnect must not overwrite what the user typed
      // while the connection was down.
      if (state.ready && isDirty(state) && doc.text !== state.serverText) {
        return { ...base, conflict: { text: doc.text, rev: doc.rev } };
      }
      return land(base, doc.id, doc.text, doc.rev, doc.locked);
    }

    case "edit":
      return {
        ...state,
        text: action.text,
        repaint: action.external ? state.repaint + 1 : state.repaint,
      };

    case "open":
      return land(state, action.id, action.text, action.rev, action.locked);

    case "shadow":
      return { ...state, shadow: action.doc };

    case "commit": {
      const doc = { text: action.text, rev: action.rev };
      return { ...state, serverText: doc.text, serverRev: doc.rev, ...(state.openId === null ? { shadow: doc } : {}) };
    }

    case "conflict":
      return { ...state, conflict: { text: action.text, rev: action.rev } };

    case "takeTheirs":
      return state.conflict
        ? {
            ...state,
            serverText: state.conflict.text,
            serverRev: state.conflict.rev,
            text: state.conflict.text,
            repaint: state.repaint + 1,
            conflict: null,
          }
        : state;

    case "dropConflict":
      return { ...state, conflict: null };

    case "seenFiles":
      return state.unseenFiles.size === 0 ? state : { ...state, unseenFiles: new Set() };

    case "status":
      return { ...state, status: action.status };

    case "event": {
      const e = action.event;
      switch (e.type) {
        case "draft": {
          const doc = { text: String(e.text), rev: Number(e.rev) };
          // A tab reading a block only files the draft away; being dragged onto
          // it is exactly what the split is there to prevent.
          if (state.openId !== null) return { ...state, shadow: doc };
          return { ...syncOpen(state, doc.text, doc.rev, e.origin === CLIENT_ID), shadow: doc };
        }
        case "block": {
          const id = Number(e.id);
          const text = String(e.text);
          const blocks = state.blocks.map((item) =>
            item.id === id
              ? {
                  ...item,
                  rev: Number(e.rev),
                  updatedAt: Number(e.updatedAt),
                  bytes: byteLength(text),
                  preview: text.slice(0, PREVIEW_CHARS),
                }
              : item,
          );
          if (id === state.openId) {
            return { ...syncOpen(state, text, Number(e.rev), e.origin === CLIENT_ID), blocks };
          }
          // Somewhere else in the room something moved. Worth a mark, not worth
          // stealing the screen for.
          const unseen = e.origin === CLIENT_ID ? state.unseen : new Set(state.unseen).add(id);
          return { ...state, blocks, unseen };
        }
        case "blocks": {
          const items = e.items as BlockItem[];
          const known = new Set(state.blocks.map((item) => item.id));
          const alive = new Set(items.map((item) => item.id));
          const unseen = new Set<number>();
          for (const id of state.unseen) if (alive.has(id)) unseen.add(id);
          for (const item of items) {
            if (!state.ready || known.has(item.id) || item.authorId === state.memberId) continue;
            unseen.add(item.id);
          }
          const next = { ...state, blocks: items, unseen };
          if (state.openId === null) return next;
          // The open block was deleted by someone else. The draft is the one
          // document that is always there, so that is where the editor goes.
          if (!alive.has(state.openId)) {
            return land(next, null, state.shadow.text, state.shadow.rev, false);
          }
          // This list is what carries a lock, so the editor takes its read-only
          // state from here: otherwise it stays writable and the server 423s.
          const open = items.find((item) => item.id === state.openId);
          return open && open.locked !== state.locked ? { ...next, locked: open.locked } : next;
        }
        case "roster":
          return { ...state, members: e.members as Member[] };
        case "pending":
          return { ...state, pending: e.pending as PendingRequest[] };
        case "files": {
          const items = e.items as FileItem[];
          const known = new Set(state.files.map((item) => item.id));
          const alive = new Set(items.map((item) => item.id));
          const unseenFiles = new Set<string>();
          for (const id of state.unseenFiles) if (alive.has(id)) unseenFiles.add(id);
          for (const item of items) {
            if (!known.has(item.id) && item.authorId !== state.memberId) unseenFiles.add(item.id);
          }
          return { ...state, files: items, unseenFiles };
        }
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

/** A write to the document the editor is on, from this tab or from elsewhere. */
function syncOpen(state: State, text: string, rev: number, mine: boolean): State {
  if (mine) return { ...state, serverText: text, serverRev: rev };
  if (isDirty(state)) return { ...state, conflict: { text, rev } };
  return { ...state, serverText: text, serverRev: rev, text, repaint: state.repaint + 1 };
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
  /** A second way out, offered between cancelling and the main action. */
  alt?: { label: string; run: () => void };
  /** The main action deletes something unless this says otherwise. */
  safe?: boolean;
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
  const editorRef = useRef<HTMLDivElement>(null);
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
  const openBlock = state.blocks.find((item) => item.id === state.openId);
  const { used, limit } = state.usage;
  const usedPercent = limit > 0 ? (used / limit) * 100 : 0;
  const full = state.ready && limit > 0 && used >= limit;
  /* Why each editor button is off. A greyed-out button that says nothing leaves
     the member guessing, and the shortcut behind it looks broken. */
  const noPin = isEmpty(state.text)
    ? t.room.pinEmpty
    : state.openId !== null && !state.locked
      ? t.room.pinOpen
      : full
        ? t.room.fullShort
        : null;
  const noNew = state.openId === null && isEmpty(state.text) ? t.room.newEmpty : null;
  const remaining = state.expiresAt - now;
  const expiringSoon = state.ready && remaining < 10 * 60 * 1000;
  const expiringNow = state.ready && remaining < 5 * 60 * 1000;
  const justRenewed = now - state.renewedAt < 1500;

  /* The clock re-renders the list every second and the list has no cap, so the
     previews are parsed once per change instead of once per tick. Each is a
     prefix of the stored markup, cut mid-tag as often as not; DOMParser closes
     what is dangling and the card shows text. */
  const previews = useMemo(
    () => new Map(state.blocks.map((item) => [item.id, toPlain(item.preview)])),
    [state.blocks],
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
     rewritten for text it did not produce itself. */
  useEffect(() => {
    const el = editorRef.current;
    if (!el || state.repaint === 0) return;
    el.innerHTML = sanitize(state.text);
    paintImages();
  }, [state.repaint]);

  useEffect(() => {
    const urls = blobs.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /* A reconnect has to come back to the same document, and the connection is set
     up once: the snapshot reads which one through a ref rather than tearing the
     socket down every time the tab changes blocks. */
  const openRef = useRef<number | null>(null);
  openRef.current = state.openId;

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const snap = await api.getState(token, openRef.current);
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
    if (!state.ready || state.conflict || state.locked || !dirty) return;
    // A full room refuses anything longer than what it already holds, so writing
    // it out would fail once per keystroke. Shorter still goes: that is the way
    // back under the limit.
    if (full && state.text.length > state.serverText.length) return;
    const pending = state.text;
    const target = state.openId;
    const timer = setTimeout(async () => {
      try {
        const { rev } = await api.putText(token, target, pending, state.serverRev);
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
  }, [state.text, state.serverText, state.serverRev, state.conflict, state.ready, state.locked, full]);

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
      downloadText(toPlain(state.text), `cloudnt-${state.code}.txt`);
    }
    if (event.key === "n") {
      event.preventDefault();
      void saveCurrent();
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
    if (await copyText(toPlain(state.text))) return notify(t.room.copied);
    const el = editorRef.current;
    if (el) getSelection()?.selectAllChildren(el);
    notify(t.room.noClipboardSelected);
  };

  /**
   * The debounce may still be holding the last keystrokes, and everything that
   * follows reads the server's copy. Flushing keeps the two in step.
   */
  const flush = async () => {
    if (!dirty || state.locked) return;
    const { rev } = await api.putText(token, state.openId, state.text, state.serverRev);
    dispatch({ type: "commit", text: state.text, rev });
  };

  /**
   * Moves this device onto a document. Nothing is written and nothing is
   * announced: the others keep whatever they were reading.
   */
  const openBlockDoc = (id: number) =>
    guard(async () => {
      await flush();
      const doc = await api.blockContent(token, id);
      dispatch({ type: "open", id, ...doc });
      setTab("text");
    });

  const openDraft = () =>
    guard(async () => {
      await flush();
      dispatch({ type: "open", id: null, ...state.shadow, locked: false });
      setTab("text");
    });

  /**
   * Saves what the editor holds as a block. Coming from the draft it is a move
   * rather than a copy — the server empties the draft — and this tab follows the
   * text onto the block it just made.
   */
  const saveCurrent = async () => {
    // The same reason the button carries, said out loud: reached by the shortcut
    // there is no greyed-out button to look at.
    if (noPin) return notify(full ? t.room.fullPin : noPin);
    if (state.locked) return duplicate();
    await guard(async () => {
      await flush();
      const { id, rev, draftRev } = await api.saveBlock(token, state.text, false);
      dispatch({ type: "open", id, text: state.text, rev, locked: false });
      dispatch({ type: "shadow", doc: { text: "", rev: draftRev } });
      setTab("text");
      notify(t.room.pinned);
    });
  };

  /**
   * A locked block cannot be edited, so editing it means taking a copy first.
   * The copy lands on the draft, where the usual write path takes over.
   */
  const duplicate = () =>
    guard(async () => {
      const text = state.text;
      dispatch({ type: "open", id: null, ...state.shadow, locked: false });
      dispatch({ type: "edit", text, external: true });
      setTab("text");
    });

  /**
   * Puts the editor back to a blank page. Whatever the draft held is saved as a
   * block on the way out, so clearing never costs anyone their text.
   */
  const startNew = () =>
    guard(async () => {
      await flush();
      const held = state.openId === null ? state.text : state.shadow.text;
      if (isEmpty(held)) {
        dispatch({ type: "open", id: null, ...state.shadow, locked: false });
      } else {
        const { draftRev } = await api.saveBlock(token, held, false);
        dispatch({ type: "open", id: null, text: "", rev: draftRev, locked: false });
      }
      setTab("text");
    });

  const copyBlock = (id: number) =>
    guard(async () => {
      const { text } = await api.blockContent(token, id);
      notify((await copyText(toPlain(text))) ? t.room.blockCopied : t.room.noClipboard);
    });

  /** The old single-buffer behaviour, kept as one deliberate action. */
  const copyAll = () =>
    guard(async () => {
      const bodies = await Promise.all(state.blocks.map((item) => api.blockContent(token, item.id)));
      const all = [state.text, ...bodies.map((body) => body.text)]
        .map(toPlain)
        .filter((text) => text !== "")
        .join("\n\n");
      notify((await copyText(all)) ? t.room.allCopied : t.room.noClipboard);
    });

  const keepMine = async () => {
    if (!state.conflict) return;
    try {
      const { rev } = await api.putText(token, state.openId, state.text, state.conflict.rev, true);
      dispatch({ type: "commit", text: state.text, rev });
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
    dispatch({ type: "edit", text: serialize(el) });
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
            data-tip={noNew ?? t.room.newTip}
            disabled={noNew !== null}
            onClick={() => void startNew()}
          >
            <Icon name="plus" />
            <span class="btn-label">{t.room.new}</span>
          </button>
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
            data-tip={noPin ?? (state.locked ? t.room.duplicateTip : t.room.pinTip)}
            disabled={noPin !== null}
            onClick={() => void saveCurrent()}
          >
            <Icon name={state.locked ? "copy" : "pin"} />
            <span class="btn-label">{state.locked ? t.room.duplicate : t.room.pin}</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            data-tip={t.room.downloadTip}
            onClick={() => downloadText(toPlain(state.text), `cloudnt-${state.code}.txt`)}
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
                          // Own echo does not repaint, to avoid overwriting ongoing typing.
                          // Wiping is the exception: the editor must end up empty.
                          dispatch({ type: "open", id: null, text: "", rev, locked: false });
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

            <span class="room-bar-spacer" />

            {/* Which document this device holds. Another one may be on a
                different block, and only this chip says which is which. */}
            {openBlock ? (
              <span class="doc doc-block">
                <Icon name={state.locked ? "lock" : "pin"} />
                {t.room.editingBlock(formatAge(openBlock.createdAt))}
                {state.locked ? <span class="tag">{t.room.lockedBlock}</span> : null}
                <button
                  type="button"
                  class="icon-btn"
                  title={t.room.closeBlock}
                  onClick={() => void openDraft()}
                >
                  <Icon name="close" />
                </button>
              </span>
            ) : (
              <span class="doc">{t.room.draftDoc}</span>
            )}
          </div>
          <div
            ref={editorRef}
            class="editor"
            contentEditable={!state.locked}
            role="textbox"
            aria-multiline="true"
            aria-readonly={state.locked}
            spellcheck={false}
            aria-label={t.room.editorLabel}
            data-placeholder={t.room.editorPlaceholder}
            data-empty={isEmpty(state.text) ? "" : undefined}
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
              {t.room.tabBlocks}
              <span class="tab-n">{state.blocks.length}</span>
              {/* Something landed while this tab was on the other one. */}
              {tab !== "text" && state.unseen.size > 0 ? (
                <span class="fresh-dot" title={t.room.newTag} />
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "files"}
              class={`tab${tab === "files" ? " active" : ""}`}
              onClick={() => {
                setTab("files");
                dispatch({ type: "seenFiles" });
              }}
            >
              {t.room.tabFiles}
              <span class="tab-n">{state.files.length}</span>
              {tab !== "files" && state.unseenFiles.size > 0 ? (
                <span class="fresh-dot" title={t.room.newTag} />
              ) : null}
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
              state.blocks.length === 0 ? (
                <p class="empty">{t.room.emptyBlocks}</p>
              ) : (
                state.blocks.map((item) => {
                  const open = item.id === state.openId;
                  const fresh = state.unseen.has(item.id);
                  const mine = item.authorId === state.memberId || isOwner;
                  return (
                    <article
                      key={item.id}
                      class={`entry${open ? " open" : ""}${fresh ? " fresh" : ""}`}
                    >
                      <pre class="entry-preview">{previews.get(item.id)}</pre>
                      <div class="entry-foot">
                        <span class="entry-meta">
                          {open ? `${t.room.openTag} · ` : ""}
                          {formatSize(item.bytes)} · {formatAge(item.createdAt)}
                        </span>
                        {fresh ? <span class="fresh-dot" title={t.room.newTag} /> : null}
                        <span class="room-bar-spacer" />
                        <button
                          type="button"
                          class="icon-btn"
                          title={t.room.copyBlock}
                          onClick={() => void copyBlock(item.id)}
                        >
                          <Icon name="copy" />
                        </button>
                        {mine || item.locked ? (
                          <button
                            type="button"
                            class={`icon-btn${item.locked ? " on" : ""}`}
                            title={item.locked ? t.room.unlockBlock : t.room.lockBlock}
                            disabled={!mine}
                            onClick={() =>
                              void guard(() => api.lockBlock(token, item.id, !item.locked))
                            }
                          >
                            <Icon name={item.locked ? "lock" : "unlock"} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          class="icon-btn"
                          title={t.room.openBlock}
                          disabled={open}
                          onClick={() => void openBlockDoc(item.id)}
                        >
                          <Icon name="history" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          title={t.room.removeBlock}
                          disabled={item.locked && !mine}
                          onClick={() => void guard(() => api.removeBlock(token, item.id))}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </article>
                  );
                })
              )
            ) : state.files.length === 0 ? (
              <p class="empty">{t.room.emptyFiles}</p>
            ) : (
              state.files.map((item) => {
                const percent = Math.round((item.received / item.chunks) * 100);
                const error = failed[item.id];
                const ready = item.status === "ready";
                return (
                  <article
                    key={item.id}
                    class={`entry${state.unseenFiles.has(item.id) ? " fresh" : ""}`}
                  >
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
          {formatBytes(state.text)} ·{" "}
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
            {confirming.alt ? (
              <button
                type="button"
                class="btn btn-danger"
                onClick={() => {
                  confirming.alt?.run();
                  setConfirming(null);
                }}
              >
                {confirming.alt.label}
              </button>
            ) : null}
            <button
              type="button"
              class={`btn ${confirming.safe ? "btn-primary" : "btn-danger"}`}
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
