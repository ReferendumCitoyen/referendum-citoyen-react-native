import * as SecureStore from 'expo-secure-store';
import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';
import { UNIVERSAL_PERSON_KEY } from '@/constants/universal-person-key';
import {
  addPassportKey,
  computePassportHash,
  docTypeFromDg1,
  getAllEntries,
  lookupKeyForPassport,
  lookupKeysByPersonKey,
  setDocTypeIfMissing,
  setPersonKeyIfMissing,
  type PassportKeyEntry,
} from '@/utils/passport-key-db';
import { computePersonKey } from '@/utils/universal-person-key';

// ---------------------------------------------------------------------------
// BJJ private-key validity
// ---------------------------------------------------------------------------
//
// The vote circuit's BabyPbk constrains the private key via circomlib's
// `Num2Bits(253)`, which only decomposes scalars in [0, 2^253). The SDK's
// `RarimeUtils.generateBJJPrivateKey()` samples uniformly from the BabyJub
// base field [0, p) where p ≈ 2^254 — so ~34 % of fresh keys land in the
// dead zone [2^253, p) and trip an assert ~280 ms into witnesscalc. The
// failing constraint surfaces with the misleading name "timestampUpperbound"
// (the alphabetically-last loaded signal — same wording as the unrelated
// registered-after-proposal-start timing bug), so this is invisible in
// release reports without explicit detection.
//
// Mitigation: rejection-sample at GENERATION time so every freshly-minted
// key is in range. WARN at load time so we can detect any already-persisted
// bad key — but DON'T silently regenerate stored keys, because that would
// orphan the on-chain identity bound to them, and French passports lack
// DG15/AA which means `Registration2.revoke()` is blocked: the affected
// user is unrecoverable on that document and can only vote with a different
// document going forward.

const SK_MAX_EXCLUSIVE = 1n << 253n;

function isUsableSk(hex: string): boolean {
  try {
    return BigInt('0x' + hex.replace(/^0x/, '')) < SK_MAX_EXCLUSIVE;
  } catch {
    return false;
  }
}

async function generateValidBJJPrivateKey(): Promise<string> {
  const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
  // Expected attempts ≈ 1.5 (success rate ≈ 66 % per draw). The 100-cap is
  // purely defensive — the chance of needing more than 100 is ~10⁻⁵².
  for (let attempt = 0; attempt < 100; attempt++) {
    const hex = RarimeUtils.generateBJJPrivateKey();
    if (isUsableSk(hex)) return hex;
  }
  throw new Error(
    '[identity] babyJub.F.random kept returning values >= 2^253 after 100 attempts — RNG is broken',
  );
}

function warnIfBadSk(hex: string, context: string): void {
  if (!isUsableSk(hex)) {
    console.warn(
      `[identity] stored BJJ sk (${context}) is >= 2^253 — vote circuit will assert. ` +
        `This document's on-chain identity is unrecoverable (French passports lack AA → revoke() blocked); ` +
        `the user can only vote with a different document.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Serialisation (dossier 2.0.2, item 14 h)
// ---------------------------------------------------------------------------
//
// Key resolution is a read-then-write over two stores (the passport-key DB and
// the legacy single-key slot). Two of them interleaving (a document scanned
// while the previous one's resolution is still awaiting SecureStore, which is
// exactly what closing the vote during init and rescanning produces) could
// each read "no row yet" and mint two keys for one document, or leave the
// legacy slot pointing at the document that finished FIRST rather than the one
// scanned last. Every function below that reads or writes the key stores runs
// through this one queue, in call order. Nothing about what is written, or in
// which format, changes.

let keyStoreTail: Promise<unknown> = Promise.resolve();

/** Run `fn` after every key-store operation queued before it. A failure is
 * returned to its own caller and does not block the queue. Not reentrant:
 * never call a serialised function from inside `fn`. */
export function withKeyStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = keyStoreTail.then(fn, fn);
  keyStoreTail = run.catch(() => undefined);
  return run;
}

// Returns the user's BJJ private key from SecureStore, generating + persisting
// a new one on first run. Uses a dynamic import so callers don't pay the
// rarime-rn-sdk load cost just to read an existing key.
export function getOrCreatePrivateKey(): Promise<string> {
  return withKeyStoreLock(async () => {
    const existing = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
    if (existing) {
      warnIfBadSk(existing, 'legacy single-key slot');
      return existing;
    }

    const generated = await generateValidBJJPrivateKey();
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, generated);
    return generated;
  });
}

// Read the current BJJ private key from SecureStore without generating one
// if absent. Returns null on a fresh install. Used by the dev-only backup UI.
export function readPrivateKey(): Promise<string | null> {
  return withKeyStoreLock(() => SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY));
}

/**
 * Overwrite the BJJ private key in SecureStore. Used by the dev-only restore
 * UI to switch to a different on-chain identity (e.g., to test voting with a
 * key already registered on Mainnet against a passport that physically can't
 * be revoked — no DG15 / Active Authentication).
 *
 * The caller must surface the implications to the user (loses access to the
 * previously-stored key, etc.) — this function does no confirmation.
 *
 * Format: 64 lowercase hex chars, no `0x` prefix — matches the format that
 * `RarimeUtils.generateBJJPrivateKey()` returns and that the SDK expects via
 * `RarimeConfiguration.userConfiguration.userPrivateKey`.
 *
 * Throws if the input is not a valid hex string of the expected length.
 * Logs a warning (but does NOT reject) if the key is in the witnesscalc
 * dead zone (>= 2^253). Restoring a known-bad key is sometimes the only
 * way for an affected user to move their on-chain identity to a new
 * device — blocking it would break that recovery path. The downstream
 * vote attempt will surface the issue clearly.
 */
export async function setPrivateKey(hex: string): Promise<void> {
  const stripped = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(stripped)) {
    throw new Error(
      `Invalid private key — expected 64 hex characters, got ${stripped.length}`,
    );
  }
  warnIfBadSk(stripped, 'restored backup');
  await withKeyStoreLock(() => SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, stripped));
}

/**
 * Wipe the BJJ private key from SecureStore. Next call to
 * `getOrCreatePrivateKey()` will generate a fresh one. Used by the dev-only
 * "reset identity" path for testing first-run flows.
 */
export async function deletePrivateKey(): Promise<void> {
  await withKeyStoreLock(() => SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY));
}

// ---------------------------------------------------------------------------
// Per-passport key resolution
// ---------------------------------------------------------------------------

export interface ResolvedPassportKey {
  /** SHA-256(DG1 ‖ SOD) hex — the lookup key into the passport-key DB. */
  passportHash: string;
  /** 64-hex BJJ private key bound to this passport. */
  privateKey: string;
  /** Whether the DB entry was created in this call (true) or already
   * existed (false). The UI may want to surface a one-time toast when a
   * new identity is generated. */
  isNew: boolean;
  /** Whether `isNew=true` adopted the pre-existing legacy single-key
   * stored at `PRIVATE_KEY_STORAGE_KEY` (migration path) rather than
   * generating a brand-new key. False for non-migration cases. */
  migratedFromLegacy: boolean;
  /** Whether this document shares its key with a document of the OTHER type
   * on this device (a passport and its owner's ID card), so that both produce
   * one nullifier. True on the scan that inherits the key and on every rescan
   * of either document afterwards — Step 7 needs it whenever a registration
   * is refused, and a refused registration is retried by rescanning. False
   * when the key was generated fresh or adopted from the legacy slot. */
  linkedToExisting: boolean;
}

/**
 * Whether `row` holds the same key as a document of the other type on this
 * device. Rows without a docType cannot take part: any row with a person key
 * was written after docType existed, so the two are present together or not
 * at all.
 */
async function sharesKeyWithOtherDocType(
  row: PassportKeyEntry,
  docType: PassportKeyEntry['docType'],
): Promise<boolean> {
  if (!docType) return false;
  return (await getAllEntries()).some(
    (e) =>
      e.passportHash !== row.passportHash &&
      e.privateKey === row.privateKey &&
      e.docType !== undefined &&
      e.docType !== docType,
  );
}

/**
 * Look up the BJJ private key bound to this passport. Generates and
 * persists a new one on first scan.
 *
 * Migration: if the DB is empty AND a legacy single-key exists in
 * SecureStore (from before this multi-passport DB existed), we ADOPT the
 * legacy key for the first scanned passport. That preserves the user's
 * existing on-chain registration without forcing them to re-register. After
 * adoption the legacy key is left in place — `getOrCreatePrivateKey()` will
 * keep returning it for non-passport-specific call sites. Subsequent
 * passports get fresh keys.
 *
 * Pure-by-side-effect — the caller passes raw chip bytes, we hash and
 * look up. No NFC, no network. Serialised with every other key-store
 * operation (withKeyStoreLock).
 */
export function getOrCreateKeyForPassport(args: {
  dg1: Uint8Array;
  sod: Uint8Array;
  dg11?: Uint8Array;
}): Promise<ResolvedPassportKey> {
  return withKeyStoreLock(() => resolveKeyForPassport(args));
}

async function resolveKeyForPassport(args: {
  dg1: Uint8Array;
  sod: Uint8Array;
  /**
   * Raw DG11, when the scan produced one. Optional because ~0.6% of documents
   * carry none, and because callers that predate the person key still work
   * unchanged — they just never link. See utils/universal-person-key.ts.
   */
  dg11?: Uint8Array;
}): Promise<ResolvedPassportKey> {
  const passportHash = computePassportHash({ dg1: args.dg1, sod: args.sod });
  // Read off the chip rather than threaded down from the UI: DG1's length is
  // the document's own answer, and this function already has the bytes.
  const docType = docTypeFromDg1(args.dg1);
  // Null when there is no DG11, or when it would not decode cleanly — in
  // which case the document simply keeps a key of its own, as before.
  // Follows the flag that governs it (audit item C3). The person key is a
  // hash of low-entropy public data — name, date of birth, place of birth —
  // and utils/universal-person-key.ts says so itself: whoever guesses who
  // holds this phone confirms it offline with a single hash. It exists for
  // exactly one purpose, finding the sibling document of the same person,
  // and that lookup is already behind UNIVERSAL_PERSON_KEY. Writing it while
  // the flag is false stored a dictionary-attackable oracle for a feature
  // that is switched off. Flipping the flag back on does not need rows
  // pre-indexed: setPersonKeyIfMissing below backfills a row the next time
  // its chip is read, which is what voting with it does anyway.
  const personKey = UNIVERSAL_PERSON_KEY ? computePersonKey(args.dg11) : null;

  const existing = await lookupKeyForPassport(passportHash);
  if (existing) {
    // The context names the store, never the document: this line reaches the
    // system log in release and the emailed report, and a passportHash prefix
    // is the on-chain lookup key (wave 4b, M1bis).
    warnIfBadSk(existing.privateKey, 'stored entry');
    // CRITICAL: sync the legacy single-key slot to this passport's key,
    // even on a cache hit. Downstream call sites (Rarime SDK init in
    // voting-flow.tsx, mainnet-vote-flow.ts, register-via-noir.ts) all
    // read `getOrCreatePrivateKey()` which returns the legacy slot. If we
    // skip this sync when re-scanning a known passport, the SDK ends up
    // using whichever key the *previously* scanned passport wrote — and
    // `getDocumentStatus` then reports REGISTERED_WITH_OTHER_PK because
    // the chain's activeIdentity is checked against the wrong profileKey.
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, existing.privateKey);
    // Backfill rows written before docType existed. Seeing the document again
    // is the only way to learn its type, so this is the one chance to record
    // it; already-typed rows are left alone.
    if (docType) await setDocTypeIfMissing(passportHash, docType);
    // Same backfill for the person key. This is the step that lets a document
    // registered BEFORE the person key existed be found by its sibling later:
    // voting with it rescans it, and the rescan records the key.
    if (personKey) await setPersonKeyIfMissing(passportHash, personKey);
    return {
      passportHash,
      privateKey: existing.privateKey,
      isNew: false,
      migratedFromLegacy: false,
      linkedToExisting: await sharesKeyWithOtherDocType(existing, docType),
    };
  }

  // First scan of this passport. Decide whether to adopt the legacy key
  // (migration path) or generate a fresh one. We adopt only when the DB is
  // currently empty — adopting later would silently re-use the legacy key
  // for a second passport and break the "one key per passport" invariant.
  const legacy = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
  const dbEntries = await getAllEntries();
  const dbIsEmpty = dbEntries.length === 0;

  let privateKey: string;
  let migratedFromLegacy = false;
  let linkedToExisting = false;
  if (legacy && dbIsEmpty) {
    // Migration path: a pre-existing legacy key is adopted for the first
    // scanned passport. If the legacy key is in the dead zone, the adoption
    // can't avoid that — silently regenerating would orphan whatever
    // on-chain registration the user already made with this legacy key.
    // Warn so the bad key shows up in release reports as a clean signal.
    warnIfBadSk(legacy, 'legacy single-key slot adopted on first passport');
    privateKey = legacy;
    migratedFromLegacy = true;
  } else {
    // The person-key link. If this device already holds the OTHER kind of
    // document for the same person, this one inherits its key, so the two
    // produce one nullifier and the chain refuses the second vote.
    //
    // "Other kind" is load-bearing. A person has one passport and one ID
    // card, so a second row of the SAME type under one person key is either a
    // renewed document (whose predecessor is expired and cannot vote anyway)
    // or a homonym — two different people. Neither should inherit. Linking
    // only across types makes a homonym collision require the coincidence of
    // opposite document types on top of matching name, DOB and birthplace,
    // and keeps a renewal on today's one-key-per-chip behaviour.
    //
    // Rows without a docType cannot be matched: any row that has a person key
    // was written or backfilled after docType existed, so both are present or
    // neither is, and a row with neither is invisible here by construction.
    const sibling =
      UNIVERSAL_PERSON_KEY && personKey && docType
        ? (await lookupKeysByPersonKey(personKey)).find(
            (e) => e.docType !== undefined && e.docType !== docType,
          )
        : undefined;

    if (sibling) {
      warnIfBadSk(sibling.privateKey, `inherited from the ${sibling.docType} entry`);
      privateKey = sibling.privateKey;
      linkedToExisting = true;
      console.log(
        `[identity] ${docType} linked to existing ${sibling.docType} for the same person — one key, one nullifier`,
      );
    } else {
      privateKey = await generateValidBJJPrivateKey();
    }
  }

  await addPassportKey({ passportHash, privateKey, docType, personKey });

  // Also write into the legacy slot so non-passport-specific call sites
  // (e.g., diagnostic screens, register-via-noir without a passport
  // context) keep working with the SAME key the voting flow just bound.
  // For the migration case this is a no-op; for fresh keys it swaps the
  // legacy slot to point at the most recently scanned passport's key.
  await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, privateKey);

  return { passportHash, privateKey, isNew: true, migratedFromLegacy, linkedToExisting };
}

// Re-export so call sites don't need to import from two files.
export {
  exportToJson,
  exportEntryToJson,
  normalizePastedKey,
  importFromJson,
  wipeDb,
  getAllEntries,
  replaceKeyForPassport,
} from '@/utils/passport-key-db';
export type { PassportKeyEntry };
