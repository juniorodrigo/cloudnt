import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { DATA_DIR } from "./config.ts";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(`${DATA_DIR}/cloudnt.sqlite`, { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA foreign_keys = ON");

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

  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
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
  CREATE INDEX IF NOT EXISTS history_room  ON history(room_id, id DESC);
  CREATE INDEX IF NOT EXISTS files_room    ON files(room_id, created_at);
`);

/** Older databases predate per-room bandwidth accounting. */
if (!db.query("PRAGMA table_info(rooms)").all().some((c) => (c as { name: string }).name === "bytes_moved")) {
  db.exec("ALTER TABLE rooms ADD COLUMN bytes_moved INTEGER NOT NULL DEFAULT 0");
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

export type HistoryRow = { id: number; content: string; created_at: number };

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
