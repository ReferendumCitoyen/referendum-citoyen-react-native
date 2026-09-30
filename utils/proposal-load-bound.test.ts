/**
 * P9's bound, on the path it was never applied to: the home screen's proposal
 * reads (traceability 23/09, category 2 item 3).
 *
 * Two halves. The helper does what it says, and the home screen actually uses
 * it at BOTH of its call sites: the defect was not that a bound was hard to
 * write, it was that nobody wrote one here, so the second half is the one that
 * stops it happening again.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  boundedProposalFetch,
  isProposalFetchTimeout,
  PROPOSAL_FETCH_TIMEOUT,
  PROPOSAL_FETCH_TIMEOUT_MS,
} from './proposal-load-bound';

describe('boundedProposalFetch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes the answer through when the read settles in time', async () => {
    const p = boundedProposalFetch(async () => 'proposal 70', '70', 1000);
    await expect(p).resolves.toBe('proposal 70');
  });

  it('rejects once the bound has passed, naming the proposal and the bound', async () => {
    const p = boundedProposalFetch(() => new Promise(() => {}), '70', 20_000);
    const seen = p.catch((e: Error) => e);
    jest.advanceTimersByTime(20_000);
    const err = (await seen) as Error;
    expect(isProposalFetchTimeout(err)).toBe(true);
    expect(err.message).toContain('proposal 70');
    expect(err.message).toContain('20 s');
    // The home screen's catch chooses its network message on this word.
    expect(err.message.toLowerCase()).toContain('timeout');
  });

  it('does not reject one millisecond early', async () => {
    let settled = false;
    const p = boundedProposalFetch(() => new Promise(() => {}), '70', 20_000);
    p.catch(() => {
      settled = true;
    });
    jest.advanceTimersByTime(19_999);
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('a read that throws keeps its own error, not the timeout sentinel', async () => {
    const p = boundedProposalFetch(async () => {
      throw new Error('RPC 503');
    }, '70', 1000);
    await expect(p).rejects.toThrow('RPC 503');
    await p.catch((e: Error) => expect(isProposalFetchTimeout(e)).toBe(false));
  });

  it('a synchronous throw inside the read is a rejection, not a crash', async () => {
    await expect(
      boundedProposalFetch(() => {
        throw new Error('bad id');
      }, '70', 1000),
    ).rejects.toThrow('bad id');
  });

  it('clears its timer when the read wins, so nothing is left pending', async () => {
    await boundedProposalFetch(async () => 'ok', '70', 20_000);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a late answer after the bound changes nothing', async () => {
    let release: (v: string) => void = () => {};
    const p = boundedProposalFetch(() => new Promise<string>((r) => (release = r)), '70', 20_000);
    const seen = p.catch((e: Error) => e);
    jest.advanceTimersByTime(20_000);
    release('too late');
    expect(isProposalFetchTimeout((await seen) as Error)).toBe(true);
  });

  it('the default bound is the one the file documents', () => {
    expect(PROPOSAL_FETCH_TIMEOUT_MS).toBe(20_000);
    expect(PROPOSAL_FETCH_TIMEOUT).toBe('[PROPOSAL_FETCH_TIMEOUT]');
  });
});

describe('the home screen uses it, at every read', () => {
  const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../app/(tabs)/index.tsx'),
    'utf8',
  );

  it('no getProposalInfo call is left unbounded', () => {
    const offenders: string[] = [];
    SOURCE.split('\n').forEach((line, i) => {
      if (!/\bgetProposalInfo\s*\(/.test(line)) return;
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (!/boundedProposalFetch/.test(line)) offenders.push(`app/(tabs)/index.tsx:${i + 1}`);
    });
    expect(offenders).toEqual([]);
  });

  it('and there are still the two reads this covers', () => {
    // fetchProposals (the first paint) and fetchBatch (load more). If a third
    // appears, the check above has to have seen it.
    const calls = SOURCE.split('\n').filter(
      (l) => /\bgetProposalInfo\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l),
    );
    expect(calls).toHaveLength(2);
  });
});
