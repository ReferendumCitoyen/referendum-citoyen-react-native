/**
 * Explain a `RegisteredWithOtherPk` verification failure in one log line.
 *
 * Why this exists
 * ---------------
 * "Cette carte d'identité est déjà enregistrée sur Mainnet avec une autre clé
 * privée" is the least actionable message in the app. It is true, it is
 * permanent (French documents carry no DG15, so `Registration2.revoke()` is
 * blocked — see utils/identity.ts), and it tells neither the user nor us the
 * one thing that decides what to do next:
 *
 *   Does this phone still hold the key the document is actually bonded to?
 *
 *   - YES → the right key is present but the wrong one was active. Recoverable
 *     without the user finding a backup, and it means we have a sync bug worth
 *     chasing (see the legacy-slot sync note in utils/identity.ts).
 *   - NO  → the key is genuinely gone. Only a prior export can bring it back,
 *     and if there isn't one the document can never vote again.
 *
 * Those two cases look identical on screen today, so every report costs a
 * round-trip of questions to the tester.
 *
 * Privacy
 * -------
 * Deliberately emits counts, document-type labels and a boolean — never a key.
 * That is not only a data-minimisation choice: utils/logger.ts redacts bare
 * 64-hex strings to `<hex64>`, so a raw profile key would not survive into the
 * report anyway. Comparing on-device and reporting the *answer* is the only
 * shape of this diagnostic that actually reaches us.
 */

import type { DocType, PassportKeyEntry } from '@/utils/passport-key-db';

/** Where a matching key was found. `legacy` is the single-key SecureStore slot
 * that predates the per-document DB — still populated, and still the only copy
 * of the key for anyone who registered before the DB landed and hasn't
 * rescanned that document since. */
export type KeySource = DocType | 'unknown' | 'legacy';

export interface KeyDiagnosis {
  /** How many documents this phone holds a key for. */
  storedKeyCount: number;
  /** Document type of each stored key, in DB order. `unknown` for rows written
   * before docType was recorded (they backfill on the next scan of that
   * document — see getOrCreateKeyForPassport). */
  storedDocTypes: (DocType | 'unknown')[];
  /** Whether any key we hold derives the profile key the chain is bonded to. */
  matchesStoredKey: boolean;
  /** Where the matching key was found, when one was. Null otherwise. */
  matchingDocType: KeySource | null;
  /** Candidates (rows or the legacy slot) whose profile key could not be
   * derived. When no match was found and this is above zero, the diagnosis is
   * "unknown", never NOT RECOVERABLE: the key we could not check may be the
   * right one (dossier 2.0.2, item 14 c). */
  underivableKeyCount?: number;
}

/** Contract and SDK disagree on `0x`: `StateKeeper.getPassportInfo` returns a
 * prefixed, mixed-case hash while `RarimeUtils.getProfileKey` returns bare
 * lowercase hex (hence the `'0x' + profileKeyHex` at Step11's call site).
 * Comparing them raw silently reports "no match" for a key that matches. */
function normalizeKey(hex: string): string {
  return hex.trim().toLowerCase().replace(/^0x/, '');
}

/**
 * Do these two identity values refer to the same key? Exported so the Settings
 * screen can check a pasted replacement against the recorded on-chain identity
 * using the SAME normalisation as the diagnosis — the 0x/case mismatch between
 * the contract's return and `getProfileKey`'s output is exactly the trap this
 * function exists to stop each call site from re-implementing.
 */
export function identityMatches(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

/** What a candidate key turned out to be, relative to what the chain says. */
export type KeyVerdict = 'match' | 'mismatch' | 'unknown';

/**
 * Is this candidate key the one the document is actually bonded to on chain?
 *
 * Both routes into `replaceKeyForPassport` — pasting a key and accepting a
 * file-import conflict — destroy the current key irreversibly, and on a French
 * document there is no `revoke()` to undo that with (no DG15). So the check has
 * to happen BEFORE the write, and it has to be the same check on both routes:
 * the paste path had it and the import path did not, which made restoring from
 * the wrong backup a silent way to lose a working key.
 *
 * `unknown` is deliberately distinct from `mismatch` and must NOT block:
 * `onChainIdentity` is only recorded once Step 7 has failed on that document,
 * so plenty of rows legitimately carry none, and a native `getProfileKey` that
 * won't load is a reason to fall back to the caller's own "this is permanent"
 * confirmation — not to refuse a recovery we simply couldn't verify.
 *
 * `profileKeyOf` is injected for the same reason `diagnoseKeyMismatch` injects
 * it: `RarimeUtils.getProfileKey` is native and can't run under Jest.
 */
export function verifyKeyAgainstChain(
  candidatePrivateKey: string,
  onChainIdentity: string | undefined | null,
  profileKeyOf: (privateKeyHex: string) => string,
): KeyVerdict {
  if (!onChainIdentity) return 'unknown';
  try {
    return identityMatches(profileKeyOf(candidatePrivateKey), onChainIdentity)
      ? 'match'
      : 'mismatch';
  } catch {
    return 'unknown';
  }
}

/**
 * `profileKeyOf` is injected rather than imported so this stays a pure
 * function: `RarimeUtils.getProfileKey` is backed by a native module and can't
 * run under Jest.
 */
export function diagnoseKeyMismatch(
  activeIdentity: string,
  entries: readonly PassportKeyEntry[],
  profileKeyOf: (privateKeyHex: string) => string,
  legacyPrivateKey?: string | null,
): KeyDiagnosis {
  const target = normalizeKey(activeIdentity);
  const storedDocTypes = entries.map((e) => e.docType ?? ('unknown' as const));

  // The legacy slot is checked LAST and only if no DB row matched, so a
  // document that owns its key is always reported as itself. It is checked at
  // all because getOrCreateKeyForPassport only adopts the legacy key for the
  // FIRST document scanned after the DB landed — a second document registered
  // under that same single key before the split has its key in the slot and
  // nowhere else, and reporting NOT RECOVERABLE there would send someone
  // hunting for a backup they don't need.
  const candidates: { key: string; source: KeySource }[] = [
    ...entries.map((e, i) => ({ key: e.privateKey, source: storedDocTypes[i] as KeySource })),
    ...(legacyPrivateKey ? [{ key: legacyPrivateKey, source: 'legacy' as const }] : []),
  ];

  let matchingDocType: KeySource | null = null;
  let underivableKeyCount = 0;
  for (const candidate of candidates) {
    let derived: string;
    try {
      derived = normalizeKey(profileKeyOf(candidate.key));
    } catch {
      // A single unusable row must not sink the whole diagnosis — the other
      // rows are still worth checking, and "we couldn't derive one of them" is
      // less useful than "one of the others matched". But it is counted: with
      // no match elsewhere, it turns the verdict into "unknown".
      underivableKeyCount++;
      continue;
    }
    if (derived === target) {
      matchingDocType = candidate.source;
      break;
    }
  }

  return {
    storedKeyCount: entries.length,
    storedDocTypes,
    matchesStoredKey: matchingDocType !== null,
    matchingDocType,
    underivableKeyCount,
  };
}

/** One line, safe to log in release. Shape is meant to be read at a glance in
 * a mailed report, not parsed. */
export function formatKeyDiagnosis(d: KeyDiagnosis): string {
  const held = d.storedKeyCount === 0 ? 'none' : d.storedDocTypes.join(', ');
  if (d.matchingDocType === 'legacy') {
    return (
      `keys held: ${d.storedKeyCount} (${held}) — RECOVERABLE: no document row matches, but the ` +
      'LEGACY single-key slot does (pre-DB registration that was never adopted for this document)'
    );
  }
  if (!d.matchesStoredKey && (d.underivableKeyCount ?? 0) > 0) {
    return (
      `keys held: ${d.storedKeyCount} (${held}) — UNKNOWN: ${d.underivableKeyCount} key(s) could not be ` +
      'checked, so whether the bonded key is on this device is not established'
    );
  }
  return d.matchesStoredKey
    ? `keys held: ${d.storedKeyCount} (${held}) — RECOVERABLE: the "${d.matchingDocType}" key on this device matches the on-chain identity, but was not the active one`
    : `keys held: ${d.storedKeyCount} (${held}) — NOT RECOVERABLE on this device: no stored key matches the on-chain identity, a prior export is required`;
}
