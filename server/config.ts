export const PORT = Number(Bun.env.PORT ?? 3000);
export const DEV = Bun.env.NODE_ENV !== "production";
export const DATA_DIR = Bun.env.CLOUDNT_DATA ?? "./data";

/** Loopback unless a host is named, so a plain `bun run` does not open the LAN. */
export const HOST = Bun.env.CLOUDNT_HOST ?? "127.0.0.1";

/**
 * Only honour x-forwarded-for where a proxy is known to set it. Reachable
 * directly, the header is attacker-controlled and every per-IP quota becomes
 * unlimited: a fresh value per request is enough to probe codes forever.
 */
export const TRUST_PROXY = Bun.env.CLOUDNT_TRUST_PROXY === "1";

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

export const LIMITS = {
  roomsPerIpPerHour: 10,
  joinAttemptsPerIpPer5Min: 20,
  concurrentRooms: 500,
  textBytesPerRoom: 8 * 1024 * 1024,
  historyEntries: 10,
  membersPerRoom: 16,
  fileBytes: 2 * 1024 * 1024 * 1024,
  bytesPerRoom: 5 * 1024 * 1024 * 1024,
  filesPerRoom: 20,
};
