/**
 * What the app knows about a vote whose POST may have left the phone (R4).
 *
 * A vote is one of: not sent / sent, outcome unknown / confirmed / certainly
 * failed. A network error, a gateway timeout or an unreadable answer AFTER the
 * vote POST is "sent, outcome unknown", never "failed": the relayer may well
 * have broadcast it. So:
 *
 *   1. right after such an error, the status is re-read once with the request
 *      the vote step already makes (FreedomTool.isAlreadyVoted); if the vote is
 *      there, the screen is the success "confirmation en attente";
 *   2. otherwise the attempt is remembered here, in memory only (never logged,
 *      never persisted, keyed by network, proposal and document), and Retry
 *      re-reads the status instead of sending a second vote while the first one
 *      may still land;
 *   3. only once OUTCOME_WINDOW_MS has passed with the vote still absent is the
 *      first attempt treated as failed, and Retry makes a new proof. L2 blocks
 *      are seconds apart; five minutes is the window approved for the
 *      registration's own status re-read (21/09).
 *
 * This also protects the relayer's gas budget: a retried vote on an unknown
 * outcome is a second transaction for the same nullifier.
 */

export const OUTCOME_WINDOW_MS = 300_000;

const unknownOutcomes = new Map<string, number>();

/** Key of one voter's vote on one question. `documentId` is any stable,
 * local identifier of the scanned document; it only ever lives in memory. */
export function voteAttemptKey(network: string, proposalId: string | number, documentId: string): string {
  return `${network}:${String(proposalId)}:${documentId}`;
}

export function markOutcomeUnknown(key: string, now: number = Date.now()): void {
  unknownOutcomes.set(key, now);
}

export function clearOutcome(key: string): void {
  unknownOutcomes.delete(key);
}

export type PendingOutcome =
  /** Nothing sent without an answer: a normal attempt may start. */
  | { state: 'none' }
  /** A POST without an answer, recent enough to still land: do not send. */
  | { state: 'pending'; sinceMs: number }
  /** A POST without an answer, long enough ago to count as failed. */
  | { state: 'expired' };

export function pendingOutcome(key: string, now: number = Date.now()): PendingOutcome {
  const since = unknownOutcomes.get(key);
  if (since === undefined) return { state: 'none' };
  if (now - since < OUTCOME_WINDOW_MS) return { state: 'pending', sinceMs: now - since };
  return { state: 'expired' };
}

/** Test hook. */
export function resetVoteAttempts(): void {
  unknownOutcomes.clear();
}

export type StatusRecheck = 'voted' | 'not-voted' | 'unreadable';

/** The one status re-read: `read` is the existing already-voted request. */
export async function recheckVoteStatus(read: () => Promise<boolean>): Promise<StatusRecheck> {
  try {
    return (await read()) ? 'voted' : 'not-voted';
  } catch {
    return 'unreadable';
  }
}

export type AfterPostDecision =
  | { kind: 'success-pending' }
  | { kind: 'unknown' }
  | { kind: 'failed' };

/**
 * How long to keep asking the chain when the 90 s POST bound is what ended the
 * attempt, and how often (REG-11).
 *
 * A single read is right for a lost answer: the relayer had usually broadcast
 * well before the connection dropped, so the chain already knows. It is the
 * WRONG question to ask at the instant a bound fires, because the bound firing
 * is precisely the statement that the relayer is still working. 2.0.1 had no
 * bound: a relayer answering in three minutes still ended on the success
 * screen. 2.0.2 bounded the POST at 90 s, asked the chain once at that exact
 * instant, and turned a vote that was about to land into "issue inconnue".
 *
 * So the bound stays, and the POST is still never sent twice; what changes is
 * that the phone keeps LOOKING for a while before it says anything. Six reads
 * fifteen seconds apart covers the three minute relayer of 2.0.1 without ever
 * putting a second vote on the wire. Well inside OUTCOME_WINDOW_MS, so a voter
 * who leaves is in the same place as before.
 */
export const BOUND_RECHECK_ATTEMPTS = 6;
export const BOUND_RECHECK_DELAY_MS = 15_000;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * After a failed POST whose outcome is unknown: re-read and decide.
 * `failed` is only returned when the relayer itself answered (not for a lost
 * answer), which the caller signals with `outcomeUnknown: false`.
 *
 * `recheck` extends the single read into a bounded series, for the one case
 * that needs it: the POST bound firing on a vote that may still be landing.
 * It stops at the first read that finds the vote, and reports progress so the
 * screen can say what it is doing instead of freezing.
 */
export async function decideAfterPost(args: {
  key: string;
  outcomeUnknown: boolean;
  read: () => Promise<boolean>;
  now?: number;
  recheck?: {
    attempts: number;
    delayMs: number;
    /** Injected in tests; real callers get setTimeout. */
    sleep?: (ms: number) => Promise<void>;
    /** Called before every wait, so the step can keep the voter informed. */
    onWaiting?: () => void;
  };
}): Promise<AfterPostDecision> {
  const attempts = Math.max(1, args.recheck?.attempts ?? 1);
  const sleep = args.recheck?.sleep ?? wait;
  for (let i = 0; i < attempts; i++) {
    const status = await recheckVoteStatus(args.read);
    if (status === 'voted') {
      clearOutcome(args.key);
      return { kind: 'success-pending' };
    }
    // Nothing yet, and there is still time to look: wait and ask again. Never
    // a second POST, only a second question to the chain.
    if (i < attempts - 1) {
      args.recheck?.onWaiting?.();
      await sleep(args.recheck?.delayMs ?? BOUND_RECHECK_DELAY_MS);
    }
  }
  if (args.outcomeUnknown) {
    markOutcomeUnknown(args.key, args.now);
    return { kind: 'unknown' };
  }
  return { kind: 'failed' };
}

/**
 * Before a new attempt: never send a second vote while the first may land.
 * `proceed` means a normal attempt may start (its own pre-check still runs).
 */
export async function decideBeforeAttempt(args: {
  key: string;
  read: () => Promise<boolean>;
  now?: number;
}): Promise<'proceed' | 'success-pending' | 'still-unknown'> {
  const pending = pendingOutcome(args.key, args.now);
  if (pending.state === 'none') return 'proceed';
  const status = await recheckVoteStatus(args.read);
  if (status === 'voted') {
    clearOutcome(args.key);
    return 'success-pending';
  }
  if (pending.state === 'pending') return 'still-unknown';
  // Window elapsed and the vote is not there: the first attempt failed.
  if (status === 'not-voted') {
    clearOutcome(args.key);
    return 'proceed';
  }
  // Still cannot read the chain: sending blind would risk a double POST.
  return 'still-unknown';
}
