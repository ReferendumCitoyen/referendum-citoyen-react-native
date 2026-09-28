/**
 * One key per PERSON, not per chip.
 *
 * The problem this closes
 * -----------------------
 * The per-passport key DB is indexed on SHA-256(DG1 ‖ SOD). A person's passport
 * and ID card carry different SODs, so they land in different rows with
 * different BJJ keys, which means two on-chain identities, two nullifiers, and
 * two votes. That is the cross-document double vote this module addresses.
 *
 * The vote nullifier is `Poseidon3(sk, Poseidon1(sk), eventId)`. It depends on
 * the KEY and the ballot, never on the document. So if both documents resolve
 * to the same `sk`, they produce the same nullifier, and the existing vote
 * contract's ProposalSMT rejects the second vote on chain — no contract change,
 * no circuit change, nothing from Rarimo. That is what this module makes
 * possible: a stable, per-person identifier derived from the one data group
 * both documents agree on.
 *
 * Why DG11 and not the MRZ
 * ------------------------
 * The MRZ truncates. TD1's name field is 30 characters and TD3's is 39, and
 * French issuers abbreviate given names to initials when they do not fit —
 * `DOE<<JEAN<BAPTISTE<MARIE<L<P<R` on the card (30 characters exactly),
 * `…MARIE<LOUIS<PAUL<RE` on the passport. That example is invented. DG11 carries the full
 * name with accents and no truncation, so both documents agree after the
 * normalisation below.
 *
 * The rules, and why they are frozen
 * ----------------------------------
 * This is a line-for-line port of the reference implementation (spec v0.1,
 * 2026-08-11). Do not "improve" the normalisation: every key ever derived depends on
 * these exact rules, and changing them orphans every existing link. If the
 * rules must change, bump PERSON_KEY_VERSION so old and new keys coexist
 * instead of silently disagreeing.
 *
 *   name  (5F0E)  uppercase · '-' → ' ' · '<' → ' ' · fold accents · collapse spaces
 *   dob   (5F2B)  YYYYMMDD, verbatim — the chip carries the full date, unlike the MRZ
 *   place (5F11)  keep only text BEFORE the first '<' (drops the card's département
 *                 and the passport's country suffix) · uppercase · '-' → ' ' ·
 *                 fold accents · collapse spaces
 *
 * Canonical string: `NAME|YYYYMMDD|PLACE`. Address is excluded (people move —
 * 8 of 22 pairs differed). Document number and expiry are excluded (they are
 * per-document by nature).
 *
 * What this value is, and is not
 * -----------------------------
 * It is a LOCAL index into the key DB on this device. It is not sent anywhere,
 * not put on chain, and not exported in backups (see passport-key-db.ts).
 * Name + DOB + birthplace is low-entropy public data, so a bare hash of it is
 * dictionary-attackable — anyone with the value can confirm a guess about
 * whose it is. That is acceptable for a value that never leaves SecureStore
 * and unacceptable for one that does, which is why export strips it. The
 * on-chain version of this idea (the project's "Level 2") uses an HMAC with a server-held
 * secret for exactly that reason.
 *
 * Failure direction
 * -----------------
 * Two DIFFERENT people with the same name, birth date and birthplace get the
 * same key, and the second to vote is refused. A collision is disenfranchisement,
 * not fraud. It is rare — given names in 5F0E separate most twins — but at
 * 100k voters "rare" is not "never", and it needs a support path. Not a reason
 * to weaken the key: the alternative failure, two documents two votes, is the
 * one the referendum cannot survive.
 */

import { sha256 as ethersSha256 } from 'ethers';
import { Buffer } from 'buffer';

import { parseDg11, type Dg11Fields } from '@/utils/e-document/dg11';

/**
 * Domain separator for the hash. Bump this — never edit the rules above in
 * place — if the canonical form ever has to change.
 */
export const PERSON_KEY_VERSION = 'RC-PERSON-KEY-v1';

/**
 * Fold accents: NFKD splits 'É' into 'E' + combining acute; dropping the
 * combining range leaves 'E'. Hermes has supported String.prototype.normalize
 * since RN 0.70; a test asserts it on the platform this runs on.
 */
function foldAccents(s: string): string {
  // U+0300–U+036F is the Combining Diacritical Marks block. Written as escapes
  // on purpose: the literal characters are invisible and combine with the `[`
  // in most editors, which is how a regex like this gets silently corrupted.
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function collapseSpaces(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(' ');
}

/** validate_pairs.py::norm_name — upper, dash and filler to space, fold, collapse. */
export function normalisePersonName(raw: string): string {
  return collapseSpaces(foldAccents(raw.toUpperCase().replace(/-/g, ' ').replace(/</g, ' ')));
}

/** validate_pairs.py::norm_pob — truncate at the first '<', upper, dash to space, fold, collapse. */
export function normalisePlaceOfBirth(raw: string): string {
  return collapseSpaces(foldAccents(raw.split('<')[0].toUpperCase().replace(/-/g, ' ')));
}

/** The chip's DOB is used verbatim, but only if it is what the spec says it is. */
const DOB = /^\d{8}$/;

/**
 * The exact string validate_pairs.py hashes, or null when it cannot be built.
 *
 * Returns null — rather than a best-effort value — for anything that would make
 * the key wrong instead of merely absent: a missing field, a malformed date, or
 * a name that did not decode cleanly. `Buffer.toString('utf8')` substitutes
 * U+FFFD for invalid sequences rather than throwing; a key derived from a
 * mangled name would silently fail to match the person's other document, which
 * is the exact bug this exists to fix. Refusing to derive one falls back to the
 * per-document key, which is today's behaviour: worse than a link, far better
 * than a wrong link.
 */
export function canonicalPersonString(fields: Pick<Dg11Fields, 'nameOfHolderRaw' | 'dateOfBirthRaw' | 'placeOfBirthRaw'>): string | null {
  const { nameOfHolderRaw: name, dateOfBirthRaw: dob, placeOfBirthRaw: place } = fields;
  if (!name || !dob || !place) return null;
  if (!DOB.test(dob)) return null;
  if (name.includes('�') || place.includes('�')) return null;

  const n = normalisePersonName(name);
  const p = normalisePlaceOfBirth(place);
  if (!n || !p) return null;

  return `${n}|${dob}|${p}`;
}

/** SHA-256 over the versioned canonical string, 64 lowercase hex, no 0x. */
export function personKeyFromCanonical(canonical: string): string {
  const bytes = Buffer.from(`${PERSON_KEY_VERSION}|${canonical}`, 'utf8');
  return ethersSha256(bytes).slice(2);
}

/**
 * From the raw DG11 bytes to a person key, or null if one cannot be derived.
 *
 * Null is a normal outcome, not an error: some documents carry no DG11 at
 * all (it is optional in ICAO 9303), and
 * the caller falls back to the per-document key for those. Never throws.
 */
export function computePersonKey(dg11: Uint8Array | undefined | null): string | null {
  if (!dg11 || dg11.length === 0) return null;
  try {
    const canonical = canonicalPersonString(parseDg11(dg11));
    return canonical ? personKeyFromCanonical(canonical) : null;
  } catch {
    return null;
  }
}
