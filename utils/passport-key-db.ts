/**
 * Per-passport BJJ key database.
 *
 * Lets one phone hold many passports (and therefore many on-chain identities).
 * Each scanned passport gets a stable fingerprint — SHA-256 of (DG1 ‖ SOD) —
 * mapped to a BJJ private key. On rescan we recover the same key, so the user
 * can vote independently with each passport.
 *
 * Why not just reuse one BJJ key across all passports? The vote nullifier is
 * `Poseidon3(sk, Poseidon1(sk), eventId)` — independent of which passport
 * generated the proof. Two passports with the same key would only get ONE
 * vote per proposal. A per-passport key gives each passport its own
 * nullifier, so each can vote independently.
 *
 * Storage: expo-secure-store, which uses EncryptedSharedPreferences on
 * Android (per-app, wiped on uninstall) and the Keychain on iOS (note: iOS
 * Keychain entries CAN persist after uninstall — we expose `wipeDb()` and
 * encourage users to back up via `exportToJson()`).
 *
 * Backup format: the JSON shape `{ version: 1, entries: [...] }` is what
 * `exportToJson()` produces and what `importFromJson()` consumes. Keeping
 * `version` explicit means future shape changes can migrate cleanly.
 */

import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
// Use ethers' bundled sha256 instead of @noble/hashes directly: @noble/hashes
// 2.x dropped its legacy `./sha256` subpath, and the new `./sha2.js` form is
// ESM-only which breaks jest-expo's CommonJS runtime. ethers wraps the same
// noble implementation, exposes it as a callable, and is already a top-level
// dep — so we get one consistent surface across Node, RN, and Jest.
import { sha256 as ethersSha256 } from 'ethers';

/** SecureStore key holding the serialized DB. */
const DB_STORAGE_KEY = 'passport_key_db_v1';

/** One row of the per-passport key DB. */
export interface PassportKeyEntry {
  /** SHA-256 of (DG1 ‖ SOD) as 64 lowercase hex chars. Deterministic per
   * passport chip — rescans of the same passport reproduce this exact value.
   * Used as the primary lookup key. */
  passportHash: string;
  /** 64-char lowercase hex BJJ private key (no 0x prefix). Same format as
   * `RarimeUtils.generateBJJPrivateKey()`. */
  privateKey: string;
  /** Optional human label — e.g., MRZ document number — to help users
   * identify entries in a backup file. Not used for lookup. */
  label?: string;
  /** Unix seconds when the entry was first added. */
  addedAt: number;
}

interface DbShape {
  version: 1;
  entries: PassportKeyEntry[];
}

const EMPTY_DB: DbShape = { version: 1, entries: [] };

async function readDb(): Promise<DbShape> {
  const raw = await SecureStore.getItemAsync(DB_STORAGE_KEY);
  if (!raw) return { ...EMPTY_DB, entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
      return parsed as DbShape;
    }
  } catch {
    // Fall through to empty — better to lose a corrupt DB than crash the app.
  }
  return { ...EMPTY_DB, entries: [] };
}

async function writeDb(db: DbShape): Promise<void> {
  await SecureStore.setItemAsync(DB_STORAGE_KEY, JSON.stringify(db));
}

/**
 * Stable per-chip fingerprint. SHA-256 over the concatenation of DG1 and SOD
 * bytes. Both come from the NFC scan and are deterministic for a given
 * physical chip, so the digest is stable across rescans on the same phone or
 * a different phone.
 *
 * Why not the Rarime SDK's `passport.getPassportHash()`? That's a Poseidon
 * over the SOD signed-attributes hash, truncated to 252 bits — fine as an
 * on-chain identifier, but conflating it with our local key would make our
 * DB key collide with `passportInfoKey` (which we ALSO compute via that
 * function and pass to the SMT lookup). Keeping the DB key as a plain
 * SHA-256 avoids that overlap and stays cheap to compute (no Poseidon
 * dependency at scan time).
 */
export function computePassportHash(args: { dg1: Uint8Array; sod: Uint8Array }): string {
  const dg1 = args.dg1;
  const sod = args.sod;
  const concat = new Uint8Array(dg1.length + sod.length);
  concat.set(dg1, 0);
  concat.set(sod, dg1.length);
  // ethers.sha256 returns a `0x`-prefixed hex string; strip the prefix.
  return ethersSha256(concat).slice(2);
}

/** Returns the DB entry for `passportHash`, or null if absent. */
export async function lookupKeyForPassport(passportHash: string): Promise<PassportKeyEntry | null> {
  const db = await readDb();
  return db.entries.find((e) => e.passportHash === passportHash) ?? null;
}

/** Adds a new (passportHash, privateKey) row. Throws if `passportHash` is
 * already in the DB — callers should `lookupKeyForPassport` first. */
export async function addPassportKey(args: {
  passportHash: string;
  privateKey: string;
  label?: string;
  /** Optional override for the timestamp — defaults to `Date.now()`. Used
   * mostly by tests to assert on a known value. */
  addedAt?: number;
}): Promise<PassportKeyEntry> {
  const db = await readDb();
  if (db.entries.some((e) => e.passportHash === args.passportHash)) {
    throw new Error(`Passport ${args.passportHash.slice(0, 12)}… already in DB`);
  }
  const entry: PassportKeyEntry = {
    passportHash: args.passportHash,
    privateKey: args.privateKey,
    label: args.label,
    addedAt: args.addedAt ?? Math.floor(Date.now() / 1000),
  };
  db.entries.push(entry);
  await writeDb(db);
  return entry;
}

/** All entries in insertion order. Useful for backup UIs and dev tooling. */
export async function getAllEntries(): Promise<PassportKeyEntry[]> {
  const db = await readDb();
  return [...db.entries];
}

/** Serialize the entire DB to a pretty-printed JSON string. The caller is
 * expected to write this somewhere the user can recover it from
 * (`Share.share`, file system, paste-into-iCloud, etc.). */
export async function exportToJson(): Promise<string> {
  const db = await readDb();
  return JSON.stringify(db, null, 2);
}

/** Replace or merge into the current DB from a JSON string previously
 * produced by `exportToJson()`.
 *
 *  - `merge` (default): keep current entries; add any whose passportHash
 *    isn't already present. Conflicting hashes are SKIPPED — we never
 *    silently overwrite a key.
 *  - `replace`: wipe everything and load the incoming entries verbatim. */
export async function importFromJson(
  json: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<{ added: number; skipped: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e: any) {
    throw new Error('Invalid JSON: ' + (e?.message ?? e));
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as DbShape).version !== 1 ||
    !Array.isArray((parsed as DbShape).entries)
  ) {
    throw new Error('Unrecognized backup format — expected { version: 1, entries: [...] }');
  }
  const incoming = (parsed as DbShape).entries;
  // Light validation on each row so a malformed import can't poison the DB.
  for (const e of incoming) {
    if (
      typeof e?.passportHash !== 'string' ||
      typeof e?.privateKey !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(e.passportHash) ||
      !/^[0-9a-f]{64}$/i.test(e.privateKey)
    ) {
      throw new Error('Backup entry has invalid passportHash/privateKey shape');
    }
  }

  if (mode === 'replace') {
    await writeDb({ version: 1, entries: incoming });
    return { added: incoming.length, skipped: 0 };
  }

  const db = await readDb();
  const existing = new Set(db.entries.map((e) => e.passportHash));
  let added = 0;
  let skipped = 0;
  for (const e of incoming) {
    if (existing.has(e.passportHash)) {
      skipped++;
      continue;
    }
    db.entries.push(e);
    existing.add(e.passportHash);
    added++;
  }
  await writeDb(db);
  return { added, skipped };
}

/** Wipe the entire DB. Cannot be undone without a prior `exportToJson()`. */
export async function wipeDb(): Promise<void> {
  await SecureStore.deleteItemAsync(DB_STORAGE_KEY);
}
