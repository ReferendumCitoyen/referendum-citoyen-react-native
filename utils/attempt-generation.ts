/**
 * Attempt generations (rule R1 of the 2.0.2 dossier).
 *
 * A generation is a counter owned by one resource or one flow. Starting a new
 * attempt, cancelling, or leaving bumps it; everything that was started under
 * an older value (a native callback, a timer, an `await` continuation) checks
 * its token before acting and silently does nothing when it is stale. That is
 * the whole mechanism: no flags to reset, and a stale cleanup can never undo
 * a newer attempt, because it can only act while its own token is current.
 *
 * Tokens live in memory only. They carry no meaning outside this process and
 * must never be logged, persisted or sent anywhere: they are an ordering
 * device, not an identifier.
 *
 * Two kinds of owners use this today:
 *   - the voting flow as a whole (one instance per mounted app/voting-flow.tsx,
 *     never a module singleton: an old screen unmounting after the new one
 *     mounted must not invalidate the new one), bumped when the flow is
 *     (re)entered, left or unmounted, and when a new document scan starts a
 *     new attempt, so late results from a previous attempt are dropped;
 *   - each exclusive resource, with its own instance (the NFC scan in
 *     utils/e-document/nfc-scan-owner.ts). Registration and vote code can do
 *     the same with `createAttemptGeneration()`.
 */

export type AttemptToken = number;

export interface AttemptGeneration {
  /** Starts a new attempt: every token issued before this one becomes stale. */
  next(): AttemptToken;
  /** The token of the attempt in progress (the last one `next` returned). */
  current(): AttemptToken;
  /** True while `token` is still the latest attempt. */
  isCurrent(token: AttemptToken): boolean;
  /**
   * Wraps `fn` so that it only runs while `token` is current. Handy for
   * timers and callbacks: `setTimeout(gen.guard(token, () => …), 500)`.
   * A stale call returns undefined without running `fn`.
   */
  guard<A extends unknown[], R>(token: AttemptToken, fn: (...args: A) => R): (...args: A) => R | undefined;
}

export function createAttemptGeneration(): AttemptGeneration {
  let value = 0;
  const isCurrent = (token: AttemptToken) => token === value;
  return {
    next: () => {
      value += 1;
      return value;
    },
    current: () => value,
    isCurrent,
    guard: (token, fn) => (...args) => (isCurrent(token) ? fn(...args) : undefined),
  };
}
