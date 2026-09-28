/**
 * The registration submission as a state machine (dossier 2.0.2, R3 and
 * item 3). Kept free of React and of the SDK so every transition is testable.
 *
 *   not sent ──prove fails / dry run refuses──▶ certainly failed (may retry)
 *      │
 *      └─POST──▶ sent, outcome unknown ──poll finds the leaf──▶ confirmed
 *                  │  (lost answer, 90 s bound, `false`, SMT not yet showing,
 *                  │   transient RPC 5xx: all of these are "unknown")
 *                  └─window over──▶ "confirmation en attente", never "failed"
 *
 * Only "certainly failed" lets a later run POST again, and nothing here ever
 * POSTs twice by itself. A lost answer or an "already registered" refusal gets
 * the one approved status re-read (project decision, 21/09: an existing request repeated,
 * none added) before anything is shown.
 *
 * TODO(PROTOCOL-LEAD-A): a proof started before the user left the flow still posts,
 * with the key captured at the start of the attempt (point 3 b, "Do not abort
 * A"). Awaiting Rarimo confirmation (protocol lead): the alternative is to abort the
 * run before the POST, which would throw away a registration the relayer may
 * already be about to accept, and leave the phone with a proof nobody sent.
 *
 * Double run. A module-level, in-memory marker keyed by network, document and
 * the attempt's captured key is taken BEFORE the proof. A second run for the
 * same document and key (the vote closed with the X during the proof, then
 * reopened and rescanned: field report of 20/09) finds it, waits for the
 * first run's outcome and adopts it instead of proving again. Only the owner
 * releases its marker. The owner keeps submitting and polling after its screen
 * is gone (aborting after the relayer accepted would leave a registration the
 * app no longer knows about); the caller drops its UI callbacks.
 *
 * Nothing here logs the marker, the key, the document hash or the pending
 * slot; the slot's age in seconds is the only value that may appear.
 */
import type { Network } from '@/constants/rarime-config';
import {
  REGISTRATION_OUTCOME_UNKNOWN,
  REGISTRATION_PENDING,
  REGISTRATION_REVERT,
  isOutcomeUnknown,
} from '@/utils/registration-sentinels';

export type SubmissionOutcome = 'confirmed' | 'certainly-failed' | 'unknown';

// ---------------------------------------------------------------------------
// In-flight marker
// ---------------------------------------------------------------------------

interface InflightEntry {
  owner: symbol;
  done: Promise<SubmissionOutcome>;
  /** Kept after a confirmation so a run that read NotRegistered a moment
   * before the owner finished still adopts it; removed otherwise. */
  settled?: SubmissionOutcome;
}

const inflight = new Map<string, InflightEntry>();

function markerKey(network: Network, passportHash: string, privateKey: string): string {
  return `${network}\u0000${passportHash}\u0000${privateKey}`;
}

export interface InflightHandle {
  settle: (outcome: SubmissionOutcome) => void;
}

/** Take the marker, or return the outcome promise of the run that holds it. */
function claim(
  key: string,
): { handle: InflightHandle } | { adopt: Promise<SubmissionOutcome> } {
  const existing = inflight.get(key);
  if (existing) return { adopt: existing.done };
  const owner = Symbol('registration-owner');
  let resolve!: (o: SubmissionOutcome) => void;
  const done = new Promise<SubmissionOutcome>((r) => { resolve = r; });
  const entry: InflightEntry = { owner, done };
  inflight.set(key, entry);
  return {
    handle: {
      settle: (outcome) => {
        if (entry.settled) return;
        entry.settled = outcome;
        resolve(outcome);
        // Owner-only release: a newer entry under the same key (impossible
        // while this one is held, but cheap to guarantee) is never touched.
        if (outcome !== 'confirmed' && inflight.get(key)?.owner === owner) {
          inflight.delete(key);
        }
      },
    },
  };
}

/** Test hook. */
export function __resetRegistrationInflightForTests(): void {
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : '';
}

/**
 * A refusal that may simply mean "this key already registered it": the dry
 * run's "StateKeeper: passport already registered" (the local simulation,
 * before any POST), or the relayer saying the same. Not the
 * [IDENTITY_BOUND_ELSEWHERE] refusal, which is about another document.
 */
export function isAlreadyRegisteredRefusal(err: unknown): boolean {
  const msg = messageOf(err);
  const fromRegistration =
    msg.startsWith(REGISTRATION_REVERT) || msg.startsWith('[registerViaNoir] relayer');
  return fromRegistration && /already\s+registered/i.test(msg);
}

/**
 * A transient RPC failure during the confirmation poll: an HTTP 502/503/504,
 * possibly with an HTML body from the gateway (l2.rarimo.com, 21/09 13:29 UTC:
 * 39 × 503 and 4 × 502 in one wait). Outcome unknown, retried with backoff,
 * never counted as a failure, never logged or shown.
 */
export function isTransientRpcError(err: unknown): boolean {
  const msg = messageOf(err);
  if (!msg) return false;
  return (
    /\b50[234]\b/.test(msg) ||
    /<\s*(!doctype|html)/i.test(msg) ||
    /bad gateway|service unavailable|service temporarily unavailable|gateway time-?out/i.test(msg)
  );
}

function pendingError(serviceUnavailable: boolean): Error {
  return new Error(
    `${REGISTRATION_PENDING}${serviceUnavailable ? ' service-unavailable' : ''} registration sent, not confirmed yet`,
  );
}

// ---------------------------------------------------------------------------
// Confirmation wait
// ---------------------------------------------------------------------------

export const CONFIRM_TIMEOUT_MS = 300_000;
export const STILL_CONFIRMING_AFTER_MS = 60_000;
export const PENDING_SLOT_POLL_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 15_000;
/**
 * Bound on ONE read of the confirmation poll or of the status re-read (plan
 * D11). Without it a single hung RPC read held the whole
 * 300 s window: the loop never got to compare with its deadline.
 */
export const POLL_READ_TIMEOUT_MS = 15_000;

/**
 * `read()`, or `onTimeout` if it has not settled within `timeoutMs`. The read
 * itself is not cancelled (an RPC call cannot be); its late result is ignored.
 */
export async function boundedRead<T>(read: () => Promise<T>, timeoutMs: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type PollResult = 'found' | 'absent' | 'transient';

export interface WaitDeps {
  /** One SMT read: the leaf is there, not there, or the RPC is having a bad
   * moment (5xx). Must not throw. */
  pollOnce: () => Promise<PollResult>;
  now?: () => number;
  /** Sleep `ms`, or less if `wake` is called. */
  sleep?: (ms: number, onWake: (wake: () => void) => void) => Promise<void>;
  /** Subscribe to "the app came back to the foreground". */
  onResume?: (cb: () => void) => () => void;
  keepAwake?: { activate: (tag: string) => Promise<void> | void; deactivate: (tag: string) => void };
}

const defaultSleep = (ms: number, onWake: (wake: () => void) => void) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    onWake(() => {
      clearTimeout(timer);
      resolve();
    });
  });

let keepAwakeCounter = 0;

/**
 * Poll until the leaf shows up or `timeoutMs` has passed. Holds its own
 * keep-awake tag for the duration (iOS suspends JS on auto-lock, which is how
 * a landed registration used to "time out"), polls right away when the app
 * returns to the foreground, and always polls once more after a sleep before
 * comparing with the deadline, so a phone that slept through the window still
 * gets its answer instead of an instant timeout.
 */
export async function waitForConfirmation(
  deps: WaitDeps,
  timeoutMs: number,
  onStillConfirming?: () => void,
): Promise<{ confirmed: boolean; sawTransient: boolean }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const tag = `registration-wait-${++keepAwakeCounter}`;
  let keepAwakeHeld = false;
  try {
    await deps.keepAwake?.activate(tag);
    keepAwakeHeld = !!deps.keepAwake;
  } catch {}
  let wake: (() => void) | null = null;
  const unsubscribe = deps.onResume?.(() => wake?.());
  const start = now();
  let sawTransient = false;
  let stillShown = false;
  let interval = POLL_INTERVAL_MS;
  try {
    for (;;) {
      // A read that hangs past 15 s counts as a transient RPC failure: retried
      // with backoff, the window keeps running.
      const r = await boundedRead(deps.pollOnce, POLL_READ_TIMEOUT_MS, 'transient' as PollResult);
      if (r === 'found') return { confirmed: true, sawTransient };
      if (r === 'transient') {
        sawTransient = true;
        interval = Math.min(MAX_BACKOFF_MS, interval * 2);
      } else {
        interval = POLL_INTERVAL_MS;
      }
      const elapsed = now() - start;
      if (!stillShown && elapsed >= STILL_CONFIRMING_AFTER_MS) {
        stillShown = true;
        onStillConfirming?.();
      }
      if (elapsed >= timeoutMs) return { confirmed: false, sawTransient };
      await sleep(Math.min(interval, Math.max(0, timeoutMs - elapsed)), (w) => { wake = w; });
      wake = null;
    }
  } finally {
    unsubscribe?.();
    if (keepAwakeHeld) {
      try { deps.keepAwake!.deactivate(tag); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type DocumentStatusRead = 'this-key' | 'not-registered' | 'other' | 'unknown';

export interface RegistrationRunDeps extends WaitDeps {
  network: Network;
  passportHash: string;
  privateKey: string;
  /** Build the proof. Throws when it cannot: nothing has been sent then. */
  prove: () => Promise<void>;
  /** Send it. Must throw an error prefixed REGISTRATION_OUTCOME_UNKNOWN when
   * the request left but its answer did not come back. Returns the tx hash
   * when there is one. */
  submit: () => Promise<{ txHash?: string }>;
  /** Wait for the leaf after sending (mainnet). Testnet's light path has no
   * poll: pass false. */
  confirmOnChain: boolean;
  /** The one approved status re-read (same request as the initial read). */
  readStatus: () => Promise<DocumentStatusRead>;
  pendingSlot?: {
    ageMs: () => Promise<number | null>;
    /** Name this attempt as the slot's owner, before anything is proved or
     * sent. TODO(PROTOCOL-LEAD-B): marker shape awaiting Rarimo confirmation. */
    arm?: () => void;
    /** AV4: durable "sent, outcome unknown" marker, written before the POST.
     * The relayer POST writes one too; both are the same record.
     * TODO(PROTOCOL-LEAD-B): marker shape awaiting Rarimo confirmation. */
    markSent?: () => Promise<void>;
    /** Stamps "sent, not confirmed yet" once the relayer accepted. The caller
     *  names its own run; the slot stores a timestamp, its state and that
     *  owner, never the transaction hash (C1,
     *  utils/registration-pending-slot.ts). */
    write: () => Promise<void>;
    clear: () => Promise<void>;
  };
  /** UI hooks. The caller drops them once its screen is gone. */
  ui?: {
    confirming?: () => void;
    stillConfirming?: () => void;
  };
  log?: (line: string) => void;
}

export interface RegistrationRunResult {
  /** True when a registration of this document with this key is confirmed. */
  registered: true;
  /** How: this run proved and sent it, another run did, or it was already on
   * chain when re-read. */
  via: 'this-run' | 'adopted' | 're-read' | 'pending-slot';
}

/**
 * Register the document, or adopt the outcome of the run already doing it.
 * Resolves on confirmation; rejects with the original error when the
 * registration certainly failed, or with a REGISTRATION_PENDING error when it
 * was sent and could not be confirmed in the window.
 */
export async function runRegistration(deps: RegistrationRunDeps): Promise<RegistrationRunResult> {
  const key = markerKey(deps.network, deps.passportHash, deps.privateKey);
  const log = deps.log ?? (() => {});

  for (;;) {
    const claimed = claim(key);
    if ('adopt' in claimed) {
      deps.ui?.confirming?.();
      log('[Step7] registration already in progress for this document: waiting for it');
      const outcome = await claimed.adopt;
      if (outcome === 'confirmed') return { registered: true, via: 'adopted' };
      if (outcome === 'unknown') throw pendingError(false);
      // The first run certainly failed before sending: this one may try.
      continue;
    }
    const { handle } = claimed;
    let outcome: SubmissionOutcome = 'certainly-failed';
    try {
      const result = await ownRun(deps, log);
      outcome = 'confirmed';
      return result;
    } catch (e) {
      outcome = isPendingOrUnknown(e) ? 'unknown' : 'certainly-failed';
      throw e;
    } finally {
      handle.settle(outcome);
    }
  }
}

function isPendingOrUnknown(e: unknown): boolean {
  const msg = messageOf(e);
  return msg.startsWith(REGISTRATION_PENDING) || msg.startsWith(REGISTRATION_OUTCOME_UNKNOWN);
}

async function ownRun(deps: RegistrationRunDeps, log: (l: string) => void): Promise<RegistrationRunResult> {
  // 2c: a registration sent less than an hour ago and not confirmed then.
  // One bounded poll before proving again; no background polling.
  if (deps.confirmOnChain && deps.pendingSlot) {
    const age = await deps.pendingSlot.ageMs();
    if (age !== null) {
      log(`[Step7] earlier registration pending (age ${Math.round(age / 1000)}s): checking before proving`);
      deps.ui?.confirming?.();
      const { confirmed } = await waitForConfirmation(deps, PENDING_SLOT_POLL_MS);
      await deps.pendingSlot.clear();
      if (confirmed) return { registered: true, via: 'pending-slot' };
    }
  }

  // Everything from here on belongs to this attempt: the marker the POST
  // writes must name it.
  // TODO(PROTOCOL-LEAD-B): shape of the durable pending marker awaiting Rarimo
  // confirmation (utils/registration-pending-slot.ts, buildSlotRecord).
  deps.pendingSlot?.arm?.();

  // Not sent yet: any failure here is "certainly failed".
  try {
    await deps.prove();
  } catch (e) {
    return await afterRefusal(deps, e);
  }

  // AV4: the trace goes down BEFORE the request, not after the answer. A POST
  // whose answer is lost and a process killed before the re-read used to leave
  // nothing, and the next run proved and sent again. The relayer POST writes
  // the same marker itself, for the paths that do not come through here;
  // writing it twice is writing the same record twice.
  await deps.pendingSlot?.markSent?.();
  try {
    // The relayer answers with a transaction hash. It is deliberately not
    // kept: the pending slot stores a timestamp only (C1).
    await deps.submit();
  } catch (e) {
    if (isOutcomeUnknown(e)) {
      // Sent, answer lost. Never re-POST: re-read once, then wait.
      log('[Step7] registration sent but its answer was lost: checking the chain instead of sending again');
      if ((await safeReadStatus(deps)) === 'this-key') return { registered: true, via: 're-read' };
      if (!deps.confirmOnChain) throw pendingError(false);
      return await confirm(deps);
    }
    return await afterRefusal(deps, e);
  }

  // Accepted: the same slot, promoted from "sent" to "accepted". Decision D-5
  // is settled (AV4): the marker goes down before the POST, and the relayer's
  // transaction hash is still never stored (C1).
  if (deps.pendingSlot) await deps.pendingSlot.write();
  if (!deps.confirmOnChain) return { registered: true, via: 'this-run' };
  return await confirm(deps);
}

/** "Already registered" gets the one approved re-read; anything else stands. */
async function afterRefusal(deps: RegistrationRunDeps, e: unknown): Promise<RegistrationRunResult> {
  if (isAlreadyRegisteredRefusal(e) && (await safeReadStatus(deps)) === 'this-key') {
    return { registered: true, via: 're-read' };
  }
  throw e;
}

async function safeReadStatus(deps: RegistrationRunDeps): Promise<DocumentStatusRead> {
  try {
    return await boundedRead(deps.readStatus, POLL_READ_TIMEOUT_MS, 'unknown' as DocumentStatusRead);
  } catch {
    return 'unknown';
  }
}

async function confirm(deps: RegistrationRunDeps): Promise<RegistrationRunResult> {
  deps.ui?.confirming?.();
  const { confirmed, sawTransient } = await waitForConfirmation(
    deps,
    CONFIRM_TIMEOUT_MS,
    deps.ui?.stillConfirming,
  );
  if (!confirmed) throw pendingError(sawTransient);
  if (deps.pendingSlot) await deps.pendingSlot.clear();
  return { registered: true, via: 'this-run' };
}
