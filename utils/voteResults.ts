// Pure helpers for vote-tally rendering and proposal eligibility.
// Extracted out of `app/(tabs)/index.tsx` so they can be unit-tested without
// having to mount the screen.

import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';

export type VoteTotals = {
  percents: number[];
  counts: number[];
  total: number;
};

/**
 * Turns the on-chain `votingResults` matrix into per-variant percentages and
 * counts. The contract returns `bigint[][]` where the first row is the tallies
 * for the first question's variants. The contract may pad with zeros, so we
 * slice to the actual variant count before summing.
 */
export const computeVoteResults = (
  votingResults: bigint[][] | null | undefined,
  variantCount: number,
): VoteTotals => {
  if (!votingResults || votingResults.length === 0 || !votingResults[0]) {
    return { percents: [], counts: [], total: 0 };
  }
  const results = votingResults[0].slice(0, variantCount);
  const total = results.reduce((sum, v) => sum + v, 0n);
  const percents = results.map((v) =>
    total > 0n ? Number((v * 10000n) / total) / 100 : 0,
  );
  const counts = results.map((v) => Number(v));
  return { percents, counts, total: Number(total) };
};

// "FRA" packed as ASCII bigint: 0x46 0x52 0x41 = 4_608_577. Matches how the
// Rarime SDK encodes ProposalCriteria.citizenshipWhitelist entries
// (see Step11.tsx: BigInt('0x' + Buffer.from(issuingCountry).toString('hex'))).
export const FRA_BIGINT = BigInt('0x465241');

/**
 * A proposal is French-compatible if its citizenshipWhitelist either is empty
 * (open to all countries) or explicitly contains FRA.
 */
export const isFrenchCompatible = (p: ProposalInfo): boolean => {
  const whitelist = p.criteria?.citizenshipWhitelist;
  if (!whitelist || whitelist.length === 0) return true;
  return whitelist.some((c: bigint) => c === FRA_BIGINT);
};
