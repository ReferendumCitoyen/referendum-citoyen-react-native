import * as SecureStore from 'expo-secure-store';
import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';
import {
  addPassportKey,
  computePassportHash,
  getAllEntries,
  lookupKeyForPassport,
  type PassportKeyEntry,
} from '@/utils/passport-key-db';

// Returns the user's BJJ private key from SecureStore, generating + persisting
// a new one on first run. Uses a dynamic import so callers don't pay the
// rarime-rn-sdk load cost just to read an existing key.
export async function getOrCreatePrivateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
  if (existing) return existing;

  const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
  const generated = RarimeUtils.generateBJJPrivateKey();
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
 * Does NOT validate the BJJ subgroup membership — the SDK's Rarime
 * constructor will throw later if the value is outside the field.
 */
export async function setPrivateKey(hex: string): Promise<void> {
  const stripped = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(stripped)) {
    throw new Error(
      `Invalid private key — expected 64 hex characters, got ${stripped.length}`,
    );
  }
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
  /** Optional human label stored alongside the new entry (e.g., MRZ
   * document number). Ignored when the entry already exists. */
  label?: string;
}): Promise<ResolvedPassportKey> {
  const passportHash = computePassportHash({ dg1: args.dg1, sod: args.sod });

  const existing = await lookupKeyForPassport(passportHash);
  if (existing) {
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
    privateKey = legacy;
    migratedFromLegacy = true;
  } else {
    const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
    privateKey = RarimeUtils.generateBJJPrivateKey();
  }

  await addPassportKey({ passportHash, privateKey, label: args.label });

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
