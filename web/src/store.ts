export type SavedRoom = {
  code: string;
  token: string;
  role: "owner" | "member";
  savedAt: number;
};

const KEY = "cloudnt:rooms";
const WIDTH_KEY = "cloudnt:stack-width";
const CLEAR_ON_PIN_KEY = "cloudnt:clear-on-pin";
const LANG_KEY = "cloudnt:lang";
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

export function savedStackWidth(): number | null {
  const value = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveStackWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // private mode or quota exceeded: the panel just goes back to its default width
  }
}

/**
 * Off unless it was turned on: pinning leaves the text in place, which is what
 * someone who pins to keep editing expects. The other habit — pin, then paste
 * the next thing — wants the opposite, so it is a choice rather than a default.
 */
export const clearsOnPin = (): boolean => localStorage.getItem(CLEAR_ON_PIN_KEY) === "1";

export function saveClearsOnPin(on: boolean): void {
  try {
    localStorage.setItem(CLEAR_ON_PIN_KEY, on ? "1" : "0");
  } catch {
    // private mode or quota exceeded: the preference just does not outlive the tab
  }
}

/** Null rather than a default: only an explicit choice should beat the browser's. */
export function savedLang(): "es" | "en" | null {
  const value = localStorage.getItem(LANG_KEY);
  return value === "es" || value === "en" ? value : null;
}

export function saveLang(lang: "es" | "en"): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // private mode or quota exceeded: the choice just does not outlive the tab
  }
}

/** The code rotates without invalidating tokens: the saved entry must be updated. */
export function renameCode(token: string, code: string): void {
  write(read().map((r) => (r.token === token ? { ...r, code, savedAt: Date.now() } : r)));
}
