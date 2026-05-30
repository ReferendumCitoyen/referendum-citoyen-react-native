import * as SecureStore from 'expo-secure-store';
import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';
import {
  addPassportKey,
  computePassportHash,
  getAllEntries,
  lookupKeyForPassport,
  type PassportKeyEntry,
} from '@/utils/passport-key-db';

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

// Returns the user's BJJ private key from SecureStore, generating + persisting
// a new one on first run. Uses a dynamic import so callers don't pay the
// rarime-rn-sdk load cost just to read an existing key.
export async function getOrCreatePrivateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
  if (existing) {
    warnIfBadSk(existing, 'legacy single-key slot');
    return existing;
  }

  const generated = await generateValidBJJPrivateKey();
  await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, generated);
  return generated;
}

// Read the current BJJ private key from SecureStore without generating one
// if absent. Returns null on a fresh install. Used by the dev-only backup UI.
export async function readPrivateKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
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
  await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, stripped);
}

/**
 * Wipe the BJJ private key from SecureStore. Next call to
 * `getOrCreatePrivateKey()` will generate a fresh one. Used by the dev-only
 * "reset identity" path for testing first-run flows.
 */
export async function deletePrivateKey(): Promise<void> {
  await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
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
 * look up. No NFC, no network.
 */
export async function getOrCreateKeyForPassport(args: {
  dg1: Uint8Array;
  sod: Uint8Array;
}): Promise<ResolvedPassportKey> {
  const passportHash = computePassportHash({ dg1: args.dg1, sod: args.sod });

  const existing = await lookupKeyForPassport(passportHash);
  if (existing) {
    warnIfBadSk(existing.privateKey, `passport ${passportHash.slice(0, 8)}…`);
    // CRITICAL: sync the legacy single-key slot to this passport's key,
    // even on a cache hit. Downstream call sites (Rarime SDK init in
    // voting-flow.tsx, mainnet-vote-flow.ts, register-via-noir.ts) all
    // read `getOrCreatePrivateKey()` which returns the legacy slot. If we
    // skip this sync when re-scanning a known passport, the SDK ends up
    // using whichever key the *previously* scanned passport wrote — and
    // `getDocumentStatus` then reports REGISTERED_WITH_OTHER_PK because
    // the chain's activeIdentity is checked against the wrong profileKey.
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, existing.privateKey);
    return {
      passportHash,
      privateKey: existing.privateKey,
      isNew: false,
      migratedFromLegacy: false,
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
    privateKey = await generateValidBJJPrivateKey();
  }

  await addPassportKey({ passportHash, privateKey });

  // Also write into the legacy slot so non-passport-specific call sites
  // (e.g., diagnostic screens, register-via-noir without a passport
  // context) keep working with the SAME key the voting flow just bound.
  // For the migration case this is a no-op; for fresh keys it swaps the
  // legacy slot to point at the most recently scanned passport's key.
  await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, privateKey);

  return { passportHash, privateKey, isNew: true, migratedFromLegacy };
}

// Re-export so call sites don't need to import from two files.
export { exportToJson, importFromJson, wipeDb, getAllEntries } from '@/utils/passport-key-db';
export type { PassportKeyEntry };
