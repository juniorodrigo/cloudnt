export type ServerEvent = { type: string } & Record<string, unknown>;
export type ConnectionStatus = "connecting" | "online" | "offline";

type Options = {
  token?: string;
  pending?: string;
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Fired after reconnecting: some events may have been missed, a resync is needed. */
  onResync: () => void;
};

const FALLBACK_KEY = "cloudnt:transport";
const OPEN_TIMEOUT_MS = 3000;

/**
 * WebSocket with SSE fallback. Many corporate proxies break the WS upgrade, and
 * that is precisely the environment this exists for: if the socket were the only
 * channel, the app would fail exactly where it is needed most.
 *
 * Writes never travel through here — they go via HTTP POST — so both transports
 * share exactly the same write semantics.
 */
export function connect(options: Options): () => void {
  const query = new URLSearchParams(
    options.token ? { token: options.token } : { pending: options.pending! },
  ).toString();

  let mode: "ws" | "sse" = sessionStorage.getItem(FALLBACK_KEY) === "sse" ? "sse" : "ws";
  let disposed = false;
  let hasConnectedBefore = false;
  let attempt = 0;
  let teardown = () => {};
  let retryTimer: number | undefined;

  const opened = () => {
    attempt = 0;
    options.onStatus("online");
    if (hasConnectedBefore) options.onResync();
    hasConnectedBefore = true;
  };

  const dropped = () => {
    if (disposed) return;
    options.onStatus("offline");
    retryTimer = window.setTimeout(start, Math.min(500 * 2 ** attempt++, 8000));
  };

  const deliver = (raw: string) => {
    try {
      const event = JSON.parse(raw) as ServerEvent;
      if (event.type !== "ping") options.onEvent(event);
    } catch {
      // corrupt frame: ignored, the heartbeat will bring the next one
    }
  };

  function startWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws?${query}`);
    let established = false;

    // A proxy that cuts the upgrade may leave the socket hanging in CONNECTING
    // without emitting an error: without this timeout the app waits forever.
    const guard = window.setTimeout(() => {
      if (!established) {
        ws.close();
        sessionStorage.setItem(FALLBACK_KEY, "sse");
        mode = "sse";
        dropped();
      }
    }, OPEN_TIMEOUT_MS);

    ws.onopen = () => {
      established = true;
      clearTimeout(guard);
      opened();
    };
    ws.onmessage = (e) => deliver(String(e.data));
    ws.onclose = () => {
      clearTimeout(guard);
      if (!established) {
        sessionStorage.setItem(FALLBACK_KEY, "sse");
        mode = "sse";
      }
      dropped();
    };
    ws.onerror = () => ws.close();

    teardown = () => {
      clearTimeout(guard);
      ws.onclose = null;
      ws.close();
    };
  }

  function startSse() {
    const source = new EventSource(`/api/events?${query}`);
    source.onopen = opened;
    source.onmessage = (e) => deliver(e.data);
    source.onerror = () => {
      source.close();
      dropped();
    };
    teardown = () => {
      source.onerror = null;
      source.close();
    };
  }

  function start() {
    if (disposed) return;
    options.onStatus("connecting");
    if (mode === "ws") startWs();
    else startSse();
  }

  start();

  return () => {
    disposed = true;
    clearTimeout(retryTimer);
    teardown();
  };
}
