import { mkdir, open, rm, stat } from "node:fs/promises";
import { db, type FileRow } from "./db.ts";
import { CHUNK_SIZE, FILES_DIR, LIMITS } from "./config.ts";

/**
 * Ids are CSPRNG base64url, but they arrive from the URL, so they are matched
 * against the alphabet before ever reaching a path: nothing user-supplied is
 * allowed to walk out of FILES_DIR.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const roomDir = (roomId: string) => `${FILES_DIR}/${roomId}`;
const filePath = (roomId: string, fileId: string) => `${roomDir(roomId)}/${fileId}`;

function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

/**
 * Control characters would forge a Content-Disposition header and separators
 * would let a name escape the directory. The name is metadata only; the path is
 * always the id.
 */
function safeName(raw: string): string {
  const name = raw.replace(CONTROL_CHARS, "").replace(/[/\\]/g, "_").trim().slice(0, 180);
  return name === "" || name === "." || name === ".." ? "archivo" : name;
}

// ── queries ──────────────────────────────────────────────────────────────────

export function fileById(roomId: string, fileId: string): FileRow | null {
  if (!ID_RE.test(fileId)) return null;
  return db
    .query("SELECT * FROM files WHERE id = ? AND room_id = ?")
    .get(fileId, roomId) as FileRow | null;
}

export function receivedChunks(fileId: string): number[] {
  const rows = db
    .query("SELECT n FROM file_chunks WHERE file_id = ? ORDER BY n")
    .all(fileId) as { n: number }[];
  return rows.map((r) => r.n);
}

export function listFiles(roomId: string) {
  const rows = db
    .query("SELECT * FROM files WHERE room_id = ? ORDER BY created_at")
    .all(roomId) as FileRow[];
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    status: f.status,
    authorId: f.author_id,
    createdAt: f.created_at,
    chunkSize: f.chunk_size,
    chunks: f.chunks,
    received: f.status === "ready" ? f.chunks : receivedChunks(f.id).length,
  }));
}

// ── bandwidth ────────────────────────────────────────────────────────────────

function bytesMoved(roomId: string): number {
  const row = db.query("SELECT bytes_moved FROM rooms WHERE id = ?").get(roomId) as {
    bytes_moved: number;
  } | null;
  return row?.bytes_moved ?? 0;
}

function addBytes(roomId: string, n: number): void {
  db.run("UPDATE rooms SET bytes_moved = bytes_moved + ? WHERE id = ?", [n, roomId]);
}

// ── upload ───────────────────────────────────────────────────────────────────

export type CreateResult =
  | { ok: true; file: FileRow }
  | { ok: false; reason: "too_large" | "too_many" | "quota" };

export async function createFile(
  roomId: string,
  authorId: string,
  rawName: string,
  size: number,
): Promise<CreateResult> {
  if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.fileBytes) {
    return { ok: false, reason: "too_large" };
  }

  const count = db.query("SELECT COUNT(*) AS n FROM files WHERE room_id = ?").get(roomId) as {
    n: number;
  };
  if (count.n >= LIMITS.filesPerRoom) return { ok: false, reason: "too_many" };
  if (bytesMoved(roomId) + size > LIMITS.bytesPerRoom) return { ok: false, reason: "quota" };

  const file: FileRow = {
    id: newId(),
    room_id: roomId,
    name: safeName(rawName),
    size,
    chunk_size: CHUNK_SIZE,
    chunks: Math.max(1, Math.ceil(size / CHUNK_SIZE)),
    sha256: "",
    status: "uploading",
    author_id: authorId,
    created_at: Date.now(),
  };

  await mkdir(roomDir(roomId), { recursive: true });
  await (await open(filePath(roomId, file.id), "w")).close();

  db.run(
    `INSERT INTO files (id, room_id, name, size, chunk_size, chunks, author_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [file.id, roomId, file.name, size, file.chunk_size, file.chunks, authorId, file.created_at],
  );
  return { ok: true, file };
}

/** Length of chunk n, given the declared size. The last one is short. */
function expectedChunkLength(file: FileRow, n: number): number {
  return Math.min(file.chunk_size, file.size - n * file.chunk_size);
}

export type ChunkResult = { ok: true; received: number } | { ok: false; reason: "range" | "quota" };

/**
 * Writes straight into the final file at the chunk's offset, so assembly costs
 * no extra pass and no extra disk. The length is pinned to what the declared
 * size implies: otherwise the quota checked at creation would mean nothing.
 */
export async function writeChunk(file: FileRow, n: number, data: ArrayBuffer): Promise<ChunkResult> {
  if (!Number.isInteger(n) || n < 0 || n >= file.chunks) return { ok: false, reason: "range" };
  if (data.byteLength !== expectedChunkLength(file, n)) return { ok: false, reason: "range" };
  if (bytesMoved(file.room_id) + data.byteLength > LIMITS.bytesPerRoom) {
    return { ok: false, reason: "quota" };
  }

  const handle = await open(filePath(file.room_id, file.id), "r+");
  try {
    await handle.write(new Uint8Array(data), 0, data.byteLength, n * file.chunk_size);
  } finally {
    await handle.close();
  }

  db.run("INSERT OR IGNORE INTO file_chunks (file_id, n) VALUES (?, ?)", [file.id, n]);
  addBytes(file.room_id, data.byteLength);
  return { ok: true, received: receivedChunks(file.id).length };
}

async function hashOnDisk(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest("hex");
}

export type CompleteResult =
  | { ok: true; file: FileRow }
  | { ok: false; reason: "incomplete" | "checksum" };

/**
 * The checksum is recomputed from disk rather than trusted: a chunk can arrive
 * truncated through a proxy and still look complete by count.
 */
export async function completeFile(file: FileRow, sha256: string): Promise<CompleteResult> {
  if (receivedChunks(file.id).length !== file.chunks) return { ok: false, reason: "incomplete" };

  const path = filePath(file.room_id, file.id);
  const onDisk = await stat(path);
  if (onDisk.size !== file.size) {
    await removeFile(file);
    return { ok: false, reason: "checksum" };
  }

  const digest = await hashOnDisk(path);
  if (sha256 && digest !== sha256.toLowerCase()) {
    await removeFile(file);
    return { ok: false, reason: "checksum" };
  }

  db.run("UPDATE files SET status = 'ready', sha256 = ? WHERE id = ?", [digest, file.id]);
  return { ok: true, file: { ...file, status: "ready", sha256: digest } };
}

// ── download and removal ─────────────────────────────────────────────────────

export function readable(file: FileRow) {
  return Bun.file(filePath(file.room_id, file.id));
}

export function countDownload(file: FileRow): void {
  addBytes(file.room_id, file.size);
}

export async function removeFile(file: FileRow): Promise<void> {
  db.run("DELETE FROM files WHERE id = ?", [file.id]);
  await rm(filePath(file.room_id, file.id), { force: true });
}

/** Called when the room dies: the files go with it, per spec §3.2. */
export async function removeRoomFiles(roomId: string): Promise<void> {
  await rm(roomDir(roomId), { recursive: true, force: true });
}
