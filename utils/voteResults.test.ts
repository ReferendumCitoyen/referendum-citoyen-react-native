import {
  computeVoteResults,
  isFrenchCompatible,
  FRA_BIGINT,
} from './voteResults';

describe('computeVoteResults', () => {
  it('returns empty totals when votingResults is null/undefined/empty', () => {
    expect(computeVoteResults(null, 3)).toEqual({ percents: [], counts: [], total: 0 });
    expect(computeVoteResults(undefined, 3)).toEqual({ percents: [], counts: [], total: 0 });
    expect(computeVoteResults([], 3)).toEqual({ percents: [], counts: [], total: 0 });
    expect(computeVoteResults([[]], 0)).toEqual({ percents: [], counts: [], total: 0 });
  });

  it('handles a no-votes-yet proposal (total = 0) without dividing by zero', () => {
    const out = computeVoteResults([[0n, 0n, 0n]], 3);
    expect(out.total).toBe(0);
    expect(out.counts).toEqual([0, 0, 0]);
    expect(out.percents).toEqual([0, 0, 0]);
  });

  it('computes correct percentages and counts for a normal 3-variant tally', () => {
    // 2 OUI, 1 BLANC, 1 NON  →  50% / 25% / 25%
    const out = computeVoteResults([[2n, 1n, 1n]], 3);
    expect(out.total).toBe(4);
    expect(out.counts).toEqual([2, 1, 1]);
    expect(out.percents).toEqual([50, 25, 25]);
  });

  it('matches the user-reported 66.7% case (2 / 3)', () => {
    const out = computeVoteResults([[2n, 1n, 0n]], 3);
    expect(out.total).toBe(3);
    expect(out.counts).toEqual([2, 1, 0]);
    expect(out.percents).toEqual([66.66, 33.33, 0]);
  });

  it('slices off contract zero-padding past the actual variant count', () => {
    // Contract returned 5 entries but the question only has 2 variants.
    const out = computeVoteResults([[7n, 3n, 0n, 0n, 0n]], 2);
    expect(out.counts).toEqual([7, 3]);
    expect(out.total).toBe(10);
    expect(out.percents).toEqual([70, 30]);
  });

  it('handles a single-variant proposal', () => {
    const out = computeVoteResults([[42n]], 1);
    expect(out.counts).toEqual([42]);
    expect(out.total).toBe(42);
    expect(out.percents).toEqual([100]);
  });

  it('preserves precision for large counts (millions of votes)', () => {
    const out = computeVoteResults([[3_500_000n, 1_500_000n]], 2);
    expect(out.total).toBe(5_000_000);
    expect(out.counts).toEqual([3_500_000, 1_500_000]);
    expect(out.percents).toEqual([70, 30]);
  });

  it('never reports a percent above 100', () => {
    // Property check on a few skewed cases
    const cases: bigint[][][] = [
      [[1n, 0n]],
      [[1n, 999_999n]],
      [[1n, 1n, 1n]],
    ];
    for (const c of cases) {
      const out = computeVoteResults(c, c[0].length);
      for (const p of out.percents) {
        expect(p).toBeLessThanOrEqual(100);
        expect(p).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('isFrenchCompatible', () => {
  // Build a minimal ProposalInfo-shaped fixture; only `criteria` is read.
  const proposalWithWhitelist = (whitelist: bigint[]) =>
    ({ criteria: { citizenshipWhitelist: whitelist } } as any);

  const FRA = FRA_BIGINT;
  const DEU = BigInt('0x' + Buffer.from('DEU').toString('hex'));
  const USA = BigInt('0x' + Buffer.from('USA').toString('hex'));

  it('FRA_BIGINT matches the documented packed-ASCII encoding', () => {
    // "FRA" = 0x46 0x52 0x41 → 0x465241 → 4_608_577
    expect(FRA).toBe(4_608_577n);
    expect(FRA).toBe(BigInt('0x465241'));
  });

  it('treats an empty whitelist as open to all (including FRA)', () => {
    expect(isFrenchCompatible(proposalWithWhitelist([]))).toBe(true);
  });

  it('treats a missing criteria as open (defensive — should not throw)', () => {
    expect(isFrenchCompatible({} as any)).toBe(true);
    expect(isFrenchCompatible({ criteria: {} } as any)).toBe(true);
  });

  it('returns true when FRA is in the whitelist (alone)', () => {
    expect(isFrenchCompatible(proposalWithWhitelist([FRA]))).toBe(true);
  });

  it('returns true when FRA is in the whitelist with other countries', () => {
    expect(isFrenchCompatible(proposalWithWhitelist([DEU, FRA, USA]))).toBe(true);
  });

  it('returns false when FRA is absent from a non-empty whitelist', () => {
    expect(isFrenchCompatible(proposalWithWhitelist([DEU, USA]))).toBe(false);
    expect(isFrenchCompatible(proposalWithWhitelist([USA]))).toBe(false);
  });
});
