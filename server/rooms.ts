import { db, type HistoryItem, type MemberRow, type RoomRow } from "./db.ts";
import * as bus from "./bus.ts";
import * as files from "./files.ts";
import * as usage from "./usage.ts";
import { makeFingerprint } from "./fingerprint.ts";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  HISTORY_PREVIEW_CHARS,
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
 * The list is unbounded now, so the entries travel as previews: shipping every
 * full body would put the whole room's text on the wire again on each change,
 * and on the initial snapshot of every member who joins.
 */
export function historyOf(roomId: string): HistoryItem[] {
  return db
    .query(
      `SELECT id, created_at, LENGTH(CAST(content AS BLOB)) AS bytes, SUBSTR(content, 1, ?) AS preview
         FROM history WHERE room_id = ? ORDER BY id DESC`,
    )
    .all(HISTORY_PREVIEW_CHARS, roomId) as HistoryItem[];
}

export function historyContent(roomId: string, id: number): string | null {
  const row = db.query("SELECT content FROM history WHERE room_id = ? AND id = ?").get(roomId, id) as
    | { content: string }
    | null;
  return row?.content ?? null;
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
 * Restoring an entry into the editor and then pasting over it would otherwise
 * snapshot content that is already on the list.
 */
function alreadyPinned(roomId: string, content: string): boolean {
  return (
    db.query("SELECT 1 FROM history WHERE room_id = ? AND content = ? LIMIT 1").get(roomId, content) !==
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
 * The previous text goes to history only when it was replaced from scratch —
 * pasted over or cleared. Incremental typing preserves the prefix, so it does
 * not pollute the list with intermediate states. The comparison ignores tags:
 * markup closes right after the first characters, so a raw prefix would stop
 * matching on the very next keystroke.
 */
function replacesText(roomId: string, previous: string, next: string): boolean {
  const before = plainOf(previous);
  if (before === "") return false;
  const anchor = before.slice(0, Math.min(24, before.length));
  if (plainOf(next).includes(anchor)) return false;
  return !alreadyPinned(roomId, previous);
}

/**
 * Nothing prunes the list: history counts against the room's storage quota like
 * everything else, so it grows until the gigabyte runs out and the owner deletes
 * what they no longer need.
 */
function pushHistory(roomId: string, content: string): void {
  db.run("INSERT INTO history (room_id, content, created_at) VALUES (?, ?, ?)", [
    roomId,
    content,
    Date.now(),
  ]);
}

export function broadcastUsage(roomId: string): void {
  bus.publish(roomTopic(roomId), { type: "usage", ...usage.roomUsage(roomId) });
}

export type SetTextResult =
  | { ok: true; rev: number }
  | { ok: false; reason: "conflict"; text: string; rev: number }
  | { ok: false; reason: "too_large" | "full" };

export function setText(
  room: RoomRow,
  text: string,
  baseRev: number,
  authorId: string,
  force: boolean,
): SetTextResult {
  if (Buffer.byteLength(text, "utf8") > LIMITS.textBytesPerRoom) {
    return { ok: false, reason: "too_large" };
  }
  const current = db.query("SELECT text, rev FROM rooms WHERE id = ?").get(room.id) as {
    text: string;
    rev: number;
  };
  if (!force && baseRev !== current.rev) {
    return { ok: false, reason: "conflict", text: current.text, rev: current.rev };
  }
  if (text === current.text) return { ok: true, rev: current.rev };

  // The old text only frees its bytes when it is overwritten outright; when it
  // is kept as an entry the room pays for both at once.
  const snapshots = replacesText(room.id, current.text, text);
  const growth =
    Buffer.byteLength(text, "utf8") - (snapshots ? 0 : Buffer.byteLength(current.text, "utf8"));
  if (!usage.fits(room.id, growth)) return { ok: false, reason: "full" };

  if (snapshots) pushHistory(room.id, current.text);
  const rev = current.rev + 1;
  db.run("UPDATE rooms SET text = ?, rev = ? WHERE id = ?", [text, rev, room.id]);

  bus.publish(roomTopic(room.id), { type: "text", text, rev, authorId });
  if (snapshots) {
    bus.publish(roomTopic(room.id), { type: "history", items: historyOf(room.id) });
  }
  broadcastUsage(room.id);
  touch(room);
  return { ok: true, rev };
}

/**
 * Pins the live text as an entry of its own. The automatic snapshot only fires
 * when a paste replaces the previous one, so without this there is no way to
 * keep two texts side by side without overwriting one of them first.
 */
export function pinText(room: RoomRow): "ok" | "nothing" | "full" {
  const current = db.query("SELECT text FROM rooms WHERE id = ?").get(room.id) as { text: string };
  if (current.text.trim() === "") return "nothing";
  if (alreadyPinned(room.id, current.text)) return "nothing";

  // The text stays in the editor as well as landing on the list, so pinning
  // costs a second copy of it.
  if (!usage.fits(room.id, Buffer.byteLength(current.text, "utf8"))) return "full";

  pushHistory(room.id, current.text);
  bus.publish(roomTopic(room.id), { type: "history", items: historyOf(room.id) });
  broadcastUsage(room.id);
  touch(room);
  return "ok";
}

export function removeEntry(room: RoomRow, id: number): boolean {
  const result = db.run("DELETE FROM history WHERE room_id = ? AND id = ?", [room.id, id]);
  if (result.changes === 0) return false;
  bus.publish(roomTopic(room.id), { type: "history", items: historyOf(room.id) });
  broadcastUsage(room.id);
  touch(room);
  return true;
}

/** The only immediate and irreversible deletion: the emergency exit. */
export function clearRoom(room: RoomRow, authorId: string): number {
  const current = db.query("SELECT text, rev FROM rooms WHERE id = ?").get(room.id) as {
    text: string;
    rev: number;
  };
  const rev = current.rev + 1;
  db.run("UPDATE rooms SET text = '', rev = ? WHERE id = ?", [rev, room.id]);
  db.run("DELETE FROM history WHERE room_id = ?", [room.id]);

  bus.publish(roomTopic(room.id), { type: "text", text: "", rev, authorId });
  bus.publish(roomTopic(room.id), { type: "history", items: [] });
  broadcastUsage(room.id);
  touch(room);
  return rev;
}

// ── client snapshot ──────────────────────────────────────────────────────────

export function snapshot(room: RoomRow, member: MemberRow) {
  const fresh = db.query("SELECT * FROM rooms WHERE id = ?").get(room.id) as RoomRow;
  return {
    code: fresh.code,
    role: member.role,
    memberId: member.id,
    fingerprint: member.fingerprint,
    text: fresh.text,
    rev: fresh.rev,
    createdAt: fresh.created_at,
    lastActivity: fresh.last_activity,
    expiresAt: expiresAt(fresh),
    autoApproveUntil: fresh.auto_approve_until,
    members: roster(room.id),
    history: historyOf(room.id),
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
