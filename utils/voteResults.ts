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
 * Pack a 3-letter ICAO country code (e.g. "FRA", "DEU") into the same
 * ASCII-big-endian bigint format the Rarime SDK uses for
 * `ProposalCriteria.citizenshipWhitelist` entries. Useful when comparing
 * an MRZ-derived nationality against an on-chain whitelist.
 */
export const citizenshipToBigInt = (country: string): bigint => {
  if (!country) return 0n;
  const hex = country
    .split('')
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return BigInt('0x' + hex);
};

/**
 * The inverse: unpack an ASCII-big-endian bigint back to its country code.
 *
 * Why this is here and not copied a fourth time
 * --------------------------------------------
 * Three byte-identical local copies of this exist — `app/french-id-test.tsx`,
 * `app/passport-test.tsx`, and inline in `app/(tabs)/index.tsx` — all written
 * as `code.toString(16)` sliced two characters at a time. That is fine for
 * "FRA" and wrong in general, which is the worst combination: it works on every
 * value anyone has tested and breaks silently on one nobody has.
 *
 * The bug is the missing pad. `toString(16)` emits no leading zero, so any
 * value whose FIRST byte is below 0x10 produces an odd-length string, every
 * subsequent pair straddles two bytes, and the decode returns plausible-looking
 * garbage rather than throwing. `0x0A4652` — a legitimate 3-byte value — decodes
 * to two characters instead of three. Padding to an even length first is the
 * whole fix, and it is why this belongs in one place next to its inverse rather
 * than being copied again into a request builder.
 *
 * Returns '' for 0n, matching `citizenshipToBigInt('')` in the other direction.
 */
export const decodeCitizenship = (code: bigint): string => {
  if (code <= 0n) return '';
  const hex = code.toString(16).padStart(Math.ceil(code.toString(16).length / 2) * 2, '0');
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
};

/**
 * Returns true if the given 3-letter country code is allowed by the
 * proposal's citizenship whitelist. Empty/missing whitelist → open to
 * any country (returns true). Pass the MRZ's `nationality` (e.g. "FRA")
 * directly.
 */
export const isCitizenshipAllowed = (
  country: string,
  whitelist: readonly bigint[] | undefined,
): boolean => {
  if (!whitelist || whitelist.length === 0) return true;
  const packed = citizenshipToBigInt(country);
  return whitelist.some((c) => c === packed);
};

/**
 * A proposal is French-compatible if its citizenshipWhitelist either is empty
 * (open to all countries) or explicitly contains FRA.
 */
export const isFrenchCompatible = (p: ProposalInfo): boolean => {
  const whitelist = p.criteria?.citizenshipWhitelist;
  if (!whitelist || whitelist.length === 0) return true;
  return whitelist.some((c: bigint) => c === FRA_BIGINT);
};

/** BioPassportVoting deployed on Rarimo Mainnet — TD3 passport flow.
 * Proposals whose `sendVoteContractAddress` is something else (typically
 * IDCardVoting at 0x7d73513d64… for TD1 national-ID cards) cannot be voted
 * on with a passport: the on-chain verifier rejects the wrong proof shape
 * and our calldata builder is hardcoded for BioPassportVoting's signature. */
export const BIO_PASSPORT_VOTING_ADDRESS =
  '0x8Dea8065888A14F66ba9Fb944353d898663863cf'.toLowerCase();

/** Whether the proposal can be voted on with a TD3 passport — i.e. its
 * voting contract is BioPassportVoting. */
export const isPassportVotingTarget = (p: Pick<ProposalInfo, 'sendVoteContractAddress'>): boolean => {
  const target = p.sendVoteContractAddress?.toLowerCase();
  return target === BIO_PASSPORT_VOTING_ADDRESS;
};

/** IDCardVoting on Rarimo Mainnet — the TD1 ID-card flow. */
export const ID_CARD_VOTING_ADDRESS = '0x7d73513d64ee4427cf60711b9c4d76284d4f9e2f'; // nosec: public contract address

/** Whether one proposal lists BOTH contracts in its voting whitelist, so a
 * passport and an ID card vote the same id.
 * Takes the full whitelist — the SDK's ProposalInfo only exposes entry [0]. */
export const acceptsBothDocuments = (votingWhitelist: readonly string[] | undefined): boolean => {
  if (!votingWhitelist) return false;
  const set = new Set(votingWhitelist.map((a) => a.toLowerCase()));
  return set.has(BIO_PASSPORT_VOTING_ADDRESS) && set.has(ID_CARD_VOTING_ADDRESS);
};
