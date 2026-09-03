import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { DATA_DIR } from "./config.ts";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(`${DATA_DIR}/cloudnt.sqlite`, { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA foreign_keys = ON");

const hasTable = (name: string) =>
  db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;

/**
 * Runs before the schema below: created first, an empty `blocks` would sit next
 * to the old `history` and the rename would never happen.
 */
if (hasTable("history") && !hasTable("blocks")) {
  db.exec("ALTER TABLE history RENAME TO blocks");
  db.exec("DROP INDEX IF EXISTS history_room");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id                 TEXT PRIMARY KEY,
    code               TEXT NOT NULL UNIQUE,
    text               TEXT NOT NULL DEFAULT '',
    rev                INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    last_activity      INTEGER NOT NULL,
    auto_approve_until INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS members (
    id          TEXT PRIMARY KEY,
    room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    role        TEXT NOT NULL,
    ip          TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    joined_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    rev        INTEGER NOT NULL DEFAULT 0,
    locked     INTEGER NOT NULL DEFAULT 0,
    author_id  TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    chunks     INTEGER NOT NULL,
    sha256     TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'uploading',
    author_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS file_chunks (
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    n       INTEGER NOT NULL,
    PRIMARY KEY (file_id, n)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS members_room  ON members(room_id);
  CREATE INDEX IF NOT EXISTS blocks_room   ON blocks(room_id, id DESC);
  CREATE INDEX IF NOT EXISTS files_room    ON files(room_id, created_at);
`);

const columnsOf = (table: string) =>
  db.query(`PRAGMA table_info(${table})`).all().map((c) => (c as { name: string }).name);

const roomColumns = () => columnsOf("rooms");

/** Older databases predate per-room bandwidth accounting. */
if (!roomColumns().includes("bytes_moved")) {
  db.exec("ALTER TABLE rooms ADD COLUMN bytes_moved INTEGER NOT NULL DEFAULT 0");
}

/**
 * Which block a device has open is the device's business now, so the room no
 * longer carries it. Dropping the column is what keeps it from being read back.
 */
if (roomColumns().includes("editing_id")) {
  db.exec("ALTER TABLE rooms DROP COLUMN editing_id");
}

/** Blocks predate being editable documents of their own. */
const blockColumns = columnsOf("blocks");
if (!blockColumns.includes("updated_at")) {
  db.exec("ALTER TABLE blocks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE blocks SET updated_at = created_at");
}
if (!blockColumns.includes("rev")) {
  db.exec("ALTER TABLE blocks ADD COLUMN rev INTEGER NOT NULL DEFAULT 0");
}
if (!blockColumns.includes("locked")) {
  db.exec("ALTER TABLE blocks ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
}
if (!blockColumns.includes("author_id")) {
  db.exec("ALTER TABLE blocks ADD COLUMN author_id TEXT NOT NULL DEFAULT ''");
}

export type RoomRow = {
  id: string;
  code: string;
  text: string;
  rev: number;
  created_at: number;
  last_activity: number;
  auto_approve_until: number;
  bytes_moved: number;
};

export type MemberRow = {
  id: string;
  room_id: string;
  token_hash: string;
  fingerprint: string;
  role: "owner" | "member";
  ip: string;
  user_agent: string;
  joined_at: number;
};

/** What the client gets: the body itself is fetched on demand, one block at a time. */
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

export type FileRow = {
  id: string;
  room_id: string;
  name: string;
  size: number;
  chunk_size: number;
  chunks: number;
  sha256: string;
  status: "uploading" | "ready";
  author_id: string;
  created_at: number;
};
