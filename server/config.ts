export const PORT = Number(Bun.env.PORT ?? 3000);
export const DEV = Bun.env.NODE_ENV !== "production";
export const DATA_DIR = Bun.env.CLOUDNT_DATA ?? "./data";

/** Loopback unless a host is named, so a plain `bun run` does not open the LAN. */
export const HOST = Bun.env.CLOUDNT_HOST ?? "127.0.0.1";

/**
 * Only honour x-forwarded-for where a proxy is known to set it. Reachable
 * directly, the header is attacker-controlled and every per-IP quota becomes
 * unlimited: a fresh value per request is enough to probe codes forever.
 *
 * Assumes exactly one proxy hop, which is what makes the last entry of the
 * chain trustworthy. Behind two, the app is one hop further from the truth.
 */
export const TRUST_PROXY = Bun.env.CLOUDNT_TRUST_PROXY === "1";

/**
 * Which header carries the caller's address. Cloudflare writes cf-connecting-ip
 * itself on every request and never appends, so behind it that header is the
 * only one whose whole value is known to come from the edge rather than partly
 * from the caller. Read the last entry either way: one value stays one value.
 */
export const CLIENT_IP_HEADER = (
  Bun.env.CLOUDNT_CLIENT_IP_HEADER ?? "x-forwarded-for"
).toLowerCase();

export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 5;

export const TTL_IDLE_MS = 2 * 60 * 60 * 1000;
export const TTL_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 60 * 1000;

/** Window in which a rejection can be undone by approving the same visitor. */
export const REJECT_UNDO_MS = 30 * 1000;
export const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Rotates after rejecting three *distinct* fingerprints: rotating on raw count
 * would let a third party probing codes kill the code that the legitimate VM
 * already has typed on screen.
 */
export const ROTATE_AFTER_DISTINCT_REJECTS = 3;
export const ROTATE_WINDOW_MS = 10 * 60 * 1000;

export const FILES_DIR = Bun.env.CLOUDNT_FILES ?? `${DATA_DIR}/files`;

/** 5 MB, per spec §4.4: small enough to retry cheaply on a flaky corporate link. */
export const CHUNK_SIZE = 5 * 1024 * 1024;

/** A ticket is redeemed immediately by the browser; it only has to survive the click. */
export const DOWNLOAD_TICKET_TTL_MS = 30 * 1000;

/**
 * Ceiling for everything held on disk at once. The per-room limits multiply
 * instead of capping: 500 rooms allowed to move 5 GB each is 2.5 TB, which is
 * not a number any machine this runs on has. Unlike the limits below this one
 * is a property of the host, so it comes from the environment.
 */
export const DISK_BYTES = Number(Bun.env.CLOUDNT_DISK_BYTES ?? 20 * 1024 * 1024 * 1024);

export const LIMITS = {
  roomsPerIpPerHour: 10,
  joinAttemptsPerIpPer5Min: 20,
  concurrentRooms: 500,
  textBytesPerRoom: 8 * 1024 * 1024,
  historyEntries: 10,
  membersPerRoom: 16,
  fileBytes: 1024 * 1024 * 1024,
  /**
   * Everything a room holds at once — text, pinned entries and files — against
   * a single budget. A lone file may fill it, so the per-file cap matches.
   */
  storageBytesPerRoom: 1024 * 1024 * 1024,
  bytesPerRoom: 5 * 1024 * 1024 * 1024,
  filesPerRoom: 20,
};
