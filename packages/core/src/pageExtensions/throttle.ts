/**
 * Pure, dependency-free throttle for invalid page-extension bridge-token attempts.
 * Blunts forged-token enumeration / timing attacks: after `maxAttempts` failures
 * within `windowMs` for the same key, further attempts are reported as throttled
 * until the window elapses.
 *
 * Kept in core (not the extension) so it is unit-testable without chrome.* APIs.
 */
export class BridgeAttemptThrottle {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly attempts = new Map<string, { count: number; first: number }>();

  constructor(opts: { maxAttempts?: number; windowMs?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 10;
    this.windowMs = opts.windowMs ?? 10_000;
  }

  /**
   * Record one invalid attempt for `key`.
   * @returns true when the key is now throttled (over the limit within the window).
   */
  register(key: string, now: number = Date.now()): boolean {
    const rec = this.attempts.get(key);
    if (!rec || now - rec.first > this.windowMs) {
      this.attempts.set(key, { count: 1, first: now });
      return false;
    }
    rec.count += 1;
    return rec.count > this.maxAttempts;
  }

  /** Clear counters for keys starting with `prefix` (e.g. a closed tab). */
  clearPrefix(prefix: string): void {
    for (const k of [...this.attempts.keys()]) {
      if (k.startsWith(prefix)) this.attempts.delete(k);
    }
  }

  /** Clear a single key (e.g. after a successful auth). */
  clear(key: string): void {
    this.attempts.delete(key);
  }
}
