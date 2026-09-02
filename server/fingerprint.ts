import { WORDS } from "./words.ts";

/**
 * The fingerprint is drawn randomly per join attempt, not derived from IP + user-agent.
 *
 * The target environment is precisely where that derivation would collide: a VDI
 * fleet shares an egress IP and deploys identical user-agents, so two machines
 * waiting for approval would show the same word pair — which is exactly the case
 * the fingerprint exists to distinguish.
 */
export function makeFingerprint(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  const a = WORDS[bytes[0]! % WORDS.length]!;
  const b = WORDS[bytes[1]! % WORDS.length]!;
  return a === b ? `${a}-${WORDS[(bytes[1]! + 1) % WORDS.length]!}` : `${a}-${b}`;
}
