import * as api from "./api.ts";
import { ApiError } from "./api.ts";

/**
 * Hashing needs the whole file in memory, and crypto.subtle only exists in a
 * secure context, which the spec does not assume. Out of reach, the field goes
 * empty: the server verifies the size on disk and stores its own digest, so
 * this only adds the end-to-end check where it is affordable.
 */
const HASHABLE_BYTES = 64 * 1024 * 1024;

async function sha256Of(file: File): Promise<string> {
  if (!crypto.subtle || file.size > HASHABLE_BYTES) return "";
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only a dropped connection is worth retrying: a 4xx answers the same twice. */
async function sendChunk(token: string, id: string, n: number, chunk: Blob): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.putChunk(token, id, n, chunk);
    } catch (error) {
      if (error instanceof ApiError || attempt === 2) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
}

/**
 * Resumable by construction: it asks which chunks arrived instead of assuming,
 * so the same call starts an upload or picks one up after the link dropped.
 */
export async function sendFile(token: string, id: string, file: File): Promise<void> {
  const status = await api.fileStatus(token, id);
  if (status.status === "ready") return;
  const have = new Set(status.received);

  for (let n = 0; n < status.chunks; n++) {
    if (have.has(n)) continue;
    const start = n * status.chunkSize;
    await sendChunk(token, id, n, file.slice(start, Math.min(start + status.chunkSize, file.size)));
  }
  await api.completeFile(token, id, await sha256Of(file));
}
