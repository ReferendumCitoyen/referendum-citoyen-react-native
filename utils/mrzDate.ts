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
 * Expand a 2-digit MRZ year into a 4-digit year for *birth dates*. Fixed
 * cutoff at 35 (instead of the OLD `>=50`):
 *   YY > 35 → 19YY   (covers 1936-1999, i.e. voters aged 27-90)
 *   YY ≤ 35 → 20YY   (covers 2000-2035, i.e. voters born this century)
 *
 * Why 35: pushes the next boundary issue out to ~2036 (when someone born
 * in 1936 would still be alive at 100; vanishingly rare voter pool).
 * The OLD `>=50` rule mapped YY=44 to 2044, so Step7's display read
 * "Né(e) le: 31/12/2044" for an 80yo voter — that's what we're fixing.
 *
 * For *expiry* dates use `expandMrzExpiryYear` (a different cutoff
 * because passports look forward, not backward).
 */
export const expandMrzBirthYear = (yy: number): number =>
  yy > 35 ? 1900 + yy : 2000 + yy;

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
): Date | null => {
  if (jjmmaa.length !== 6 || !/^\d{6}$/.test(jjmmaa)) return null;
  const jj = parseInt(jjmmaa.slice(0, 2), 10);
  const mm = parseInt(jjmmaa.slice(2, 4), 10);
  const aa = parseInt(jjmmaa.slice(4, 6), 10);
  if (mm < 1 || mm > 12) return null;
  if (jj < 1 || jj > 31) return null;
  const fullYear =
    mode === 'birth' ? expandMrzBirthYear(aa) : expandMrzExpiryYear(aa);
  const date = new Date(fullYear, mm - 1, jj);
  // Round-trip check: catches things like 31/02 → 03/03 because Date
  // silently overflows.
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
): Date | null => {
  if (yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return null;
  const aa = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const jj = parseInt(yymmdd.slice(4, 6), 10);
  if (mm < 1 || mm > 12) return null;
  if (jj < 1 || jj > 31) return null;
  const fullYear =
    mode === 'birth' ? expandMrzBirthYear(aa) : expandMrzExpiryYear(aa);
  const date = new Date(fullYear, mm - 1, jj);
  if (
    date.getFullYear() !== fullYear ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== jj
  ) {
    return null;
  }
  return date;
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
