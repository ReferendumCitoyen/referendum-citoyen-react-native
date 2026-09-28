import { useEffect, useRef } from 'react';

/** How long Step 7 waits for the SDK refs before calling it a real failure. */
export const MISSING_DATA_TIMEOUT_MS = 30_000;
/** A timer that fires this much later than asked means the JS thread was
 * blocked, not that the refs failed to arrive. */
export const BLOCKED_SLACK_MS = 5_000;
/** Extra wait granted after a blocked expiry, so the replies that queued up
 * behind the blockage get their turn. */
export const BLOCKED_GRACE_MS = 5_000;
/** Graces granted at most: a thread that keeps blocking still ends on the
 * real error, just later. */
export const MAX_BLOCKED_GRACES = 2;

/**
 * Step 7's "the refs never arrived" watchdog, made blocking-aware (dossier
 * 2.0.2, item 5 c).
 *
 * The plain 30 s timer fired falsely whenever the JS thread had been frozen
 * (the synchronous CSCA PEM parse, 32 to 50 s on low-end Android): the timer
 * callback ran first when the thread came back, before the AsyncStorage reply
 * that would have delivered `rarime` a few milliseconds later, and it tested
 * the values its closure had captured at arming time.
 *
 * Here the timer records when it was armed. On expiry:
 *   - it reads `ready` through a ref, so a value that arrived meanwhile counts;
 *   - if it fired more than BLOCKED_SLACK_MS late, the thread was blocked, and
 *     it re-arms a BLOCKED_GRACE_MS grace instead of failing (at most
 *     MAX_BLOCKED_GRACES times);
 *   - otherwise it calls `onExpire`. A genuine failure on a free thread still
 *     surfaces at 30 s.
 */
export function useMissingDataWatchdog(args: {
  /** True while the step is waiting for the refs and has not concluded. */
  armed: boolean;
  /** True once everything the step waits for is present. */
  ready: boolean;
  onExpire: () => void;
  /** How long to wait before calling it a failure. Defaults to the 30 s the
   *  step uses in production; the QA gallery raises it so the state it claims
   *  to show ("Vérification en cours...") is the state it still shows when the
   *  screenshot is taken (QA iPhone 2.0.2, item 3). */
  timeoutMs?: number;
}): void {
  const { armed, ready, timeoutMs = MISSING_DATA_TIMEOUT_MS } = args;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onExpireRef = useRef(args.onExpire);
  onExpireRef.current = args.onExpire;

  useEffect(() => {
    if (!armed || ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let graces = 0;
    const arm = (delayMs: number) => {
      const armedAt = Date.now();
      timer = setTimeout(() => {
        timer = null;
        if (readyRef.current) return;
        const lateMs = Date.now() - armedAt - delayMs;
        if (lateMs > BLOCKED_SLACK_MS && graces < MAX_BLOCKED_GRACES) {
          graces++;
          arm(BLOCKED_GRACE_MS);
          return;
        }
        onExpireRef.current();
      }, delayMs);
    };
    arm(timeoutMs);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [armed, ready, timeoutMs]);
}
