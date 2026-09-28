/**
 * Birth-date bounds as the query circuit applies them.
 *
 * A proposal's `birthDateLowerbound` / `birthDateUpperbound` are MRZ dates —
 * YYMMDD packed as ASCII into a bigint, "000000" meaning unused — and the
 * circuit (passport-zk-circuits, dateComparisonEncodedNormalized.circom)
 * reads the two-digit year with one rule: a date before today's YYMMDD is
 * 20xx, at or after it is 19xx. Both comparisons are strict:
 * lowerbound < birthDate < upperbound.
 *
 * The SDK's pre-check compared the packed bound against the decimal MRZ
 * number, which refused every voter as soon as a lower bound existed (#67,
 * "Birth date is lower than lowerbound") and never enforced the upper one.
 * A plain lexicographic compare would be no better: "85" > "08", so every
 * voter born before 2000 would fail an 18+ upper bound. The century rule is
 * the whole point, and the SDK patch (patches/@rarimo+rarime-rn-sdk) now
 * carries the same lines as `normalizeMrzDate` below.
 */

export const MRZ_DATE_UNUSED = '000000';

/** `0x303830363131n` → "080611". */
export function packedMrzDate(encoded: bigint): string {
  return Buffer.from(encoded.toString(16).padStart(12, '0'), 'hex').toString('ascii');
}

/**
 * Today as the proof input `current_date` is built: the UTC date, YYMMDD.
 *
 * UTC and never the phone's local date. The voting contracts turn
 * `current_date` into midnight UTC of that day and require it within 24 h of
 * the block time (PublicSignalsTD1Builder.validateDate), so a local date that
 * is behind UTC (the Antilles after 20:00, Polynesia after 14:00) made the vote
 * revert. The patched SDK builds `current_date` and its own age pre-check from
 * the same UTC day, and Step 11 reads this once per attempt and hands that one
 * value to the SDK, so the pre-check, the proof and the calldata agree.
 */
export function todayMrzUtc(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** Former name, kept for existing callers: the same UTC date. */
export const todayMrz = todayMrzUtc;

/** YYMMDD as a number, a century (1 000 000) higher when it reads as 20xx. */
export function normalizeMrzDate(yymmdd: string, current: string): number {
  const raw = Number(yymmdd);
  return raw + (raw < Number(current) ? 1_000_000 : 0);
}

export function isMrzDateLess(first: string, second: string, current: string): boolean {
  return normalizeMrzDate(first, current) < normalizeMrzDate(second, current);
}

export type BirthDateIssue = 'below-lowerbound' | 'above-upperbound';

/**
 * A bound the comparison can actually use, or null.
 *
 * `MRZ_DATE_UNUSED` covers the contract's own "no bound", the six ASCII zeros.
 * It does NOT cover a bound of 0n, which decodes to six NUL bytes, nor any
 * other value that is not six digits: those come from the SDK's all-zero stub,
 * returned whenever it could not decode the on-chain rules (REG-2).
 *
 * That difference had teeth. Comparing against six NUL bytes made
 * `normalizeMrzDate` produce NaN, every comparison came out false, and the
 * voter was told "Ce scrutin est réservé aux personnes majeures" because an
 * RPC call had failed. A bound that could not be read constrains nothing: the
 * on-chain verifier still holds the real one, and it is the authority.
 */
function usableBound(encoded: bigint): string | null {
  const decoded = packedMrzDate(encoded);
  if (decoded === MRZ_DATE_UNUSED) return null;
  return /^\d{6}$/.test(decoded) ? decoded : null;
}

export function birthDateBoundsIssue(args: {
  birthDate: string;
  lowerbound: bigint;
  upperbound: bigint;
  current?: string;
}): BirthDateIssue | null {
  const current = args.current ?? todayMrzUtc();
  const lower = usableBound(args.lowerbound);
  const upper = usableBound(args.upperbound);
  if (lower !== null && !isMrzDateLess(lower, args.birthDate, current)) {
    return 'below-lowerbound';
  }
  if (upper !== null && !isMrzDateLess(args.birthDate, upper, current)) {
    return 'above-upperbound';
  }
  return null;
}

/** What the voter reads. Step 11 strips the marker and shows the rest. */
export const BIRTH_DATE_MESSAGES: Record<BirthDateIssue, string> = {
  'above-upperbound':
    "[VOTE_INELIGIBLE] Ce scrutin est réservé aux personnes majeures : la date de " +
    "naissance de votre document ne remplit pas la condition d'âge (18 ans révolus).",
  'below-lowerbound':
    '[VOTE_INELIGIBLE] La date de naissance de votre document est en dehors de la ' +
    "limite d'âge de ce scrutin.",
};

export const CITIZENSHIP_MESSAGE =
  '[VOTE_INELIGIBLE] Ce scrutin est réservé aux citoyens français : la nationalité ' +
  "de votre document n'est pas acceptée.";

/** Throws the French `[VOTE_INELIGIBLE]` message when the document's birth
 * date falls outside the proposal's bounds; returns quietly otherwise. */
export function assertBirthDateEligible(
  birthDate: string,
  criteria: { birthDateLowerbound: bigint; birthDateUpperbound: bigint },
  /** The attempt's UTC date (todayMrzUtc), so this check reads the same day
   * as the proof. Defaults to today in UTC. */
  current?: string,
): void {
  const issue = birthDateBoundsIssue({
    birthDate,
    lowerbound: criteria.birthDateLowerbound,
    upperbound: criteria.birthDateUpperbound,
    current,
  });
  if (issue) throw new Error(BIRTH_DATE_MESSAGES[issue]);
}

/** The SDK's own pre-check wording, should it still be what reaches Step 11. */
export function frenchForSdkVerifyMessage(message: string): string | null {
  if (message.includes('Birth date is higher than upperbound')) return BIRTH_DATE_MESSAGES['above-upperbound'];
  if (message.includes('Birth date is lower than lowerbound')) return BIRTH_DATE_MESSAGES['below-lowerbound'];
  if (message.includes('Citizen is not in whitelist')) return CITIZENSHIP_MESSAGE;
  return null;
}
