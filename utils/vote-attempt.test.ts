import {
  decideAfterPost,
  decideBeforeAttempt,
  OUTCOME_WINDOW_MS,
  pendingOutcome,
  resetVoteAttempts,
  voteAttemptKey,
} from './vote-attempt';

const key = voteAttemptKey('mainnet', '73', 'doc');
beforeEach(() => resetVoteAttempts());

describe('after a POST without an answer', () => {
  it('the vote is on chain: success pending, nothing remembered', async () => {
    expect(await decideAfterPost({ key, outcomeUnknown: true, read: async () => true })).toEqual({
      kind: 'success-pending',
    });
    expect(pendingOutcome(key)).toEqual({ state: 'none' });
  });

  it('not yet, or the chain cannot be read: unknown, remembered', async () => {
    expect(await decideAfterPost({ key, outcomeUnknown: true, read: async () => false, now: 0 })).toEqual({
      kind: 'unknown',
    });
    expect(pendingOutcome(key, 10)).toMatchObject({ state: 'pending' });
    resetVoteAttempts();
    const unreadable = async () => {
      throw new Error('Network request failed');
    };
    expect(await decideAfterPost({ key, outcomeUnknown: true, read: unreadable, now: 0 })).toEqual({ kind: 'unknown' });
  });

  it('a relayer that answered with an error is not "unknown"', async () => {
    expect(await decideAfterPost({ key, outcomeUnknown: false, read: async () => false })).toEqual({ kind: 'failed' });
    expect(pendingOutcome(key)).toEqual({ state: 'none' });
  });
});

describe('before the next attempt', () => {
  const read = jest.fn(async () => false);
  beforeEach(() => read.mockClear());

  it('nothing pending: proceed without reading anything', async () => {
    expect(await decideBeforeAttempt({ key, read })).toBe('proceed');
    expect(read).not.toHaveBeenCalled();
  });

  it('pending and still absent: do not send', async () => {
    await decideAfterPost({ key, outcomeUnknown: true, read: async () => false, now: 0 });
    expect(await decideBeforeAttempt({ key, read, now: 60_000 })).toBe('still-unknown');
  });

  it('pending and now on chain: success', async () => {
    await decideAfterPost({ key, outcomeUnknown: true, read: async () => false, now: 0 });
    expect(await decideBeforeAttempt({ key, read: async () => true, now: 60_000 })).toBe('success-pending');
    expect(pendingOutcome(key)).toEqual({ state: 'none' });
  });

  it('window elapsed and absent: the first attempt failed, proceed', async () => {
    await decideAfterPost({ key, outcomeUnknown: true, read: async () => false, now: 0 });
    expect(await decideBeforeAttempt({ key, read, now: OUTCOME_WINDOW_MS + 1 })).toBe('proceed');
  });

  it('window elapsed but the chain still cannot be read: do not send blind', async () => {
    await decideAfterPost({ key, outcomeUnknown: true, read: async () => false, now: 0 });
    const unreadable = async () => {
      throw new Error('offline');
    };
    expect(await decideBeforeAttempt({ key, read: unreadable, now: OUTCOME_WINDOW_MS + 1 })).toBe('still-unknown');
  });

  it('another document or question is not held back', async () => {
    await decideAfterPost({ key, outcomeUnknown: true, read: async () => false, now: 0 });
    expect(await decideBeforeAttempt({ key: voteAttemptKey('mainnet', '73', 'other'), read, now: 1 })).toBe('proceed');
  });
});
