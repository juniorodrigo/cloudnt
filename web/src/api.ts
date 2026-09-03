import { currentLang, strings } from "./i18n.ts";

/**
 * Identifies this tab, not this member: the same browser holds one token per
 * room, so two tabs are the same member and would each take the other's writes
 * for an echo of their own — and answer them with a write back, forever.
 */
export const CLIENT_ID = crypto.randomUUID();

export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 5;

export type Member = {
  id: string;
  role: "owner" | "member";
  fingerprint: string;
  joinedAt: number;
  online: boolean;
};

export type PendingRequest = {
  id: string;
  fingerprint: string;
  ip: string;
  userAgent: string;
  createdAt: number;
};

/** The body is fetched with blockContent() only when an action actually needs it. */
export type BlockItem = {
  id: number;
  createdAt: number;
  updatedAt: number;
  rev: number;
  bytes: number;
  preview: string;
  locked: boolean;
  authorId: string;
};

export type FileItem = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ready";
  authorId: string;
  createdAt: number;
  chunkSize: number;
  chunks: number;
  received: number;
};

/** One budget for the draft, the saved blocks and the files together. */
export type Usage = { used: number; limit: number };

/** What the editor is on: the shared draft, or one block with a rev of its own. */
export type Doc = { text: string; rev: number };
export type OpenBlock = Doc & { id: number; locked: boolean };

export type Snapshot = {
  code: string;
  role: "owner" | "member";
  memberId: string;
  fingerprint: string;
  draft: Doc;
  /** The block this tab asked for, or null when it is on the draft. */
  open: OpenBlock | null;
  createdAt: number;
  lastActivity: number;
  expiresAt: number;
  autoApproveUntil: number;
  members: Member[];
  blocks: BlockItem[];
  files: FileItem[];
  usage: Usage;
  pending: PendingRequest[];
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  // The app's own choice, not the browser's: they differ as soon as anyone uses
  // the selector, and the errors end up in the same toasts as everything else.
  headers.set("x-lang", currentLang());
  headers.set("x-client", CLIENT_ID);

  const res = await fetch(path, { ...init, headers });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, String(payload.error ?? strings().app.netError), payload);
  }
  return payload as T;
}

export const createRoom = () =>
  request<{ code: string; token: string; expiresAt: number }>("/api/room", { method: "POST" });

export const joinRoom = (code: string) =>
  request<
    | { status: "pending"; pendingId: string; fingerprint: string }
    | { status: "approved"; token: string }
  >(`/api/room/${code}/join`, { method: "POST" });

/** `open` travels because the block a tab is reading is the tab's own state. */
export const getState = (token: string, open: number | null) =>
  request<Snapshot>(open === null ? "/api/state" : `/api/state?open=${open}`, { token });

export const putText = (
  token: string,
  blockId: number | null,
  text: string,
  baseRev: number,
  force = false,
) =>
  request<{ rev: number }>("/api/text", {
    method: "POST",
    token,
    body: JSON.stringify({ blockId, text, baseRev, force }),
  });

const post = <T>(path: string, token: string, body?: unknown) =>
  request<T>(path, { method: "POST", token, body: body ? JSON.stringify(body) : undefined });

export const saveBlock = (token: string, text: string, locked: boolean) =>
  post<{ id: number; rev: number; draftRev: number }>("/api/block", token, { text, locked });
export const blockContent = (token: string, id: number) =>
  request<{ text: string; rev: number; locked: boolean }>(`/api/block/${id}`, { token });
export const lockBlock = (token: string, id: number, locked: boolean) =>
  post("/api/block/lock", token, { id, locked });
export const removeBlock = (token: string, id: number) => post("/api/block/remove", token, { id });
export const clearRoom = (token: string) => post<{ rev: number }>("/api/clear", token);
export const keepAlive = (token: string) => post<{ ok: true }>("/api/keepalive", token);
export const approve = (token: string, pendingId: string) => post("/api/approve", token, { pendingId });
export const reject = (token: string, pendingId: string) => post("/api/reject", token, { pendingId });
export const kick = (token: string, memberId: string) => post("/api/kick", token, { memberId });
export const rotate = (token: string) => post<{ code: string }>("/api/rotate", token);
export const closeRoom = (token: string) => post("/api/close", token);
export const setAutoApprove = (token: string, minutes: number) =>
  post<{ until: number }>("/api/auto-approve", token, { minutes });

// ── files ────────────────────────────────────────────────────────────────────

export const createFile = (token: string, name: string, size: number) =>
  post<{ id: string; name: string; chunkSize: number; chunks: number }>("/api/file", token, { name, size });

export const fileStatus = (token: string, id: string) =>
  request<{ status: string; chunks: number; chunkSize: number; received: number[] }>(
    `/api/file/${id}/status`,
    { token },
  );

/** Raw body, so it cannot go through `request`: the chunk is not JSON. */
export async function putChunk(token: string, id: string, n: number, chunk: Blob): Promise<void> {
  const res = await fetch(`/api/file/${id}/chunk/${n}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "x-lang": currentLang() },
    body: chunk,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, String(payload.error ?? strings().app.netError), payload);
  }
}

export const completeFile = (token: string, id: string, sha256: string) =>
  post<{ ok: true; sha256: string }>(`/api/file/${id}/complete`, token, { sha256 });

export const removeFile = (token: string, id: string) => post(`/api/file/${id}/remove`, token);

export const downloadTicket = (token: string, id: string) =>
  post<{ ticket: string }>(`/api/file/${id}/ticket`, token);
