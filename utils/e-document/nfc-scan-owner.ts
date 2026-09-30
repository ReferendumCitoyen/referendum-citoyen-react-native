/**
 * The NFC scan owns its wait (rule R11 and item 11 A/B of the 2.0.2 dossier).
 *
 * One owner per Step 6 instance. An attempt goes through three phases:
 *
 *   1. an optional pre-arm wait (Android: the camera2 teardown gap);
 *   2. the native scan, raced against this platform's timer;
 *   3. one settlement: result, error, or cancelled.
 *
 * `cancel()` (the Annuler button, leaving the step, unmounting) invalidates
 * the attempt's generation, clears its timers, releases the native reader if
 * it was armed, and settles the JavaScript wait through the `cancelled`
 * branch. That last part matters on Android: EDocumentModule.kt's
 * cancelActiveScan releases the reader but deliberately never settles the
 * pending native promise, so without our own branch the wait would hang.
 *
 * Every timer and every native settlement re-checks its token, so a stale
 * timer can never cancel a newer scan, and a native result that arrives after
 * a cancel is dropped. Leaving during the pre-arm wait never arms the reader:
 * the arm step runs only if the token is still current.
 *
 * Timers, per the project decisions of 21/09:
 *   - iOS: no read timer. CoreNFC closes its own session at 60 s; a JS timer
 *     racing it produced the UnexpectedError bursts. A 75 s safety net covers
 *     a native promise that never settles.
 *   - Android: 60 s, with the Cancel button always available.
 */
import { createAttemptGeneration, type AttemptToken } from '@/utils/attempt-generation';

export const NFC_SCAN_TIMEOUT_MESSAGE = 'NFC scan timeout';
export const IOS_SAFETY_NET_MS = 75_000;
export const ANDROID_SCAN_TIMEOUT_MS = 60_000;
export const ANDROID_MIN_GAP_MS = 5_000;
export const IOS_RETRY_COOLDOWN_MS = 3_000;

export type CancelReason = 'cancelled' | 'left' | 'superseded';

export type ScanOutcome<T> =
  | { kind: 'result'; value: T; elapsedMs: number }
  | { kind: 'error'; error: unknown; elapsedMs: number }
  | { kind: 'cancelled'; reason: CancelReason };

export interface NfcScanOwnerDeps {
  platform: string;
  /** Releases the native reader session (modules/e-document cancelScan). */
  cancelNative: () => Promise<void>;
  now?: () => number;
}

export interface StartScanOptions<T> {
  /** Wait before arming the reader. The arm step re-checks ownership after it. */
  preArmWaitMs?: number;
  /** Runs right before the native scan starts, only if still the owner. */
  onArm?: () => void;
  /** Starts the native scan. Called at most once, and only if still the owner. */
  scan: () => Promise<T>;
}

export interface ScanHandle<T> {
  /** Opaque, in memory only: never log it. */
  token: AttemptToken;
  done: Promise<ScanOutcome<T>>;
}

export interface NfcScanOwner {
  start<T>(options: StartScanOptions<T>): ScanHandle<T>;
  /**
   * Ends whatever the current attempt is doing and invalidates its token (and
   * therefore every deferred callback guarded by it). Returns true when an
   * attempt was still waiting.
   */
  cancel(reason?: Exclude<CancelReason, 'superseded'>): boolean;
  isCurrent(token: AttemptToken): boolean;
  /**
   * The token right now, before any start(). Lets a caller that awaits
   * something before starting (a permission check, a module import) notice
   * that a cancel happened meanwhile: the token is no longer current.
   */
  currentToken(): AttemptToken;
  /** True between start() and the attempt's settlement. */
  isBusy(): boolean;
}

/**
 * Attempts in progress across every owner of the process. Read by the SDK's
 * circuit validation gate (utils/circuit-preload.ts): a circuit JSON is not
 * validated while an NFC read owns the phone (dossier 2.0.2, item 15).
 */
let attemptsInProgress = 0;
export function isAnyNfcScanInProgress(): boolean {
  return attemptsInProgress > 0;
}

interface Attempt {
  token: AttemptToken;
  timers: Set<ReturnType<typeof setTimeout>>;
  armed: boolean;
  settled: boolean;
  settle: (outcome: ScanOutcome<any>) => void;
}

export function createNfcScanOwner(deps: NfcScanOwnerDeps): NfcScanOwner {
  const generation = createAttemptGeneration();
  const now = deps.now ?? (() => Date.now());
  let active: Attempt | null = null;

  const releaseNative = () => {
    try {
      // Best effort: a failure to release must never block the Retry screen.
      deps.cancelNative().catch(() => {});
    } catch {
      // ignore, see above
    }
  };

  const finish = (attempt: Attempt, outcome: ScanOutcome<any>) => {
    if (attempt.settled) return;
    attempt.settled = true;
    attemptsInProgress = Math.max(0, attemptsInProgress - 1);
    attempt.timers.forEach((id) => clearTimeout(id));
    attempt.timers.clear();
    if (active === attempt) active = null;
    attempt.settle(outcome);
  };

  const later = (attempt: Attempt, ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      attempt.timers.delete(id);
      if (!generation.isCurrent(attempt.token) || attempt.settled) return;
      fn();
    }, ms);
    attempt.timers.add(id);
  };

  const cancelActive = (reason: CancelReason): boolean => {
    const attempt = active;
    if (!attempt) return false;
    const wasArmed = attempt.armed;
    finish(attempt, { kind: 'cancelled', reason });
    // A superseded attempt is released by the next native scanDocument call
    // itself (both platforms self-cancel), so only an explicit cancel asks.
    if (wasArmed && reason !== 'superseded') releaseNative();
    return true;
  };

  return {
    start<T>(options: StartScanOptions<T>): ScanHandle<T> {
      cancelActive('superseded');
      const token = generation.next();
      let settle!: (outcome: ScanOutcome<T>) => void;
      const done = new Promise<ScanOutcome<T>>((resolve) => { settle = resolve; });
      const attempt: Attempt = { token, timers: new Set(), armed: false, settled: false, settle };
      active = attempt;
      attemptsInProgress++;

      const arm = () => {
        if (!generation.isCurrent(token) || attempt.settled) return;
        options.onArm?.();
        attempt.armed = true;
        const startedAt = now();
        const elapsed = () => now() - startedAt;

        const timeoutMs = deps.platform === 'ios' ? IOS_SAFETY_NET_MS : ANDROID_SCAN_TIMEOUT_MS;
        later(attempt, timeoutMs, () => {
          // Still armed after the limit: release the reader, then say so.
          releaseNative();
          finish(attempt, { kind: 'error', error: new Error(NFC_SCAN_TIMEOUT_MESSAGE), elapsedMs: elapsed() });
        });

        let scanPromise: Promise<T>;
        try {
          scanPromise = options.scan();
        } catch (error) {
          finish(attempt, { kind: 'error', error, elapsedMs: elapsed() });
          return;
        }
        // A settlement after cancel or timeout lands here too and is dropped
        // by finish(), which also keeps it from becoming an unhandled rejection.
        scanPromise.then(
          (value) => {
            if (generation.isCurrent(token)) finish(attempt, { kind: 'result', value, elapsedMs: elapsed() });
          },
          (error) => {
            if (generation.isCurrent(token)) finish(attempt, { kind: 'error', error, elapsedMs: elapsed() });
          },
        );
      };

      const wait = options.preArmWaitMs ?? 0;
      if (wait > 0) later(attempt, wait, arm);
      else arm();

      return { token, done };
    },

    cancel(reason = 'cancelled') {
      const hadAttempt = cancelActive(reason);
      // Bump even with nothing in flight: deferred callbacks of a finished
      // attempt (the 500 ms hand-off to the next step) must die with it.
      generation.next();
      return hadAttempt;
    },

    isCurrent: (token) => generation.isCurrent(token),
    currentToken: () => generation.current(),
    isBusy: () => active !== null,
  };
}
