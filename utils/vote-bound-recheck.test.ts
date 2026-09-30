/**
 * REG-11: a slow but successful vote POST must not become "issue inconnue"
 * when the 90 s bound fires.
 *
 * 2.0.1 had no bound on the vote POST. A relayer that answered in three
 * minutes still confirmed, and the voter saw the success screen. 2.0.2 bounded
 * it at 90 s, which is right, and then asked the chain exactly once, at the
 * instant the bound fired. That is the worst possible moment to ask: the bound
 * firing IS the statement that the relayer is still working. A vote seconds
 * from landing therefore read as "la connexion a été perdue après l'envoi",
 * and the voter was told to come back later for a vote that had counted.
 *
 * The bound stays, and nothing is ever POSTed twice. What changes is that the
 * phone keeps asking the CHAIN for a bounded while before it says anything.
 *
 * Before the fix, the first test here returns 'unknown'.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  BOUND_RECHECK_ATTEMPTS,
  BOUND_RECHECK_DELAY_MS,
  OUTCOME_WINDOW_MS,
  decideAfterPost,
  pendingOutcome,
  resetVoteAttempts,
} from '@/utils/vote-attempt';
import { votePostBoundFired, votePostMaybeSent, classifyVoteError } from '@/utils/vote-error-table';
import { VOTE_POST_TIMEOUT_MS } from '@/utils/vote-calldata';

const KEY = 'mainnet:73:doc';

/** A reader that starts saying "voted" after `afterReads` refusals. */
function landsAfter(afterReads: number) {
  let reads = 0;
  return {
    read: async () => ++reads > afterReads,
    get reads() {
      return reads;
    },
  };
}

const recheck = (sleep: (ms: number) => Promise<void>) => ({
  attempts: BOUND_RECHECK_ATTEMPTS,
  delayMs: BOUND_RECHECK_DELAY_MS,
  sleep,
});

beforeEach(() => resetVoteAttempts());

describe('a vote that lands after the bound fired', () => {
  it('is reported as counted, not as an unknown outcome', async () => {
    const chain = landsAfter(2); // on chain by the third look
    const slept: number[] = [];
    const decision = await decideAfterPost({
      key: KEY,
      outcomeUnknown: true,
      read: chain.read,
      recheck: recheck(async (ms) => {
        slept.push(ms);
      }),
    });
    expect(decision.kind).toBe('success-pending');
    expect(chain.reads).toBe(3);
    // It waited between reads rather than spinning.
    expect(slept).toEqual([BOUND_RECHECK_DELAY_MS, BOUND_RECHECK_DELAY_MS]);
    // And nothing is left marked pending, so Retry is not needed.
    expect(pendingOutcome(KEY).state).toBe('none');
  });

  it('stops at the first look that finds it, and never sends anything', async () => {
    const chain = landsAfter(0);
    const decision = await decideAfterPost({
      key: KEY,
      outcomeUnknown: true,
      read: chain.read,
      recheck: recheck(async () => {}),
    });
    expect(decision.kind).toBe('success-pending');
    expect(chain.reads).toBe(1);
  });

  it('tells the screen it is still looking, so nothing freezes', async () => {
    let waits = 0;
    await decideAfterPost({
      key: KEY,
      outcomeUnknown: true,
      read: async () => false,
      recheck: { ...recheck(async () => {}), onWaiting: () => waits++ },
    });
    expect(waits).toBe(BOUND_RECHECK_ATTEMPTS - 1);
  });
});

describe('a vote that really did not land', () => {
  it('still ends as unknown, after the whole window, and is remembered', async () => {
    const chain = landsAfter(Number.MAX_SAFE_INTEGER);
    const decision = await decideAfterPost({
      key: KEY,
      outcomeUnknown: true,
      read: chain.read,
      recheck: recheck(async () => {}),
    });
    expect(decision.kind).toBe('unknown');
    expect(chain.reads).toBe(BOUND_RECHECK_ATTEMPTS);
    // Retry must still re-read rather than send a second vote (R4).
    expect(pendingOutcome(KEY).state).toBe('pending');
  });

  it('an unreadable chain is not a failure either', async () => {
    const decision = await decideAfterPost({
      key: KEY,
      outcomeUnknown: true,
      read: async () => {
        throw new Error('RPC down');
      },
      recheck: recheck(async () => {}),
    });
    expect(decision.kind).toBe('unknown');
  });
});

describe('the lost-answer path is untouched', () => {
  it('still asks exactly once when no recheck window is given', async () => {
    const chain = landsAfter(1);
    const decision = await decideAfterPost({ key: KEY, outcomeUnknown: true, read: chain.read });
    expect(decision.kind).toBe('unknown');
    expect(chain.reads).toBe(1);
  });

  it('and a relayer refusal is still a plain failure', async () => {
    const decision = await decideAfterPost({
      key: KEY,
      outcomeUnknown: false,
      read: async () => false,
    });
    expect(decision.kind).toBe('failed');
  });
});

describe('the bound itself is kept', () => {
  it('is still 90 s', () => {
    expect(VOTE_POST_TIMEOUT_MS).toBe(90_000);
  });

  it('and the whole look-again window stays inside the attempt window', () => {
    const window = BOUND_RECHECK_ATTEMPTS * BOUND_RECHECK_DELAY_MS;
    expect(window).toBeLessThan(OUTCOME_WINDOW_MS);
    // Long enough to cover the three minute relayer 2.0.1 tolerated.
    expect(VOTE_POST_TIMEOUT_MS + window).toBeGreaterThanOrEqual(180_000);
  });
});

describe('only the bound gets the longer look', () => {
  const bound = Object.assign(new Error('[SDK] vote POST without answer within 90 s'), {
    votePostSent: true,
    code: 'VOTE_POST_SENT',
    votePostBoundFired: true,
  });
  const lost = Object.assign(new Error('[SDK] vote POST without answer: Network request failed'), {
    votePostSent: true,
    code: 'VOTE_POST_SENT',
  });

  it('tells the two apart', () => {
    expect(votePostBoundFired(bound)).toBe(true);
    expect(votePostBoundFired(lost)).toBe(false);
    // Both are still "may have left the phone", so neither is ever re-sent.
    expect(votePostMaybeSent(bound)).toBe(true);
    expect(votePostMaybeSent(lost)).toBe(true);
  });

  it('and both still classify as an unknown outcome, never as a failure', () => {
    for (const err of [bound, lost]) {
      expect(classifyVoteError(err, { localIneligibility: null, dateChanged: false })).toBe(
        'outcome-unknown',
      );
    }
  });
});
