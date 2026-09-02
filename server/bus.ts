export type SubscriberMeta = {
  roomId: string;
  memberId: string | null;
  pendingId: string | null;
};

export type Subscriber = {
  readonly id: string;
  readonly meta: SubscriberMeta;
  readonly topics: Set<string>;
  send(payload: string): void;
  close(): void;
};

const byTopic = new Map<string, Set<Subscriber>>();
const everyone = new Set<Subscriber>();

/**
 * Custom bus instead of Bun.serve's topic pub/sub: events must be delivered via
 * WebSocket and SSE with the same semantics, and server.publish() only reaches
 * sockets. Many corporate proxies break the WS upgrade, which is precisely the
 * environment this exists for.
 */
export function subscribe(sub: Subscriber, topics: string[]): void {
  everyone.add(sub);
  for (const topic of topics) {
    sub.topics.add(topic);
    let set = byTopic.get(topic);
    if (!set) byTopic.set(topic, (set = new Set()));
    set.add(sub);
  }
}

export function unsubscribe(sub: Subscriber): void {
  everyone.delete(sub);
  for (const topic of sub.topics) {
    const set = byTopic.get(topic);
    if (!set) continue;
    set.delete(sub);
    if (set.size === 0) byTopic.delete(topic);
  }
  sub.topics.clear();
}

export function publish(topic: string, event: Record<string, unknown>): void {
  const set = byTopic.get(topic);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(event);
  for (const sub of set) {
    try {
      sub.send(payload);
    } catch {
      unsubscribe(sub);
    }
  }
}

export function subscribersOf(topic: string): Subscriber[] {
  return [...(byTopic.get(topic) ?? [])];
}

/**
 * Keeps connections alive through proxies with inactivity timeouts.
 * Does not count as room activity: does not touch the TTL.
 */
export function heartbeat(): void {
  const payload = JSON.stringify({ type: "ping" });
  for (const sub of everyone) {
    try {
      sub.send(payload);
    } catch {
      unsubscribe(sub);
    }
  }
}

export function closeTopic(topic: string, event: Record<string, unknown>): void {
  publish(topic, event);
  for (const sub of subscribersOf(topic)) {
    unsubscribe(sub);
    try {
      sub.close();
    } catch {
      // the socket was already down
    }
  }
}
