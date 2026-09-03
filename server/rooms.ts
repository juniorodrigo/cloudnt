import { db, type BlockItem, type MemberRow, type RoomRow } from "./db.ts";
import * as bus from "./bus.ts";
import * as files from "./files.ts";
import * as usage from "./usage.ts";
import { makeFingerprint } from "./fingerprint.ts";
import {
  BLOCK_PREVIEW_CHARS,
  CODE_ALPHABET,
  CODE_LENGTH,
  LIMITS,
  PENDING_TTL_MS,
  REJECT_UNDO_MS,
  ROTATE_AFTER_DISTINCT_REJECTS,
  ROTATE_WINDOW_MS,
  TTL_ABSOLUTE_MS,
  TTL_IDLE_MS,
} from "./config.ts";

export const roomTopic = (roomId: string) => `room:${roomId}`;
export const ownerTopic = (roomId: string) => `room:${roomId}:owner`;
export const waitTopic = (pendingId: string) => `wait:${pendingId}`;

export type Pending = {
  id: string;
  roomId: string;
  fingerprint: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  rejectedAt: number | null;
};

const pendings = new Map<string, Pending>();
const rejectLog = new Map<string, { fingerprint: string; at: number }[]>();

// ── identifiers ──────────────────────────────────────────────────────────────

function randomBytesUrl(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

const newId = () => randomBytesUrl(12);
const newToken = () => randomBytesUrl(32);

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/**
 * The code is not a secret: access control is enforced by approval. Even so it
 * is generated with CSPRNG and rejection sampling, to avoid biasing the space.
 */
function randomCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  const buf = new Uint8Array(CODE_LENGTH * 2);
  while (out.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= limit) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

function allocateCode(): string {
  for (let i = 0; i < 50; i++) {
    const code = randomCode();
    const taken = db.query("SELECT 1 FROM rooms WHERE code = ?").get(code);
    if (!taken) return code;
  }
  throw new Error("no free codes available");
}

// ── queries ──────────────────────────────────────────────────────────────────

export function roomCount(): number {
  const row = db.query("SELECT COUNT(*) AS n FROM rooms").get() as { n: number };
  return row.n;
}

export function expiresAt(room: RoomRow): number {
  return Math.min(room.last_activity + TTL_IDLE_MS, room.created_at + TTL_ABSOLUTE_MS);
}

/**
 * The periodic sweep frees space, but the real guarantee is here: every read
 * checks the TTL before serving, so a read never returns stale content even if
 * the sweep is behind.
 */
function checkExpiry(room: RoomRow | null): RoomRow | null {
  if (!room) return null;
  if (Date.now() >= expiresAt(room)) {
    destroyRoom(room, "expired");
    return null;
  }
  return room;
}

export function roomByCode(code: string): RoomRow | null {
  const row = db.query("SELECT * FROM rooms WHERE code = ?").get(code.toLowerCase()) as RoomRow | null;
  return checkExpiry(row);
}

export function roomById(id: string): RoomRow | null {
  const row = db.query("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | null;
  return checkExpiry(row);
}

export function memberByToken(token: string): { room: RoomRow; member: MemberRow } | null {
  const member = db
    .query("SELECT * FROM members WHERE token_hash = ?")
    .get(hashToken(token)) as MemberRow | null;
  if (!member) return null;
  const room = roomById(member.room_id);
  if (!room) return null;
  return { room, member };
}

export function membersOf(roomId: string): MemberRow[] {
  return db
    .query("SELECT * FROM members WHERE room_id = ? ORDER BY joined_at")
    .all(roomId) as MemberRow[];
}

/**
 * The list is unbounded now, so the blocks travel as previews: shipping every
 * full body would put the whole room's text on the wire again on each change,
 * and on the initial snapshot of every member who joins.
 */
export function blocksOf(roomId: string): BlockItem[] {
  const rows = db
    .query(
      `SELECT id, created_at, updated_at, rev, author_id, locked,
              LENGTH(CAST(content AS BLOB)) AS bytes, SUBSTR(content, 1, ?) AS preview
         FROM blocks WHERE room_id = ? ORDER BY id DESC`,
    )
    .all(BLOCK_PREVIEW_CHARS, roomId) as {
    id: number;
    created_at: number;
    updated_at: number;
    rev: number;
    author_id: string;
    locked: number;
    bytes: number;
    preview: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    rev: r.rev,
    bytes: r.bytes,
    preview: r.preview,
    locked: r.locked === 1,
    authorId: r.author_id,
  }));
}

export type BlockDoc = { id: number; content: string; rev: number; locked: number; author_id: string };

export function blockById(roomId: string, id: number): BlockDoc | null {
  return db
    .query("SELECT id, content, rev, locked, author_id FROM blocks WHERE room_id = ? AND id = ?")
    .get(roomId, id) as BlockDoc | null;
}

export function pendingsOf(roomId: string): Pending[] {
  return [...pendings.values()]
    .filter((p) => p.roomId === roomId && !p.rejectedAt)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function pendingById(id: string): Pending | undefined {
  return pendings.get(id);
}

// ── presence ─────────────────────────────────────────────────────────────────

/** Presence feeds the online indicator; never touches the TTL. */
function connectedIds(roomId: string): Set<string> {
  const ids = new Set<string>();
  for (const sub of bus.subscribersOf(roomTopic(roomId))) {
    if (sub.meta.memberId) ids.add(sub.meta.memberId);
  }
  return ids;
}

export function roster(roomId: string) {
  const online = connectedIds(roomId);
  return membersOf(roomId).map((m) => ({
    id: m.id,
    role: m.role,
    fingerprint: m.fingerprint,
    joinedAt: m.joined_at,
    online: online.has(m.id),
  }));
}

export function broadcastRoster(roomId: string): void {
  bus.publish(roomTopic(roomId), { type: "roster", members: roster(roomId) });
}

export function broadcastPendings(roomId: string): void {
  bus.publish(ownerTopic(roomId), {
    type: "pending",
    pending: pendingsOf(roomId).map((p) => ({
      id: p.id,
      fingerprint: p.fingerprint,
      ip: p.ip,
      userAgent: p.userAgent,
      createdAt: p.createdAt,
    })),
  });
}

// ── activity and lifecycle ───────────────────────────────────────────────────

/**
 * Only mutating or consuming content resets the TTL. Heartbeats, reconnects,
 * and presence updates do not: otherwise a tab left open on Friday would keep
 * the room alive until Monday.
 */
export function touch(room: RoomRow): RoomRow {
  const now = Date.now();
  db.run("UPDATE rooms SET last_activity = ? WHERE id = ?", [now, room.id]);
  const updated = { ...room, last_activity: now };
  bus.publish(roomTopic(room.id), {
    type: "expiry",
    lastActivity: now,
    expiresAt: expiresAt(updated),
  });
  return updated;
}

export function destroyRoom(room: RoomRow, reason: "expired" | "closed"): void {
  for (const [id, p] of pendings) {
    if (p.roomId === room.id) {
      bus.closeTopic(waitTopic(id), { type: "closed", reason });
      pendings.delete(id);
    }
  }
  rejectLog.delete(room.id);
  bus.closeTopic(ownerTopic(room.id), { type: "closed", reason });
  bus.closeTopic(roomTopic(room.id), { type: "closed", reason });
  db.run("DELETE FROM rooms WHERE id = ?", [room.id]);
  // The index row is gone the moment the room is; the bytes follow on their own
  // so that an unlink that fails cannot keep a dead room readable.
  void files.removeRoomFiles(room.id);
}

export function sweep(): void {
  const now = Date.now();
  const rows = db.query("SELECT * FROM rooms").all() as RoomRow[];
  for (const room of rows) {
    if (now >= expiresAt(room)) destroyRoom(room, "expired");
  }
  for (const [id, p] of pendings) {
    const stale = now - p.createdAt > PENDING_TTL_MS;
    const undoWindowPassed = p.rejectedAt !== null && now - p.rejectedAt > REJECT_UNDO_MS;
    if (stale || undoWindowPassed) {
      bus.closeTopic(waitTopic(id), { type: "closed", reason: "expired" });
      pendings.delete(id);
    }
  }
}

// ── creation and joining ─────────────────────────────────────────────────────

export function createRoom(ip: string, userAgent: string) {
  const now = Date.now();
  const room: RoomRow = {
    id: newId(),
    code: allocateCode(),
    text: "",
    rev: 0,
    created_at: now,
    last_activity: now,
    auto_approve_until: 0,
    bytes_moved: 0,
  };
  db.run(
    "INSERT INTO rooms (id, code, text, rev, created_at, last_activity) VALUES (?, ?, '', 0, ?, ?)",
    [room.id, room.code, now, now],
  );

  const token = newToken();
  db.run(
    `INSERT INTO members (id, room_id, token_hash, fingerprint, role, ip, user_agent, joined_at)
     VALUES (?, ?, ?, ?, 'owner', ?, ?, ?)`,
    [newId(), room.id, hashToken(token), makeFingerprint(), ip, userAgent.slice(0, 200), now],
  );

  return { room, token };
}

export type JoinResult =
  | { status: "approved"; token: string }
  | { status: "pending"; pendingId: string; fingerprint: string }
  | { status: "full" };

export function join(room: RoomRow, ip: string, userAgent: string): JoinResult {
  if (membersOf(room.id).length >= LIMITS.membersPerRoom) return { status: "full" };

  const pending: Pending = {
    id: newId(),
    roomId: room.id,
    fingerprint: makeFingerprint(),
    ip,
    userAgent: userAgent.slice(0, 200),
    createdAt: Date.now(),
    rejectedAt: null,
  };

  if (Date.now() < room.auto_approve_until) {
    const token = admit(room, pending);
    return { status: "approved", token };
  }

  pendings.set(pending.id, pending);
  broadcastPendings(room.id);
  return { status: "pending", pendingId: pending.id, fingerprint: pending.fingerprint };
}

function admit(room: RoomRow, pending: Pending): string {
  const token = newToken();
  db.run(
    `INSERT INTO members (id, room_id, token_hash, fingerprint, role, ip, user_agent, joined_at)
     VALUES (?, ?, ?, ?, 'member', ?, ?, ?)`,
    [newId(), room.id, hashToken(token), pending.fingerprint, pending.ip, pending.userAgent, Date.now()],
  );
  return token;
}

export function approve(room: RoomRow, pendingId: string): boolean {
  const pending = pendings.get(pendingId);
  if (!pending || pending.roomId !== room.id) return false;
  if (membersOf(room.id).length >= LIMITS.membersPerRoom) return false;

  const token = admit(room, pending);
  pendings.delete(pendingId);

  bus.publish(waitTopic(pendingId), { type: "approved", token, code: room.code });
  broadcastPendings(room.id);
  broadcastRoster(room.id);
  touch(room);
  return true;
}

/** Rejection can be undone for 30 s: the visitor keeps listening. */
export function reject(room: RoomRow, pendingId: string): boolean {
  const pending = pendings.get(pendingId);
  if (!pending || pending.roomId !== room.id || pending.rejectedAt) return false;

  pending.rejectedAt = Date.now();
  bus.publish(waitTopic(pendingId), { type: "rejected", undoWindowMs: REJECT_UNDO_MS });
  broadcastPendings(room.id);

  const log = (rejectLog.get(room.id) ?? []).filter((e) => Date.now() - e.at < ROTATE_WINDOW_MS);
  log.push({ fingerprint: pending.fingerprint, at: Date.now() });
  rejectLog.set(room.id, log);

  if (new Set(log.map((e) => e.fingerprint)).size >= ROTATE_AFTER_DISTINCT_REJECTS) {
    rotateCode(room);
    rejectLog.delete(room.id);
  }
  return true;
}

export function kick(room: RoomRow, memberId: string): boolean {
  const member = db
    .query("SELECT * FROM members WHERE id = ? AND room_id = ?")
    .get(memberId, room.id) as MemberRow | null;
  if (!member || member.role === "owner") return false;

  db.run("DELETE FROM members WHERE id = ?", [memberId]);
  for (const sub of bus.subscribersOf(roomTopic(room.id))) {
    if (sub.meta.memberId !== memberId) continue;
    sub.send(JSON.stringify({ type: "kicked" }));
    bus.unsubscribe(sub);
    sub.close();
  }
  broadcastRoster(room.id);
  return true;
}

export function rotateCode(room: RoomRow): string {
  const code = allocateCode();
  db.run("UPDATE rooms SET code = ? WHERE id = ?", [code, room.id]);
  bus.publish(roomTopic(room.id), { type: "code", code });
  bus.publish(ownerTopic(room.id), { type: "code", code });
  return code;
}

export function setAutoApprove(room: RoomRow, minutes: number): number {
  const until = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
  db.run("UPDATE rooms SET auto_approve_until = ? WHERE id = ?", [until, room.id]);
  bus.publish(ownerTopic(room.id), { type: "autoApprove", until });
  return until;
}

// ── text ─────────────────────────────────────────────────────────────────────

/**
 * Restoring a block into the editor and then pasting over it would otherwise
 * snapshot content that is already on the list.
 */
function alreadySaved(roomId: string, content: string): boolean {
  return (
    db.query("SELECT 1 FROM blocks WHERE room_id = ? AND content = ? LIMIT 1").get(roomId, content) !==
    null
  );
}

/**
 * Enough of a strip for the anchor below to work; the client is what renders
 * this markup, and it sanitizes on the way in and on the way out. An image
 * leaves its file id behind so a document made of images still anchors.
 */
const plainOf = (html: string) =>
  html
    .replace(/<[^>]*\bdata-file="([^"]*)"[^>]*>/g, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The previous text is kept as a block only when something else was pasted over
 * it. Incremental typing preserves the prefix, so it does not pollute the list
 * with intermediate states. The comparison ignores tags: markup closes right
 * after the first characters, so a raw prefix would stop matching on the very
 * next keystroke.
 */
function replacesText(roomId: string, previous: string, next: string): boolean {
  const before = plainOf(previous);
  if (before === "") return false;
  // Emptying the editor by hand is not a replacement, it is a member throwing
  // the text away. Saving it anyway answers the question the New button asks.
  if (plainOf(next) === "") return false;
  const anchor = before.slice(0, Math.min(24, before.length));
  if (plainOf(next).includes(anchor)) return false;
  return !alreadySaved(roomId, previous);
}

/**
 * Nothing prunes the list: blocks count against the room's storage quota like
 * everything else, so it grows until the gigabyte runs out and the owner deletes
 * what they no longer need.
 */
function insertBlock(roomId: string, content: string, authorId: string, locked: boolean): number {
  const now = Date.now();
  const result = db.run(
    `INSERT INTO blocks (room_id, content, created_at, updated_at, rev, locked, author_id)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [roomId, content, now, now, locked ? 1 : 0, authorId],
  );
  return Number(result.lastInsertRowid);
}

export function broadcastUsage(roomId: string): void {
  bus.publish(roomTopic(roomId), { type: "usage", ...usage.roomUsage(roomId) });
}

function broadcastBlocks(roomId: string): void {
  bus.publish(roomTopic(roomId), { type: "blocks", items: blocksOf(roomId) });
}

type Draft = { text: string; rev: number };

const liveDraft = (roomId: string) =>
  db.query("SELECT text, rev FROM rooms WHERE id = ?").get(roomId) as Draft;

export type WriteResult =
  | { ok: true; rev: number }
  | { ok: false; reason: "conflict"; text: string; rev: number }
  | { ok: false; reason: "gone" | "locked" | "too_large" | "full" };

/**
 * One entry point for both kinds of document: `blockId` names the target, so
 * two devices can be writing to different ones at the same time and neither
 * drags the other along. `null` is the shared draft the room starts on.
 */
export function write(
  room: RoomRow,
  member: MemberRow,
  blockId: number | null,
  text: string,
  baseRev: number,
  origin: string,
  force: boolean,
): WriteResult {
  if (Buffer.byteLength(text, "utf8") > LIMITS.textBytesPerRoom) {
    return { ok: false, reason: "too_large" };
  }
  return blockId === null
    ? writeDraft(room, member, text, baseRev, origin, force)
    : writeBlock(room, blockId, text, baseRev, origin, force);
}

function writeDraft(
  room: RoomRow,
  member: MemberRow,
  text: string,
  baseRev: number,
  origin: string,
  force: boolean,
): WriteResult {
  const current = liveDraft(room.id);
  if (!force && baseRev !== current.rev) {
    return { ok: false, reason: "conflict", text: current.text, rev: current.rev };
  }
  if (text === current.text) return { ok: true, rev: current.rev };

  const snapshots = replacesText(room.id, current.text, text);
  // The old text only frees its bytes when it is overwritten outright; when it
  // is kept as a block the room pays for both at once.
  const before = snapshots ? 0 : Buffer.byteLength(current.text, "utf8");
  if (!usage.fits(room.id, Buffer.byteLength(text, "utf8") - before)) {
    return { ok: false, reason: "full" };
  }

  if (snapshots) insertBlock(room.id, current.text, member.id, false);
  const rev = current.rev + 1;
  db.run("UPDATE rooms SET text = ?, rev = ? WHERE id = ?", [text, rev, room.id]);

  bus.publish(roomTopic(room.id), { type: "draft", text, rev, origin });
  if (snapshots) broadcastBlocks(room.id);
  broadcastUsage(room.id);
  touch(room);
  return { ok: true, rev };
}

function writeBlock(
  room: RoomRow,
  id: number,
  text: string,
  baseRev: number,
  origin: string,
  force: boolean,
): WriteResult {
  const block = blockById(room.id, id);
  if (!block) return { ok: false, reason: "gone" };
  if (block.locked === 1) return { ok: false, reason: "locked" };
  if (!force && baseRev !== block.rev) {
    return { ok: false, reason: "conflict", text: block.content, rev: block.rev };
  }
  if (text === block.content) return { ok: true, rev: block.rev };

  const growth = Buffer.byteLength(text, "utf8") - Buffer.byteLength(block.content, "utf8");
  if (!usage.fits(room.id, growth)) return { ok: false, reason: "full" };

  const rev = block.rev + 1;
  const now = Date.now();
  db.run("UPDATE blocks SET content = ?, rev = ?, updated_at = ? WHERE id = ?", [text, rev, now, id]);

  // The whole body travels so that everyone else can redraw the card from it;
  // sending the list again on every keystroke would ship the entire room.
  bus.publish(roomTopic(room.id), { type: "block", id, text, rev, updatedAt: now, origin });
  broadcastUsage(room.id);
  touch(room);
  return { ok: true, rev };
}

export type SaveResult =
  /** `draftRev` so the caller knows where the draft it just emptied stands. */
  | { ok: true; id: number; rev: number; draftRev: number }
  | { ok: false; reason: "nothing" | "too_large" | "full" };

/**
 * Turns a text into a block of its own. The automatic snapshot only fires when
 * a paste replaces the previous one, so without this there is no way to keep two
 * texts side by side without overwriting one of them first.
 */
export function saveBlock(
  room: RoomRow,
  member: MemberRow,
  text: string,
  locked: boolean,
): SaveResult {
  if (Buffer.byteLength(text, "utf8") > LIMITS.textBytesPerRoom) {
    return { ok: false, reason: "too_large" };
  }
  if (plainOf(text) === "") return { ok: false, reason: "nothing" };

  // Saving what the draft holds moves it rather than copying it: the block is
  // where the text lives from now on, and leaving a twin behind is what used to
  // have the next member paste over content that looked already saved.
  const draft = liveDraft(room.id);
  const promotes = text === draft.text;
  const emptyDraft = () => {
    if (!promotes) return draft.rev;
    const rev = draft.rev + 1;
    db.run("UPDATE rooms SET text = '', rev = ? WHERE id = ?", [rev, room.id]);
    // No origin: the tab that saved has already moved on to the block, and every
    // other one is still looking at a draft that no longer holds anything.
    bus.publish(roomTopic(room.id), { type: "draft", text: "", rev, origin: "" });
    return rev;
  };

  // Saving the same text twice hands back the block that already holds it, so
  // the caller lands on it either way and the room does not grow a twin.
  const twin = db
    .query("SELECT id, rev FROM blocks WHERE room_id = ? AND content = ? LIMIT 1")
    .get(room.id, text) as { id: number; rev: number } | null;
  if (twin) {
    const draftRev = emptyDraft();
    if (promotes) {
      broadcastUsage(room.id);
      touch(room);
    }
    return { ok: true, id: twin.id, rev: twin.rev, draftRev };
  }

  if (!usage.fits(room.id, promotes ? 0 : Buffer.byteLength(text, "utf8"))) {
    return { ok: false, reason: "full" };
  }

  const id = insertBlock(room.id, text, member.id, locked);
  const draftRev = emptyDraft();
  broadcastBlocks(room.id);
  broadcastUsage(room.id);
  touch(room);
  return { ok: true, id, rev: 0, draftRev };
}

/** Only the block's author or the room owner: a lock nobody can lift is a bug. */
const mayGovern = (block: BlockDoc, member: MemberRow) =>
  block.author_id === member.id || member.role === "owner";

export function lockBlock(
  room: RoomRow,
  member: MemberRow,
  id: number,
  locked: boolean,
): "ok" | "gone" | "denied" {
  const block = blockById(room.id, id);
  if (!block) return "gone";
  if (!mayGovern(block, member)) return "denied";

  db.run("UPDATE blocks SET locked = ? WHERE id = ?", [locked ? 1 : 0, id]);
  broadcastBlocks(room.id);
  touch(room);
  return "ok";
}

export function removeBlock(room: RoomRow, member: MemberRow, id: number): "ok" | "gone" | "denied" {
  const block = blockById(room.id, id);
  if (!block) return "gone";
  // Deleting a locked block would undo the lock the long way round.
  if (block.locked === 1 && !mayGovern(block, member)) return "denied";

  db.run("DELETE FROM blocks WHERE id = ?", [id]);
  broadcastBlocks(room.id);
  broadcastUsage(room.id);
  touch(room);
  return "ok";
}

/** The only immediate and irreversible deletion: the emergency exit. */
export function clearRoom(room: RoomRow, origin: string): number {
  const current = liveDraft(room.id);
  const rev = current.rev + 1;
  db.run("UPDATE rooms SET text = '', rev = ? WHERE id = ?", [rev, room.id]);
  db.run("DELETE FROM blocks WHERE room_id = ?", [room.id]);

  bus.publish(roomTopic(room.id), { type: "draft", text: "", rev, origin });
  bus.publish(roomTopic(room.id), { type: "blocks", items: [] });
  broadcastUsage(room.id);
  touch(room);
  return rev;
}

// ── client snapshot ──────────────────────────────────────────────────────────

/**
 * `openId` is the device's own: it says which block that tab is looking at so
 * the reconnect comes back with its body, and nothing about it is stored.
 */
export function snapshot(room: RoomRow, member: MemberRow, openId: number | null) {
  const fresh = db.query("SELECT * FROM rooms WHERE id = ?").get(room.id) as RoomRow;
  const open = openId === null ? null : blockById(room.id, openId);
  return {
    code: fresh.code,
    role: member.role,
    memberId: member.id,
    fingerprint: member.fingerprint,
    draft: { text: fresh.text, rev: fresh.rev },
    open: open && { id: open.id, text: open.content, rev: open.rev, locked: open.locked === 1 },
    createdAt: fresh.created_at,
    lastActivity: fresh.last_activity,
    expiresAt: expiresAt(fresh),
    autoApproveUntil: fresh.auto_approve_until,
    members: roster(room.id),
    blocks: blocksOf(room.id),
    files: files.listFiles(room.id),
    usage: usage.roomUsage(room.id),
    pending:
      member.role === "owner"
        ? pendingsOf(room.id).map((p) => ({
            id: p.id,
            fingerprint: p.fingerprint,
            ip: p.ip,
            userAgent: p.userAgent,
            createdAt: p.createdAt,
          }))
        : [],
  };
}
