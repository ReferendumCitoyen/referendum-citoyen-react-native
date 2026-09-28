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

/** Which kind of document a row belongs to. */
export type DocType = 'idCard' | 'passport';

/**
 * TD3 passports carry a 93-byte DG1; TD1 ID cards carry 95. Step 6 already
 * fails the scan closed unless DG1 is exactly the length expected for the
 * chosen flow, so by the time a key is written the length and the user's
 * choice always agree — but the length is the chip's own answer, so prefer it.
 * Any other length returns undefined rather than guessing.
 */
export function docTypeFromDg1(dg1: Uint8Array): DocType | undefined {
  if (dg1.length === 93) return 'passport';
  if (dg1.length === 95) return 'idCard';
  return undefined;
}

/** ICAO 9303 machine-readable document format, spelled as the verifier API spells it. */
export type DocFormat = 'TD1' | 'TD3';

/**
 * The same discriminator as `docTypeFromDg1`, in the vocabulary the
 * referendum-verifier API uses (`docFormat: "TD1" | "TD3"`).
 *
 * Why a second function rather than a mapping at the call site
 * -----------------------------------------------------------
 * The `dg1.length === 93` test is already written out by hand in three places —
 * `Step11.tsx` (`isTd3Doc`), `Step7.tsx` (`isTd3`), and `docTypeFromDg1` above.
 * A fourth hand-written copy inside a request builder is exactly how the two
 * vocabularies drift apart. Both names for the same fact now come from one
 * line each, here.
 *
 * Do NOT substitute the user's document choice from the DocumentChoice gate
 * (`app/voting-flow.tsx`'s `chosenDocType`). That records which flow the user
 * picked, not what the chip turned out to be. The API field describes the chip,
 * and only the chip's own byte count knows that.
 */
export function docFormatFromDg1(dg1: Uint8Array): DocFormat | undefined {
  if (dg1.length === 93) return 'TD3';
  if (dg1.length === 95) return 'TD1';
  return undefined;
}

/** One row of the per-passport key DB. */
export interface PassportKeyEntry {
  /** SHA-256 of (DG1 ‖ SOD) as 64 lowercase hex chars. Deterministic per
   * passport chip — rescans of the same passport reproduce this exact value.
   * Used as the primary lookup key. */
  passportHash: string;
  /** The profile key this document is bonded to ON CHAIN, as last read from
   * StateKeeper (`Rarime.getPassportInfo`). Recorded opportunistically when
   * Step 7 detects a key mismatch, and used by the Settings screen to check a
   * pasted key WITHOUT the chip present: the DB stores only a SHA-256 of
   * (DG1 ‖ SOD), which cannot reproduce the on-chain passport key (Poseidon
   * over signedAttributes), so there is otherwise no way to verify a
   * replacement offline. Absent on rows written before this existed, and on
   * documents that have never failed verification — callers must treat it as
   * optional rather than assuming a missing value means "no match".
   *
   * Public data: anyone who can compute the document's passport key can read
   * the same value off chain. Safe to carry in a backup. */
  onChainIdentity?: string;
  /** 64-char lowercase hex BJJ private key (no 0x prefix). Same format as
   * `RarimeUtils.generateBJJPrivateKey()`. */
  privateKey: string;
  /** Unix seconds when the entry was first added. */
  addedAt: number;
  /**
   * Which document this key belongs to, so the key list can say which row is
   * which instead of showing two indistinguishable hashes.
   *
   * Optional: rows written before this existed have no type, and it cannot be
   * recovered from what they do store — passportHash is a SHA-256, which
   * destroys the 93/95 length that distinguishes the two. Those rows are
   * backfilled the next time the same document is scanned.
   *
   * Unlike the `label` below, this is not PII: it is a two-value enum the user
   * picked themselves on the document-choice screen, and it identifies nobody.
   */
  docType?: DocType;
  /**
   * Per-PERSON index — SHA-256 over the normalised DG11 name, full date of
   * birth and birthplace (utils/universal-person-key.ts). A passport and an ID
   * card belonging to the same person produce the same value, which is how the
   * second document scanned finds the first one's key and inherits it.
   *
   * Optional: absent on rows written before it existed and on the ~0.6% of
   * documents that carry no DG11. Backfilled the next time the document is
   * scanned, which voting with it does.
   *
   * NOT included in backups. Name + DOB + birthplace is low-entropy public
   * data, so a plain hash of it lets anyone holding the file confirm a guess
   * about whose it is. It costs nothing to leave out — it is recomputed from
   * the chip on the next scan — so `exportToJson` and `exportEntryToJson`
   * strip it, and a row that arrives through `importFromJson` has none until
   * that document is seen again.
   */
  personKey?: string;
  /**
   * Unix seconds when the chain was last seen to have this document bound to
   * the key in THIS row — i.e. when Step 7 read RegisteredWithThisPk for it.
   *
   * The one-document guard (utils/second-document-guard.ts) needs to know that
   * a person's other document is genuinely in use, including on a question that
   * document has not voted on and so has left no nullifier to find. This is
   * that signal, and it is deliberately NOT `onChainIdentity`: that field is
   * also written when the chain reports the document bound to a key this phone
   * does NOT hold, which is precisely when the document can never vote again.
   * Refusing someone's second document because their first one is unusable
   * would leave them with no way to vote at all.
   *
   * Absent on rows written before it existed and on documents never seen
   * registered; those fall back to the nullifier check. It travels in a backup,
   * which is right — restoring a key on another phone does not unregister the
   * document it is bound to.
   */
  registeredAt?: number;
  // Previously a `label` field (MRZ document number) was stored here as a
  // display aid in dev tools + JSON backups. Removed 2026-05-23 because
  // the document number is PII that didn't belong in on-device storage or
  // exported backups. The field is also scrubbed on read (see readDb) so
  // existing installs lose any persisted labels the next time the DB is
  // accessed.
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
      // Scrub legacy `label` field if any existing install still has it.
      // Strips the MRZ document number from previously-stored rows so the
      // PII removal applies retroactively. See PassportKeyEntry comment.
      let hadLabels = false;
      const entries: PassportKeyEntry[] = parsed.entries.map((e: any) => {
        if (e && typeof e === 'object' && 'label' in e) {
          hadLabels = true;
          const { label: _drop, ...rest } = e;
          void _drop;
          return rest as PassportKeyEntry;
        }
        return e as PassportKeyEntry;
      });
      const db: DbShape = { version: 1, entries };
      // Re-persist immediately so the scrub is durable (won't reappear on
      // the next launch). Fire-and-forget — the in-memory copy is already
      // clean, and a failed write just defers the cleanup to next time.
      if (hadLabels) {
        void writeDb(db);
      }
      return db;
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
  /** Optional override for the timestamp — defaults to `Date.now()`. Used
   * mostly by tests to assert on a known value. */
  addedAt?: number;
  docType?: DocType;
  personKey?: string | null;
}): Promise<PassportKeyEntry> {
  const db = await readDb();
  if (db.entries.some((e) => e.passportHash === args.passportHash)) {
    // No document identifier in the message: an Error's text reaches the
    // emailed report (utils/error-reporter.ts) and, in release, the system
    // log. Even 12 hex characters of passportHash are the StateKeeper lookup
    // key, so a report sent from a real address would tie that address to a
    // pseudonymous on-chain registration. The row count is what diagnoses it.
    throw new Error(`Document already in DB (entry count ${db.entries.length})`);
  }
  const entry: PassportKeyEntry = {
    passportHash: args.passportHash,
    privateKey: args.privateKey,
    addedAt: args.addedAt ?? Math.floor(Date.now() / 1000),
    // Spread rather than assign so an unknown type leaves the key absent
    // entirely, keeping stored rows and old backups byte-comparable.
    ...(args.docType ? { docType: args.docType } : {}),
    ...(args.personKey ? { personKey: args.personKey } : {}),
  };
  db.entries.push(entry);
  await writeDb(db);
  return entry;
}

/**
 * Fills in the document type of an existing row that has none. Used to
 * backfill rows written before the field existed: the type is not derivable
 * from what those rows store, so the only way to learn it is to see the
 * document again. No-op when the row is absent or already typed — rescanning
 * must never overwrite a type with a different one.
 */
export async function setDocTypeIfMissing(passportHash: string, docType: DocType): Promise<void> {
  const db = await readDb();
  const entry = db.entries.find((e) => e.passportHash === passportHash);
  if (!entry || entry.docType) return;
  entry.docType = docType;
  await writeDb(db);
}

/**
 * Fills in the person key of an existing row that has none. Same shape and
 * same reasoning as `setDocTypeIfMissing`: a row written before the field
 * existed cannot derive it from what it stores, and seeing the document again
 * is the only chance to record it. Never overwrites — a person key, once set,
 * is the identity of the row for linking purposes.
 */
export async function setPersonKeyIfMissing(passportHash: string, personKey: string): Promise<void> {
  const db = await readDb();
  const entry = db.entries.find((e) => e.passportHash === passportHash);
  if (!entry || entry.personKey) return;
  entry.personKey = personKey;
  await writeDb(db);
}

/**
 * Every row belonging to this person, i.e. every document this device has
 * seen whose DG11 normalised to the same key. Usually zero or one; two once
 * both documents have been scanned; more only for a homonym.
 */
export async function lookupKeysByPersonKey(personKey: string): Promise<PassportKeyEntry[]> {
  const db = await readDb();
  return db.entries.filter((e) => e.personKey === personKey);
}

/**
 * Overwrite the BJJ key bound to a document already in the DB.
 *
 * The recovery case: a document was registered on-chain with a key this
 * install has never held — registered from the standalone Scan ID app (a
 * separate package, so a separate SecureStore sandbox), or before an Android
 * reinstall wiped EncryptedSharedPreferences. `getOrCreateKeyForPassport`
 * mints and PERSISTS a fresh key before Step 7 ever asks the chain, so by the
 * time the user sees REGISTERED_WITH_OTHER_PK the DB already holds a wrong
 * key under the right passportHash. `importFromJson('merge')` deliberately
 * skips conflicting hashes, so it cannot repair that row — and 'replace' mode
 * would take every other document's key down with it.
 *
 * Throws if the document isn't already present: creating the row here would
 * bind a pasted key to a document that was never scanned on this device, and
 * the passportHash could not have been known without that scan.
 *
 * Accepts the same shapes as the generator emits — `0x` prefix and uppercase
 * are normalised, so a key pasted from anywhere lands in canonical form.
 */
/**
 * Record what the chain says this document is bonded to. No-op for a hash we
 * don't hold, and idempotent — writes only on an actual change, so the common
 * case costs one read and no write.
 */
export async function setOnChainIdentity(
  passportHash: string,
  onChainIdentity: string,
): Promise<void> {
  const db = await readDb();
  const entry = db.entries.find((e) => e.passportHash === passportHash);
  if (!entry || entry.onChainIdentity === onChainIdentity) return;
  entry.onChainIdentity = onChainIdentity;
  await writeDb(db);
}

/**
 * Note that the chain has this document bound to the key in its own row. Only
 * ever called after a RegisteredWithThisPk reading — see the `registeredAt`
 * field comment for why "bound to SOME key" would be the wrong thing to record.
 * No-op for a hash we don't hold, and written once.
 */
export async function markRegistered(
  passportHash: string,
  at: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const db = await readDb();
  const entry = db.entries.find((e) => e.passportHash === passportHash);
  if (!entry || entry.registeredAt) return;
  entry.registeredAt = at;
  await writeDb(db);
}

/**
 * Make a pasted value usable, or return null if it plainly isn't a key.
 *
 * `.trim()` alone is not enough for anything a human actually pastes. Real
 * failures this exists to absorb:
 *
 *  - INTERNAL newlines and spaces. The field is multiline and a key copied out
 *    of an email or any wrapped display carries line breaks in the MIDDLE;
 *    trim only touches the ends, so validation rejected a perfectly good key.
 *  - Zero-width characters (U+200B, U+FEFF). Messaging apps and web pages
 *    inject them invisibly, and they survive trim — the user sees 64 correct
 *    characters and is told there are 65.
 *  - Surrounding quotes, from copying a JSON string value.
 *  - The whole export envelope. "Partager cette clé" hands over a .json file,
 *    so opening it and copying the contents is the obvious move — and pasting
 *    that used to fail with a length error that explained nothing.
 *
 * A multi-entry backup deliberately returns null rather than guessing which
 * key was meant; that is what the import button is for.
 */
export function normalizePastedKey(raw: string): string | null {
  let value = raw.trim();

  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      const entries = parsed?.entries;
      if (!Array.isArray(entries) || entries.length !== 1) return null;
      value = String(entries[0]?.privateKey ?? '');
    } catch {
      return null;
    }
  }

  const cleaned = value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/["'`]/g, '')
    .replace(/\s/g, '')
    .replace(/^0x/i, '')
    .toLowerCase();

  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : null;
}

export async function replaceKeyForPassport(
  passportHash: string,
  privateKey: string,
): Promise<PassportKeyEntry> {
  const stripped = privateKey.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(stripped)) {
    throw new Error(
      `Invalid private key — expected 64 hex characters, got ${stripped.length}`,
    );
  }
  const db = await readDb();
  const entry = db.entries.find((e) => e.passportHash === passportHash);
  if (!entry) {
    // No document identifier in the message, see addEntry above.
    throw new Error(`Document not in DB (entry count ${db.entries.length})`);
  }
  entry.privateKey = stripped;
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
/**
 * A row as it leaves the device. The person key stays behind — see its field
 * comment — and everything else goes verbatim.
 */
function toExportedEntry(entry: PassportKeyEntry): Omit<PassportKeyEntry, 'personKey'> {
  const { personKey: _keep, ...rest } = entry;
  void _keep;
  return rest;
}

export async function exportToJson(): Promise<string> {
  const db = await readDb();
  return JSON.stringify({ version: db.version, entries: db.entries.map(toExportedEntry) }, null, 2);
}

/**
 * Export ONE document's key, in the same shape `exportToJson` produces so the
 * existing importer accepts it unchanged.
 *
 * Recovering a single document used to mean handing over the whole DB —
 * every other document's key with it — because a full backup was the only
 * transferable artifact. That is a poor trade when the goal is to move one key
 * between two installs (the app that registered a document and the one that
 * needs it), and it made the safe move the inconvenient one.
 */
export async function exportEntryToJson(passportHash: string): Promise<string> {
  const db = await readDb();
  const entry = db.entries.find((e) => e.passportHash === passportHash);
  if (!entry) {
    // No document identifier in the message, see addEntry above.
    throw new Error(`Document not in DB (entry count ${db.entries.length})`);
  }
  return JSON.stringify({ version: 1, entries: [toExportedEntry(entry)] }, null, 2);
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
): Promise<{ added: number; skipped: number; conflicts: PassportKeyEntry[] }> {
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
    // docType is cosmetic, so a bad value is dropped rather than thrown on —
    // restoring your keys must never fail over a label.
    if (e.docType !== undefined && e.docType !== 'idCard' && e.docType !== 'passport') {
      delete (e as { docType?: unknown }).docType;
    }
  }

  if (mode === 'replace') {
    await writeDb({ version: 1, entries: incoming });
    return { added: incoming.length, skipped: 0, conflicts: [] };
  }

  const db = await readDb();
  const existing = new Set(db.entries.map((e) => e.passportHash));
  let added = 0;
  // Conflicts are RETURNED, not just counted. Skipping a colliding hash is
  // still the right default — we never silently overwrite a key — but the
  // collision is precisely the case a recovery import hits: the document is
  // already in the DB, holding the wrong key, which is why the user is
  // importing at all. Reporting which entries collided lets the caller offer
  // an explicit overwrite instead of the import quietly doing nothing.
  const conflicts: PassportKeyEntry[] = [];
  for (const e of incoming) {
    if (existing.has(e.passportHash)) {
      conflicts.push(e);
      continue;
    }
    db.entries.push(e);
    existing.add(e.passportHash);
    added++;
  }
  await writeDb(db);
  return { added, skipped: conflicts.length, conflicts };
}

/** Wipe the entire DB. Cannot be undone without a prior `exportToJson()`. */
export async function wipeDb(): Promise<void> {
  await SecureStore.deleteItemAsync(DB_STORAGE_KEY);
}
