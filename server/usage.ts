import { db } from "./db.ts";
import { LIMITS } from "./config.ts";

/**
 * One budget for everything a room holds: the live text, the pinned entries and
 * the files. Separate budgets would let a room sit at the file limit and the
 * text limit at once, and the figure shown in the footer has to mean the whole
 * room or it means nothing.
 *
 * Files count their declared size rather than what has landed, so the space is
 * booked when the upload is announced: see the note on reservedBytes in files.ts.
 * CAST to BLOB because LENGTH on TEXT counts characters, and the limit is bytes.
 */
export function usedBytes(roomId: string): number {
  const row = db
    .query(
      `SELECT COALESCE((SELECT LENGTH(CAST(text AS BLOB)) FROM rooms WHERE id = ?1), 0)
            + (SELECT COALESCE(SUM(LENGTH(CAST(content AS BLOB))), 0) FROM history WHERE room_id = ?1)
            + (SELECT COALESCE(SUM(size), 0) FROM files WHERE room_id = ?1) AS n`,
    )
    .get(roomId) as { n: number };
  return row.n;
}

export const roomUsage = (roomId: string) => ({
  used: usedBytes(roomId),
  limit: LIMITS.storageBytesPerRoom,
});

/**
 * Only growth is checked. Shrinking always goes through, so a full room can
 * still be emptied back into a usable one — otherwise the way out of the limit
 * would be blocked by the limit.
 */
export function fits(roomId: string, growth: number): boolean {
  return growth <= 0 || usedBytes(roomId) + growth <= LIMITS.storageBytesPerRoom;
}
