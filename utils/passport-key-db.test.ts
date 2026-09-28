import {
  computePassportHash,
  docFormatFromDg1,
  docTypeFromDg1,
  exportToJson,
  exportEntryToJson,
  importFromJson,
  lookupKeyForPassport,
  lookupKeysByPersonKey,
  normalizePastedKey,
  addPassportKey,
  getAllEntries,
  setDocTypeIfMissing,
  setPersonKeyIfMissing,
  replaceKeyForPassport,
  setOnChainIdentity,
  wipeDb,
} from './passport-key-db';

// In-memory mock of expo-secure-store so tests run under jest-expo without
// a native module bridge. Each test wipes the store via wipeDb() in
// beforeEach so the in-memory state stays predictable.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});

beforeEach(async () => {
  await wipeDb();
});

describe('computePassportHash', () => {
  it('is deterministic for identical inputs', () => {
    const dg1 = new Uint8Array([1, 2, 3, 4, 5]);
    const sod = new Uint8Array([9, 8, 7, 6]);
    expect(computePassportHash({ dg1, sod })).toBe(computePassportHash({ dg1, sod }));
  });

  it('changes when DG1 changes', () => {
    const sod = new Uint8Array([0x00]);
    const a = computePassportHash({ dg1: new Uint8Array([1]), sod });
    const b = computePassportHash({ dg1: new Uint8Array([2]), sod });
    expect(a).not.toBe(b);
  });

  it('changes when SOD changes', () => {
    const dg1 = new Uint8Array([1, 2, 3]);
    const a = computePassportHash({ dg1, sod: new Uint8Array([0xaa]) });
    const b = computePassportHash({ dg1, sod: new Uint8Array([0xab]) });
    expect(a).not.toBe(b);
  });

  it('emits 64 hex chars (SHA-256)', () => {
    const h = computePassportHash({ dg1: new Uint8Array(1), sod: new Uint8Array(1) });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('lookup + add', () => {
  it('returns null when passport not present', async () => {
    expect(await lookupKeyForPassport('a'.repeat(64))).toBeNull();
  });

  it('round-trips entries through SecureStore', async () => {
    await addPassportKey({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      addedAt: 100,
    });
    const out = await lookupKeyForPassport('a'.repeat(64));
    expect(out).toEqual({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      addedAt: 100,
    });
  });

  // Migration safety: existing installs that already persisted a `label`
  // field (the MRZ document number) get the PII scrubbed on next read.
  it('scrubs legacy `label` field from previously-stored entries', async () => {
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    await SecureStore.setItemAsync(
      'passport_key_db_v1',
      JSON.stringify({
        version: 1,
        entries: [
          { passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64), label: 'P<FRA12345', addedAt: 1 },
        ],
      }),
    );
    const out = await lookupKeyForPassport('a'.repeat(64));
    expect(out).toEqual({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64), addedAt: 1 });
    expect(out).not.toHaveProperty('label');
  });

  it('rejects duplicates', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    await expect(
      addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'c'.repeat(64) }),
    ).rejects.toThrow(/already in DB/);
  });
});

// Recovery path for a document whose on-chain identity was registered with a
// key this install never had (e.g. registered from the standalone Scan ID app,
// or before a reinstall). A failed Step 7 has already written a fresh WRONG key
// under this passportHash, and `importFromJson('merge')` deliberately skips
// conflicting hashes — so overwriting in place is the only way to repair the
// row without wiping every other document's key.
describe('replaceKeyForPassport', () => {
  it('overwrites the key while preserving addedAt and docType', async () => {
    await addPassportKey({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      addedAt: 100,
      docType: 'idCard',
    });
    await replaceKeyForPassport('a'.repeat(64), 'c'.repeat(64));
    expect(await lookupKeyForPassport('a'.repeat(64))).toEqual({
      passportHash: 'a'.repeat(64),
      privateKey: 'c'.repeat(64),
      addedAt: 100,
      docType: 'idCard',
    });
  });

  it('leaves other documents untouched', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64), addedAt: 1 });
    await addPassportKey({ passportHash: 'd'.repeat(64), privateKey: 'e'.repeat(64), addedAt: 2 });
    await replaceKeyForPassport('a'.repeat(64), 'c'.repeat(64));
    expect(await lookupKeyForPassport('d'.repeat(64))).toEqual({
      passportHash: 'd'.repeat(64),
      privateKey: 'e'.repeat(64),
      addedAt: 2,
    });
  });

  // Failing closed matters: silently creating the row would bind the pasted
  // key to a document the user never scanned on this device.
  it('throws when the document is not in the DB', async () => {
    await expect(replaceKeyForPassport('a'.repeat(64), 'c'.repeat(64))).rejects.toThrow(
      /not in DB/,
    );
  });

  it('rejects a malformed private key', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    await expect(replaceKeyForPassport('a'.repeat(64), 'nope')).rejects.toThrow(
      /64 hex/,
    );
    // The original key must survive a rejected replace.
    expect((await lookupKeyForPassport('a'.repeat(64)))?.privateKey).toBe('b'.repeat(64));
  });

  it('normalises 0x-prefixed uppercase input', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    await replaceKeyForPassport('a'.repeat(64), '0x' + 'C'.repeat(64));
    expect((await lookupKeyForPassport('a'.repeat(64)))?.privateKey).toBe('c'.repeat(64));
  });
});

describe('export / import', () => {
  it('export of empty DB yields version-1 envelope', async () => {
    const json = await exportToJson();
    expect(JSON.parse(json)).toEqual({ version: 1, entries: [] });
  });

  it('export → import (replace) is identity', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: '2'.repeat(64), addedAt: 10 });
    const dump = await exportToJson();
    await wipeDb();
    const r = await importFromJson(dump, 'replace');
    // `replace` overwrites wholesale, so nothing can conflict by definition.
    expect(r).toEqual({ added: 1, skipped: 0, conflicts: [] });
    expect(await getAllEntries()).toHaveLength(1);
  });

  it('merge skips conflicts instead of overwriting', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: '2'.repeat(64), addedAt: 10 });
    const incoming = {
      version: 1,
      entries: [
        // Same hash, different key — must be SKIPPED, never overwrite.
        { passportHash: '1'.repeat(64), privateKey: 'f'.repeat(64), addedAt: 99 },
        // Different hash — added.
        { passportHash: '3'.repeat(64), privateKey: '4'.repeat(64), addedAt: 99 },
      ],
    };
    const r = await importFromJson(JSON.stringify(incoming), 'merge');
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    // The colliding entry is returned, not just counted — the caller needs it
    // to offer an explicit overwrite (see promptOverwriteConflicts).
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].passportHash).toBe('1'.repeat(64));
    expect(r.conflicts[0].privateKey).toBe('f'.repeat(64));
    const entries = await getAllEntries();
    // Existing entry untouched
    expect(entries.find((e) => e.passportHash === '1'.repeat(64))?.privateKey).toBe('2'.repeat(64));
    // New entry added
    expect(entries.find((e) => e.passportHash === '3'.repeat(64))?.privateKey).toBe('4'.repeat(64));
  });

  it('rejects malformed JSON / wrong version', async () => {
    await expect(importFromJson('not json')).rejects.toThrow(/Invalid JSON/);
    await expect(importFromJson('{"version":2,"entries":[]}')).rejects.toThrow(/Unrecognized backup format/);
  });

  it('rejects entries with invalid hash/key shape', async () => {
    const bad = JSON.stringify({
      version: 1,
      entries: [{ passportHash: 'short', privateKey: 'short', addedAt: 1 }],
    });
    await expect(importFromJson(bad)).rejects.toThrow(/invalid passportHash\/privateKey/);
  });
});

describe('wipeDb', () => {
  it('removes all entries', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    expect(await getAllEntries()).toHaveLength(1);
    await wipeDb();
    expect(await getAllEntries()).toHaveLength(0);
  });
});

describe('document type', () => {
  it('reads the type off DG1 rather than trusting the caller', () => {
    // TD3 passport = 93 bytes, TD1 ID card = 95 — the same gate Step 6 uses.
    expect(docTypeFromDg1(new Uint8Array(93))).toBe('passport');
    expect(docTypeFromDg1(new Uint8Array(95))).toBe('idCard');
  });

  it('returns undefined for any other length instead of guessing', () => {
    for (const len of [0, 1, 92, 94, 96, 200]) {
      expect(docTypeFromDg1(new Uint8Array(len))).toBeUndefined();
    }
  });

  it('stores the type when known', async () => {
    await addPassportKey({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      addedAt: 100,
      docType: 'passport',
    });
    expect((await lookupKeyForPassport('a'.repeat(64)))?.docType).toBe('passport');
  });

  it('omits the key entirely when the type is unknown', async () => {
    await addPassportKey({ passportHash: 'c'.repeat(64), privateKey: 'd'.repeat(64) });
    const out = await lookupKeyForPassport('c'.repeat(64));
    expect(out).not.toHaveProperty('docType');
  });

  it('backfills a row that predates the field', async () => {
    await addPassportKey({ passportHash: 'e'.repeat(64), privateKey: 'f'.repeat(64) });
    await setDocTypeIfMissing('e'.repeat(64), 'idCard');
    expect((await lookupKeyForPassport('e'.repeat(64)))?.docType).toBe('idCard');
  });

  it('never overwrites a type that is already recorded', async () => {
    // A rescan must not be able to relabel an existing key.
    await addPassportKey({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      docType: 'passport',
    });
    await setDocTypeIfMissing('a'.repeat(64), 'idCard');
    expect((await lookupKeyForPassport('a'.repeat(64)))?.docType).toBe('passport');
  });

  it('is a no-op for a hash that is not in the DB', async () => {
    await expect(setDocTypeIfMissing('9'.repeat(64), 'idCard')).resolves.toBeUndefined();
  });

  it('drops an unrecognised type on import rather than failing the restore', async () => {
    const res = await importFromJson(
      JSON.stringify({
        version: 1,
        entries: [
          { passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64), addedAt: 1, docType: 'drivingLicence' },
        ],
      }),
      'replace',
    );
    expect(res.added).toBe(1);
    expect(await lookupKeyForPassport('a'.repeat(64))).not.toHaveProperty('docType');
  });

  it('preserves a valid type through export and import', async () => {
    await addPassportKey({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      docType: 'idCard',
    });
    const backup = await exportToJson();
    await wipeDb();
    await importFromJson(backup, 'replace');
    expect((await lookupKeyForPassport('a'.repeat(64)))?.docType).toBe('idCard');
  });
});


// Moving ONE key between two installs — the app that registered a document
// and the one that needs it — used to require handing over the whole DB,
// every other key with it.
describe('exportEntryToJson', () => {
  it('emits a single entry in the same shape a full backup uses', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64), docType: 'idCard' });
    await addPassportKey({ passportHash: 'c'.repeat(64), privateKey: 'd'.repeat(64), docType: 'passport' });

    const json = await exportEntryToJson('a'.repeat(64));
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].passportHash).toBe('a'.repeat(64));
    // The other document's key must not travel with it.
    expect(json).not.toContain('d'.repeat(64));
  });

  it('round-trips through the ordinary importer', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64), docType: 'idCard' });
    const json = await exportEntryToJson('a'.repeat(64));
    await wipeDb();

    const r = await importFromJson(json, 'merge');
    expect(r.added).toBe(1);
    expect((await lookupKeyForPassport('a'.repeat(64)))?.privateKey).toBe('b'.repeat(64));
  });

  it('throws for a document that is not in the DB', async () => {
    await expect(exportEntryToJson('9'.repeat(64))).rejects.toThrow(/not in DB/);
  });
});

// Settings verifies a pasted replacement against this, offline. Without it the
// user pastes, rescans, sees the same error, and has destroyed the old key for
// nothing — the DB stores only SHA-256(DG1‖SOD), which cannot reproduce the
// on-chain passport key, so there is no other way to check.
describe('setOnChainIdentity', () => {
  it('records what the chain says against the document', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    await setOnChainIdentity('a'.repeat(64), '0xdeadbeef');
    expect((await lookupKeyForPassport('a'.repeat(64)))?.onChainIdentity).toBe('0xdeadbeef');
  });

  it('is a no-op for a document that is not in the DB', async () => {
    await expect(setOnChainIdentity('9'.repeat(64), '0xdeadbeef')).resolves.toBeUndefined();
    expect(await getAllEntries()).toHaveLength(0);
  });

  it('survives an export/import round trip', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    await setOnChainIdentity('a'.repeat(64), '0xdeadbeef');
    const dump = await exportToJson();
    await wipeDb();
    await importFromJson(dump, 'replace');
    expect((await lookupKeyForPassport('a'.repeat(64)))?.onChainIdentity).toBe('0xdeadbeef');
  });
});

// Everything here is a real shape a pasted key arrives in. `.trim()` alone
// rejected most of them with a length error that explained nothing.
describe('normalizePastedKey', () => {
  const KEY = 'a'.repeat(64);

  it('accepts a clean key', () => {
    expect(normalizePastedKey(KEY)).toBe(KEY);
  });

  it('strips surrounding whitespace and a 0x prefix, and lowercases', () => {
    expect(normalizePastedKey(`  0x${KEY.toUpperCase()}\n`)).toBe(KEY);
  });

  // The field is multiline; a key copied from an email arrives wrapped.
  it('strips newlines and spaces from the MIDDLE, which trim cannot', () => {
    expect(normalizePastedKey(`${'a'.repeat(32)}\n  ${'a'.repeat(32)}`)).toBe(KEY);
  });

  // Invisible, survives trim, and produces "expected 64, got 65".
  it('strips zero-width characters', () => {
    expect(normalizePastedKey(`​${KEY}﻿`)).toBe(KEY);
  });

  it('strips quotes from a copied JSON string value', () => {
    expect(normalizePastedKey(`"${KEY}"`)).toBe(KEY);
  });

  // "Partager cette clé" emits a .json file, so pasting its contents is the
  // obvious move.
  it('pulls the key out of a single-entry export envelope', () => {
    const json = JSON.stringify({ version: 1, entries: [{ passportHash: 'b'.repeat(64), privateKey: KEY }] });
    expect(normalizePastedKey(json)).toBe(KEY);
  });

  // Guessing which key was meant would be worse than refusing.
  it('refuses a multi-entry backup rather than guessing', () => {
    const json = JSON.stringify({
      version: 1,
      entries: [
        { passportHash: 'b'.repeat(64), privateKey: KEY },
        { passportHash: 'c'.repeat(64), privateKey: 'd'.repeat(64) },
      ],
    });
    expect(normalizePastedKey(json)).toBeNull();
  });

  it('returns null for values that are not keys', () => {
    expect(normalizePastedKey('')).toBeNull();
    expect(normalizePastedKey('hello world')).toBeNull();
    expect(normalizePastedKey('a'.repeat(63))).toBeNull();
    expect(normalizePastedKey('z'.repeat(64))).toBeNull();
    expect(normalizePastedKey('{not json')).toBeNull();
  });
});

/**
 * What these protect: `docFormat` is a required field of the verifier API and
 * the service uses it to decide how many public signals a query proof must
 * have (24 for TD1, 23 for TD3). Swapping the two does not produce a type
 * error or a crash — it produces a rejected vote whose error message blames
 * the proof. The two spellings of this one fact must never disagree.
 */
describe('docFormatFromDg1', () => {
  it('agrees with docTypeFromDg1 on every input, including the invalid ones', () => {
    const cases: Array<[number, 'TD1' | 'TD3' | undefined, 'idCard' | 'passport' | undefined]> = [
      [95, 'TD1', 'idCard'],
      [93, 'TD3', 'passport'],
      [0, undefined, undefined],
      [94, undefined, undefined],
      [88, undefined, undefined], // the raw TD3 MRZ length — not a DG1 length
      [90, undefined, undefined], // the raw TD1 MRZ length — not a DG1 length
    ];
    for (const [len, format, type] of cases) {
      const dg1 = new Uint8Array(len);
      expect(docFormatFromDg1(dg1)).toBe(format);
      expect(docTypeFromDg1(dg1)).toBe(type);
    }
  });

  it('does not map the ID card to the passport format', () => {
    // Guards the transposition specifically: TD1 is the 95-byte ID card and
    // TD3 is the 93-byte passport, which reads backwards at a glance.
    expect(docFormatFromDg1(new Uint8Array(95))).toBe('TD1');
    expect(docFormatFromDg1(new Uint8Array(95))).not.toBe('TD3');
  });
});

/**
 * What these protect: the person key is the index that lets a second document
 * find the first one's key. It must be stored, findable, backfillable, and —
 * because name + DOB + birthplace is public, low-entropy data — it must NOT
 * leave the device in a backup, where a plain hash of it lets anyone holding
 * the file confirm a guess about whose it is.
 */
describe('personKey', () => {
  const PK = 'a'.repeat(64);
  const sk = (n: number) => n.toString(16).padStart(64, '0');

  it('is stored when given and absent when not', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: sk(1), docType: 'passport', personKey: PK });
    await addPassportKey({ passportHash: '2'.repeat(64), privateKey: sk(2), docType: 'idCard' });
    const [a, b] = await getAllEntries();
    expect(a.personKey).toBe(PK);
    expect('personKey' in b).toBe(false);
  });

  it('finds every row for one person and nothing else', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: sk(1), docType: 'passport', personKey: PK });
    await addPassportKey({ passportHash: '2'.repeat(64), privateKey: sk(1), docType: 'idCard', personKey: PK });
    await addPassportKey({ passportHash: '3'.repeat(64), privateKey: sk(3), docType: 'idCard', personKey: 'b'.repeat(64) });
    const rows = await lookupKeysByPersonKey(PK);
    expect(rows.map((r) => r.passportHash).sort()).toEqual(['1'.repeat(64), '2'.repeat(64)]);
    expect(await lookupKeysByPersonKey('c'.repeat(64))).toEqual([]);
  });

  it('backfills a row that has none, and never overwrites one that has', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: sk(1), docType: 'passport' });
    await setPersonKeyIfMissing('1'.repeat(64), PK);
    expect((await lookupKeyForPassport('1'.repeat(64)))?.personKey).toBe(PK);
    await setPersonKeyIfMissing('1'.repeat(64), 'b'.repeat(64));
    expect((await lookupKeyForPassport('1'.repeat(64)))?.personKey).toBe(PK);
    // absent row: no-op, no throw
    await expect(setPersonKeyIfMissing('9'.repeat(64), PK)).resolves.toBeUndefined();
  });

  it('is stripped from both export shapes', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: sk(1), docType: 'passport', personKey: PK });
    const whole = JSON.parse(await exportToJson());
    const one = JSON.parse(await exportEntryToJson('1'.repeat(64)));
    for (const e of [...whole.entries, ...one.entries]) {
      expect('personKey' in e).toBe(false);
      // and everything else survived
      expect(e.privateKey).toBe(sk(1));
      expect(e.docType).toBe('passport');
    }
    expect(JSON.stringify(whole)).not.toContain(PK);
  });

  it('round-trips through export → import without the person key, keeping the key itself', async () => {
    await addPassportKey({ passportHash: '1'.repeat(64), privateKey: sk(1), docType: 'passport', personKey: PK });
    const json = await exportToJson();
    await wipeDb();
    await importFromJson(json, 'replace');
    const row = await lookupKeyForPassport('1'.repeat(64));
    expect(row?.privateKey).toBe(sk(1));
    expect(row?.personKey).toBeUndefined();
    // and it can be backfilled again on the next scan
    await setPersonKeyIfMissing('1'.repeat(64), PK);
    expect((await lookupKeyForPassport('1'.repeat(64)))?.personKey).toBe(PK);
  });
});
