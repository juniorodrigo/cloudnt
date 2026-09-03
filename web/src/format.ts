import { strings } from "./i18n.ts";

/**
 * Every caller reads this as a duration inside a sentence, so it never returns a
 * state. A room stays expired for up to a sweep before the server says so, and
 * during that minute the countdown sits at zero.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0 s";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.max(1, Math.floor(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const t = strings();
  if (seconds < 60) return t.justNow;
  const minutes = Math.floor(seconds / 60);
  return t.ago(minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const formatBytes = (text: string) => formatSize(new Blob([text]).size);

/** Neither end rounds into the other: a room with anything in it never reads
 *  0 %, and one with anything left never reads 100 %. */
export function formatPercent(value: number): string {
  if (value <= 0) return "0 %";
  if (value < 1) return "<1 %";
  if (value >= 100) return "100 %";
  return `${Math.min(99, Math.round(value))} %`;
}

/**
 * navigator.clipboard requires a secure context, and the spec accepts that
 * one-click copy is unavailable without HTTPS. When it is missing, the caller
 * selects the text so Ctrl+C still works and tells the user.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
