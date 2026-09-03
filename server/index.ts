import type { ServerWebSocket } from "bun";
import {
  CHUNK_SIZE,
  CLIENT_IP_HEADER,
  CODE_ALPHABET,
  CODE_LENGTH,
  DEV,
  DOWNLOAD_TICKET_TTL_MS,
  HOST,
  LIMITS,
  PORT,
  SWEEP_INTERVAL_MS,
  TRUST_PROXY,
} from "./config.ts";
import * as bus from "./bus.ts";
import * as rooms from "./rooms.ts";
import * as files from "./files.ts";
import { sweepLimits, take } from "./limits.ts";
import { type Lang, langOf, msg } from "./i18n.ts";
import type { MemberRow, RoomRow } from "./db.ts";

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const DIST = new URL("../web/dist/", import.meta.url).pathname;

// ── http utilities ───────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (status: number, error: string) => json({ error }, status);

function clientIp(req: Request, server: { requestIP(r: Request): { address: string } | null }): string {
  if (TRUST_PROXY) {
    // The *last* entry, not the first: proxies append, so a client that sends
    // its own x-forwarded-for gets it kept and the real address added after it.
    // Reading the head would hand every per-IP quota a value the caller picks.
    const forwarded = req.headers.get(CLIENT_IP_HEADER);
    if (forwarded) return forwarded.split(",").pop()!.trim();
  }
  return server.requestIP(req)?.address ?? "unknown";
}

function bearer(req: Request, url: URL): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token");
}

function authenticate(req: Request, url: URL): { room: RoomRow; member: MemberRow } | null {
  const token = bearer(req, url);
  return token ? rooms.memberByToken(token) : null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── event channel ────────────────────────────────────────────────────────────

type Channel = {
  topics: string[];
  meta: bus.SubscriberMeta;
  onOpen?: () => void;
  onClose?: () => void;
};

/**
 * Resolves which topics a connecting client listens to. A visitor in the waiting
 * room only reaches their own channel: they see nothing of the room content
 * while the owner decides.
 */
function resolveChannel(req: Request, url: URL): Channel | null {
  const pendingId = url.searchParams.get("pending");
  if (pendingId) {
    const pending = rooms.pendingById(pendingId);
    if (!pending) return null;
    return {
      topics: [rooms.waitTopic(pendingId)],
      meta: { roomId: pending.roomId, memberId: null, pendingId },
    };
  }

  const auth = authenticate(req, url);
  if (!auth) return null;
  const { room, member } = auth;
  const topics =
    member.role === "owner"
      ? [rooms.roomTopic(room.id), rooms.ownerTopic(room.id)]
      : [rooms.roomTopic(room.id)];

  return {
    topics,
    meta: { roomId: room.id, memberId: member.id, pendingId: null },
    onOpen: () => rooms.broadcastRoster(room.id),
    onClose: () => rooms.broadcastRoster(room.id),
  };
}

function sseResponse(channel: Channel): Response {
  let sub: bus.Subscriber;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      sub = {
        id: crypto.randomUUID(),
        meta: channel.meta,
        topics: new Set<string>(),
        send(payload) {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        },
        close() {
          try {
            controller.close();
          } catch {
            // the stream was already closed
          }
        },
      };
      bus.subscribe(sub, channel.topics);
      sub.send(JSON.stringify({ type: "ready", transport: "sse" }));
      channel.onOpen?.();
    },
    cancel() {
      bus.unsubscribe(sub);
      channel.onClose?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

type SocketData = { channel: Channel; sub?: bus.Subscriber };

// ── downloads ────────────────────────────────────────────────────────────────

/**
 * A download is a plain browser navigation, so it carries no Authorization
 * header. The ticket stands in for the token: single use, seconds of life, and
 * disposable if it ends up in the address bar or a proxy log.
 */
const tickets = new Map<string, { roomId: string; fileId: string; expires: number }>();

function issueTicket(roomId: string, fileId: string): string {
  const id = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
  tickets.set(id, { roomId, fileId, expires: Date.now() + DOWNLOAD_TICKET_TTL_MS });
  return id;
}

function download(ticketId: string, lang: Lang): Response {
  const M = msg(lang);
  const ticket = tickets.get(ticketId);
  tickets.delete(ticketId);
  if (!ticket || Date.now() > ticket.expires) return fail(404, M.ticketSpent);

  const room = rooms.roomById(ticket.roomId);
  if (!room) return fail(404, M.roomGone);
  const file = files.fileById(room.id, ticket.fileId);
  if (!file || file.status !== "ready") return fail(404, M.fileGone);

  files.countDownload(file);
  rooms.touch(room);

  return new Response(files.readable(file), {
    headers: {
      // Never the client's declared type and never inline: served on this origin,
      // an HTML upload rendered in the browser would read the room token.
      "content-type": "application/octet-stream",
      "content-length": String(file.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "content-security-policy": "default-src 'none'",
      "cache-control": "no-store",
    },
  });
}

function broadcastFiles(roomId: string): void {
  bus.publish(rooms.roomTopic(roomId), { type: "files", items: files.listFiles(roomId) });
  rooms.broadcastUsage(roomId);
}

// ── static files ─────────────────────────────────────────────────────────────

async function serveStatic(pathname: string): Promise<Response> {
  if (DEV) return fail(404, "in dev mode the client is served by vite on :5173");

  const candidate = Bun.file(DIST + pathname.replace(/^\/+/, ""));
  if (pathname !== "/" && (await candidate.exists())) {
    return new Response(candidate, {
      headers: { "cache-control": pathname.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" },
    });
  }
  // Every unknown path gets the same HTML, so the landing's indexable metadata
  // would otherwise travel with each room URL. The header overrides it.
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  };
  if (pathname !== "/") headers["x-robots-tag"] = "noindex, nofollow";
  return new Response(Bun.file(DIST + "index.html"), { headers });
}

function securityHeaders(res: Response): Response {
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "no-referrer");
  if (!DEV) {
    res.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

// ── server ───────────────────────────────────────────────────────────────────

const server = Bun.serve<SocketData, string>({
  hostname: HOST,
  port: PORT,
  idleTimeout: 60,
  // Bun defaults to 128 MB. Nothing here is bigger than one chunk or one text.
  maxRequestBodySize: Math.max(CHUNK_SIZE, LIMITS.textBytesPerRoom) + 1024 * 1024,

  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;
    const ip = clientIp(req, srv);

    if (path === "/ws") {
      const channel = resolveChannel(req, url);
      if (!channel) return fail(401, msg(langOf(req)).unauthorized);
      if (srv.upgrade(req, { data: { channel } })) return undefined as unknown as Response;
      return fail(400, msg(langOf(req)).noSocket);
    }

    if (path === "/api/events") {
      const channel = resolveChannel(req, url);
      if (!channel) return fail(401, msg(langOf(req)).unauthorized);
      return sseResponse(channel);
    }

    if (path.startsWith("/api/")) {
      return securityHeaders(await api(req, url, path, ip));
    }

    return securityHeaders(await serveStatic(path));
  },

  websocket: {
    open(ws: ServerWebSocket<SocketData>) {
      const { channel } = ws.data;
      const sub: bus.Subscriber = {
        id: crypto.randomUUID(),
        meta: channel.meta,
        topics: new Set<string>(),
        send: (payload) => void ws.send(payload),
        close: () => ws.close(),
      };
      ws.data.sub = sub;
      bus.subscribe(sub, channel.topics);
      sub.send(JSON.stringify({ type: "ready", transport: "ws" }));
      channel.onOpen?.();
    },
    message() {
      // Mutations go via HTTP POST. The socket is a read-only channel, so
      // WebSocket and SSE share exactly the same write path.
    },
    close(ws: ServerWebSocket<SocketData>) {
      if (ws.data.sub) bus.unsubscribe(ws.data.sub);
      ws.data.channel.onClose?.();
    },
  },
});

// ── API ──────────────────────────────────────────────────────────────────────

async function api(req: Request, url: URL, path: string, ip: string): Promise<Response> {
  const userAgent = req.headers.get("user-agent") ?? "";
  const lang = langOf(req);
  const M = msg(lang);

  if (path === "/api/room" && req.method === "POST") {
    if (!take(`create:${ip}`, LIMITS.roomsPerIpPerHour, 60 * 60 * 1000)) {
      return fail(429, M.tooManyRooms);
    }
    if (rooms.roomCount() >= LIMITS.concurrentRooms) {
      return fail(503, M.noRoomsLeft);
    }
    const { room, token } = rooms.createRoom(ip, userAgent);
    return json({ code: room.code, token, expiresAt: rooms.expiresAt(room) });
  }

  const joinMatch = path.match(/^\/api\/room\/([^/]+)\/join$/);
  if (joinMatch && req.method === "POST") {
    // Without this limit the code space can be swept in minutes: it is the gap
    // that the per-IP room count does not cover.
    if (!take(`join:${ip}`, LIMITS.joinAttemptsPerIpPer5Min, 5 * 60 * 1000)) {
      return fail(429, M.tooManyJoins);
    }
    const code = joinMatch[1]!.toLowerCase();
    if (!CODE_RE.test(code)) return fail(400, M.badCode);

    const room = rooms.roomByCode(code);
    if (!room) return fail(404, M.noRoom);

    const result = rooms.join(room, ip, userAgent);
    if (result.status === "full") return fail(409, M.roomCrowded);
    return json(result);
  }

  const ticketMatch = path.match(/^\/api\/download\/([A-Za-z0-9_-]{1,64})$/);
  if (ticketMatch && req.method === "GET") return download(ticketMatch[1]!, lang);

  const auth = authenticate(req, url);
  if (!auth) return fail(401, M.unauthorized);
  const { room, member } = auth;
  const isOwner = member.role === "owner";
  const body = req.method === "POST" ? await readJson(req) : {};

  if (path === "/api/file" && req.method === "POST") {
    if (typeof body.name !== "string" || typeof body.size !== "number") {
      return fail(400, M.badRequest);
    }
    // Announcing a file is cheap and the storage budget does not price the small
    // ones, so the count is what has to be paced. Keyed by member: the limit is
    // on the one doing it, not on everyone sharing an office address.
    if (!take(`file:${member.id}`, LIMITS.filesPerMemberPer5Min, 5 * 60 * 1000)) {
      return fail(429, M.tooFastFiles);
    }
    const result = await files.createFile(room.id, member.id, body.name, body.size);
    if (!result.ok) {
      if (result.reason === "too_many") return fail(409, M.tooManyFiles);
      if (result.reason === "full") return fail(413, M.full);
      if (result.reason === "quota") return fail(413, M.overQuota);
      if (result.reason === "disk") return fail(507, M.noDisk);
      return fail(413, M.fileTooBig);
    }
    const { file } = result;
    rooms.touch(room);
    broadcastFiles(room.id);
    return json({ id: file.id, name: file.name, chunkSize: file.chunk_size, chunks: file.chunks, received: [] });
  }

  const blockMatch = path.match(/^\/api\/block\/(\d+)$/);
  if (blockMatch && req.method === "GET") {
    const block = rooms.blockById(room.id, Number(blockMatch[1]));
    if (!block) return fail(404, M.notFound);
    return json({ text: block.content, rev: block.rev, locked: block.locked === 1 });
  }

  const fileMatch = path.match(/^\/api\/file\/([^/]+)(\/.*)?$/);
  if (fileMatch) {
    const file = files.fileById(room.id, fileMatch[1]!);
    if (!file) return fail(404, M.fileGone);
    const rest = fileMatch[2] ?? "";

    const chunkMatch = rest.match(/^\/chunk\/(\d+)$/);
    if (chunkMatch && req.method === "PUT") {
      if (file.status === "ready") return fail(409, M.fileComplete);
      const result = await files.writeChunk(file, Number(chunkMatch[1]), await req.arrayBuffer());
      if (!result.ok) {
        return result.reason === "quota"
          ? fail(413, M.overQuota)
          : fail(400, M.chunkOutOfRange);
      }
      rooms.touch(room);
      broadcastFiles(room.id);
      return json({ received: result.received });
    }

    // Resume asks what arrived rather than assuming: after a cut the client does
    // not know which of the chunks in flight the server actually wrote.
    if (rest === "/status" && req.method === "GET") {
      return json({
        status: file.status,
        chunks: file.chunks,
        chunkSize: file.chunk_size,
        received: files.receivedChunks(file.id),
      });
    }

    if (rest === "/complete" && req.method === "POST") {
      const result = await files.completeFile(file, typeof body.sha256 === "string" ? body.sha256 : "");
      broadcastFiles(room.id);
      if (!result.ok) {
        return result.reason === "incomplete"
          ? fail(409, M.missingChunks)
          : fail(422, M.corrupt);
      }
      rooms.touch(room);
      return json({ ok: true, sha256: result.file.sha256 });
    }

    if (rest === "/remove" && req.method === "POST") {
      if (!isOwner && file.author_id !== member.id) return fail(403, M.ownerOrAuthorRemoves);
      await files.removeFile(file);
      broadcastFiles(room.id);
      return json({ ok: true });
    }

    if (rest === "/ticket" && req.method === "POST") {
      if (file.status !== "ready") return fail(409, M.fileUploading);
      return json({ ticket: issueTicket(room.id, file.id) });
    }
  }

  // Which tab wrote, not which member: a member with two tabs open has to be
  // told apart from itself, or each tab answers the other's echo with a write.
  const origin = req.headers.get("x-client") || member.id;

  switch (path) {
    case "/api/state": {
      // Which block the tab has open is the tab's own, so it has to say so on
      // every reconnect; the server keeps nothing about it.
      const open = url.searchParams.get("open");
      return json(rooms.snapshot(room, member, open === null ? null : Number(open)));
    }

    case "/api/text": {
      if (typeof body.text !== "string" || typeof body.baseRev !== "number") {
        return fail(400, M.badRequest);
      }
      if (body.blockId !== null && typeof body.blockId !== "number") return fail(400, M.badRequest);
      const result = rooms.write(
        room,
        member,
        body.blockId,
        body.text,
        body.baseRev,
        origin,
        body.force === true,
      );
      if (result.ok) return json({ rev: result.rev });
      if (result.reason === "conflict") {
        return json({ error: "conflict", text: result.text, rev: result.rev }, 409);
      }
      if (result.reason === "gone") return fail(404, M.blockGone);
      if (result.reason === "locked") return fail(423, M.blockLocked);
      return fail(413, result.reason === "full" ? M.full : M.textTooBig);
    }

    case "/api/block": {
      if (typeof body.text !== "string") return fail(400, M.badRequest);
      const result = rooms.saveBlock(room, member, body.text, body.locked === true);
      if (result.ok) return json({ id: result.id, rev: result.rev, draftRev: result.draftRev });
      if (result.reason === "nothing") return fail(409, M.nothingToSave);
      return fail(413, result.reason === "full" ? M.full : M.textTooBig);
    }

    case "/api/block/lock": {
      if (typeof body.id !== "number") return fail(400, M.badRequest);
      const result = rooms.lockBlock(room, member, body.id, body.locked === true);
      if (result === "gone") return fail(404, M.blockGone);
      if (result === "denied") return fail(403, M.authorLocks);
      return json({ ok: true });
    }

    case "/api/block/remove": {
      if (typeof body.id !== "number") return fail(400, M.badRequest);
      const result = rooms.removeBlock(room, member, body.id);
      if (result === "gone") return fail(404, M.blockGone);
      if (result === "denied") return fail(403, M.authorLocks);
      return json({ ok: true });
    }

    case "/api/clear":
      return json({ rev: rooms.clearRoom(room, origin) });

    case "/api/keepalive":
      rooms.touch(room);
      return json({ ok: true });

    case "/api/approve": {
      if (!isOwner) return fail(403, M.ownerApproves);
      if (typeof body.pendingId !== "string") return fail(400, M.badRequest);
      return rooms.approve(room, body.pendingId)
        ? json({ ok: true })
        : fail(404, M.requestGone);
    }

    case "/api/reject": {
      if (!isOwner) return fail(403, M.ownerRejects);
      if (typeof body.pendingId !== "string") return fail(400, M.badRequest);
      return rooms.reject(room, body.pendingId) ? json({ ok: true }) : fail(404, M.notFound);
    }

    case "/api/kick": {
      if (!isOwner) return fail(403, M.ownerKicks);
      if (typeof body.memberId !== "string") return fail(400, M.badRequest);
      return rooms.kick(room, body.memberId) ? json({ ok: true }) : fail(404, M.memberNotFound);
    }

    case "/api/rotate": {
      if (!isOwner) return fail(403, M.ownerRotates);
      return json({ code: rooms.rotateCode(room) });
    }

    case "/api/auto-approve": {
      if (!isOwner) return fail(403, M.ownerEnables);
      const minutes = typeof body.minutes === "number" ? Math.min(body.minutes, 5) : 0;
      return json({ until: rooms.setAutoApprove(room, minutes) });
    }

    case "/api/close": {
      if (!isOwner) return fail(403, M.ownerCloses);
      rooms.destroyRoom(room, "closed");
      return json({ ok: true });
    }
  }

  return fail(404, M.unknownRoute);
}

setInterval(() => {
  rooms.sweep();
  sweepLimits();
  const now = Date.now();
  for (const [id, ticket] of tickets) if (now > ticket.expires) tickets.delete(id);
}, SWEEP_INTERVAL_MS);

setInterval(() => bus.heartbeat(), 25_000);

console.log(
  `cloudnt listening on http://${server.hostname}:${server.port}` +
    `${TRUST_PROXY ? `  (trusting ${CLIENT_IP_HEADER})` : ""}${DEV ? "  (client on :5173)" : ""}`,
);
