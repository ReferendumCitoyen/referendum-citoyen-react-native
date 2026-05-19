import {
  computePassportHash,
  exportToJson,
  importFromJson,
  lookupKeyForPassport,
  addPassportKey,
  getAllEntries,
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
      label: 'P<FRA12345',
      addedAt: 100,
    });
    const out = await lookupKeyForPassport('a'.repeat(64));
    expect(out).toEqual({
      passportHash: 'a'.repeat(64),
      privateKey: 'b'.repeat(64),
      label: 'P<FRA12345',
      addedAt: 100,
    });
  });

  it('rejects duplicates', async () => {
    await addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'b'.repeat(64) });
    await expect(
      addPassportKey({ passportHash: 'a'.repeat(64), privateKey: 'c'.repeat(64) }),
    ).rejects.toThrow(/already in DB/);
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
    expect(r).toEqual({ added: 1, skipped: 0 });
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
    expect(r).toEqual({ added: 1, skipped: 1 });
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
