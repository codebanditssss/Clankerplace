import "server-only";

/**
 * In-process, per-key mutex. Used by evaluateUser() so two concurrent
 * threshold evaluations for the same user can't double-fire side effects
 * (the §1.5 race in BILLING_AUDIT.md).
 *
 * Limitations — explicitly stated so this isn't mistaken for more than
 * it is:
 *   - Single-process. If the app ever splits across multiple Node
 *     processes (load balancer behind app servers), this falls back
 *     to per-process locking and the original race opens up across
 *     processes. The fix at that point is a Redis SET NX or a Postgres
 *     advisory lock. For the current single-server SQLite design, this
 *     is sufficient.
 *   - Fair-ish ordering (FIFO) within a key. Different keys are
 *     independent — no global queueing.
 *   - No deadlock detection; callers must not hold two locks at once.
 *
 * Usage:
 *   await withLock(`user:${userId}`, async () => { ... });
 */

type Waiter = () => void;
const waiters = new Map<string, Waiter[]>();
const held = new Set<string>();

export async function acquireLock(key: string): Promise<() => void> {
  if (held.has(key)) {
    await new Promise<void>((resolve) => {
      const q = waiters.get(key) ?? [];
      q.push(resolve);
      waiters.set(key, q);
    });
  }
  held.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.delete(key);
    const q = waiters.get(key);
    if (q && q.length > 0) {
      const next = q.shift()!;
      if (q.length === 0) waiters.delete(key);
      // Re-mark held *immediately* so the next waiter sees it as taken
      // when their await resolves.
      held.add(key);
      next();
    }
  };
}

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireLock(key);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test-only: snapshot internal state for assertions. NEVER call from
 * production code. */
export const __internal = {
  isHeld(key: string): boolean {
    return held.has(key);
  },
  waiterCount(key: string): number {
    return waiters.get(key)?.length ?? 0;
  },
  clear() {
    waiters.clear();
    held.clear();
  },
};
