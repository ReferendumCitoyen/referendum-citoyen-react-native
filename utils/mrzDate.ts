// Pure helpers for MRZ date handling — used by both the manual entry sheet
// (`ManualMRZInput.tsx`) and the camera scan path (`Step5.tsx`):
// auto-formatting JJ/MM/AA as the user types, parsing French (JJMMAA) and
// MRZ (YYMMDD) date formats, computing age, checking expiry, and the
// shared eligibility policy (≥18 years old, card not expired).

/** Minimum voting age applied client-side to fail fast before NFC. */
export const MIN_VOTING_AGE = 18;

/**
 * Reasons a date check can fail. Returned by `checkBirthDate` / `checkExpiryDate`
 * as enum tokens (not localised strings) so consumers can map them to their
 * own UX-context-specific copy.
 */
export type DateError = 'invalid' | 'underage' | 'expired' | null;

/**
 * Formats up to 6 raw digits as `JJ`, `JJ/MM`, or `JJ/MM/AA` for display in
 * the TextInput as the user types. Stripping non-digits keeps the round-trip
 * stable when iOS/Android suggest keyboard insertions or paste includes
 * separators.
 */
export const formatDateDisplay = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

/** Strips slashes / spaces and clamps to 6 digits — what we store in state. */
export const sanitizeDateInput = (raw: string): string =>
  raw.replace(/\D/g, '').slice(0, 6);

/**
 * Expand a 2-digit MRZ year into a 4-digit year for *birth dates* using a
 * TRUE sliding window: a birth year can never be in the future, so
 *   2000+YY ≤ current year → 20YY   (people aged 0..current-YY)
 *   2000+YY > current year → 19YY   (everyone else, up to age ~100)
 *
 * History: this used to be a FIXED cutoff (`>=50`, then `>35`). A fixed
 * cutoff always strands some real cohort — the `>35` rule mapped a 1935
 * birth (YY=35) to 2035, so a 91-year-old voter was blocked as "underage"
 * at Step 5 (user report, 2026-06-12); before that, `>=50` blocked everyone
 * born 1936-1949. The sliding window self-adjusts every year and only
 * breaks at the irreducible 2-digit ambiguity: a 100-year-old collides
 * with a newborn carrying the same YY.
 *
 * `parseFrenchDate` / `parseMRZDate` additionally refine at DATE level:
 * when 20YY equals the current year but the month/day is still ahead, the
 * date flips to 19YY (a December-born centenarian-to-be, not a baby born
 * "next December").
 *
 * For *expiry* dates use `expandMrzExpiryYear` (a different rule because
 * passports look forward, not backward).
 */
export const expandMrzBirthYear = (yy: number, now: Date = new Date()): number => {
  const candidate = 2000 + yy;
  return candidate > now.getFullYear() ? candidate - 100 : candidate;
};

/**
 * Expand a 2-digit MRZ year for *expiry dates* using the fixed `>=50` cutoff.
 * Modern passports were only issued post-2000 with ≤10yr validity, so every
 * realistic expiry is 2000-2049. The rule starts breaking ~2049 (an expiry
 * of "55" would mean 2055, but the rule would say 1955) — future-us problem.
 */
export const expandMrzExpiryYear = (yy: number): number =>
  yy >= 50 ? 1900 + yy : 2000 + yy;

/**
 * Parses 6 digits in JJMMAA into a real Date. Returns null if the digits
 * don't make a valid calendar date (e.g. 31/02/95).
 *
 * The `mode` parameter selects the century-expansion rule:
 *   - `'birth'` (default): ICAO sliding-window, dates always resolve to ≤ today
 *   - `'expiry'`: fixed `>=50` → 19YY cutoff (good through ~2049)
 *
 * Pre-existing callers that omit `mode` get the birth rule because that's
 * the most-likely-to-bite default; expiry callers must opt in explicitly.
 */
export const parseFrenchDate = (
  jjmmaa: string,
  mode: 'birth' | 'expiry' = 'birth',
  now: Date = new Date(),
): Date | null => {
  if (jjmmaa.length !== 6 || !/^\d{6}$/.test(jjmmaa)) return null;
  const jj = parseInt(jjmmaa.slice(0, 2), 10);
  const mm = parseInt(jjmmaa.slice(2, 4), 10);
  const aa = parseInt(jjmmaa.slice(4, 6), 10);
  return buildCenturyAdjustedDate(jj, mm, aa, mode, now);
};

/**
 * Shared by parseFrenchDate / parseMRZDate: expand the 2-digit year, build
 * the Date, and (birth mode only) flip to the previous century when the
 * result would land in the future — birth dates can't be ahead of today.
 */
const buildCenturyAdjustedDate = (
  jj: number,
  mm: number,
  aa: number,
  mode: 'birth' | 'expiry',
  now: Date,
): Date | null => {
  if (mm < 1 || mm > 12) return null;
  if (jj < 1 || jj > 31) return null;
  let fullYear =
    mode === 'birth' ? expandMrzBirthYear(aa, now) : expandMrzExpiryYear(aa);
  let date = new Date(fullYear, mm - 1, jj);
  // CIRCUIT PARITY: mirror Rarimo's EncodedDateIsLessNormalized
  // (passport-zk-circuits/circuits/dateUtilities/dateComparisonEncodedNormalized.circom),
  // which the on-chain query circuit uses for both birth-date bounds:
  //   date <  currentDate → current century
  //   date >= currentDate → previous century   (comparator is STRICT)
  // i.e. a YYMMDD equal to today is a 100th-birthday-today voter, not a
  // newborn. Compare at date granularity (midnight) so the verdict doesn't
  // depend on the scan's time of day. Keeping Step 5's pre-filter identical
  // to the circuit means it never blocks someone the proof would accept,
  // and never green-lights someone the proof would reject on this rule.
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (mode === 'birth' && date >= todayStart) {
    fullYear -= 100;
    date = new Date(fullYear, mm - 1, jj);
  }
  // Round-trip check: catches things like 31/02 → 03/03 because Date
  // silently overflows (and 29/02 on a non-leap year after a century flip).
  if (
    date.getFullYear() !== fullYear ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== jj
  ) {
    return null;
  }
  return date;
};

/** Whole years between birthDate and `now` (defaults to today). */
export const ageInYears = (birthDate: Date, now: Date = new Date()): number => {
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age--;
  return age;
};

/** A card is expired if its expiry date is strictly before today (date-only, no clock). */
export const isExpired = (expiryDate: Date, now: Date = new Date()): boolean => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const exp = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
  return exp < today;
};

/**
 * Parses 6 digits in YYMMDD (the order the `mrz` library exposes via
 * `result.fields.birthDate` / `expirationDate`). Mode selects the century
 * rule — see `parseFrenchDate` for the explanation.
 *
 * Default `'birth'`: sliding-window so 2-digit years never resolve to the
 * future. Pass `'expiry'` for date-of-expiry callers (fixed `>=50` cutoff).
 */
export const parseMRZDate = (
  yymmdd: string,
  mode: 'birth' | 'expiry' = 'birth',
  now: Date = new Date(),
): Date | null => {
  if (yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return null;
  const aa = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const jj = parseInt(yymmdd.slice(4, 6), 10);
  return buildCenturyAdjustedDate(jj, mm, aa, mode, now);
};

/**
 * Eligibility policy for a birth date.
 * Returns null if the date is acceptable for voting, otherwise an error token.
 */
export const checkBirthDate = (
  date: Date | null,
  now: Date = new Date(),
): DateError => {
  if (!date) return 'invalid';
  if (ageInYears(date, now) < MIN_VOTING_AGE) return 'underage';
  return null;
};

/**
 * Eligibility policy for an expiry date.
 * Returns null if the card is still valid today, otherwise an error token.
 */
export const checkExpiryDate = (
  date: Date | null,
  now: Date = new Date(),
): DateError => {
  if (!date) return 'invalid';
  if (isExpired(date, now)) return 'expired';
  return null;
};
