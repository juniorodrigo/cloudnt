export type SavedRoom = {
  code: string;
  token: string;
  role: "owner" | "member";
  savedAt: number;
};

const KEY = "cloudnt:rooms";
const MAX = 8;

function read(): SavedRoom[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as SavedRoom[]) : [];
  } catch {
    return [];
  }
}

function write(rooms: SavedRoom[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rooms.slice(0, MAX)));
  } catch {
    // private mode or quota exceeded: the room is still alive, just not remembered
  }
}

export const recentRooms = (): SavedRoom[] => read().sort((a, b) => b.savedAt - a.savedAt);

export const tokenFor = (code: string): string | null =>
  read().find((r) => r.code === code)?.token ?? null;

export function remember(room: SavedRoom): void {
  write([room, ...read().filter((r) => r.token !== room.token)]);
}

export function forget(token: string): void {
  write(read().filter((r) => r.token !== token));
}

/** The code rotates without invalidating tokens: the saved entry must be updated. */
export function renameCode(token: string, code: string): void {
  write(read().map((r) => (r.token === token ? { ...r, code, savedAt: Date.now() } : r)));
}
