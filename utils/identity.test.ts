/**
 * What these protect: the moment a second document decides which key to use.
 *
 * The whole anti-double-vote property of Level 1 lives in one branch of
 * getOrCreateKeyForPassport: an ID card scanned after its owner's passport must
 * inherit the passport's key, and everything that is NOT that case must keep
 * today's one-key-per-chip behaviour. Both directions are silent failures — a
 * missed link is two votes, a wrong link is someone refused at the ballot — so
 * every edge of that branch is pinned here.
 */

import * as SecureStore from 'expo-secure-store';

import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';
import { getAllEntries, lookupKeyForPassport, wipeDb } from '@/utils/passport-key-db';
import { getOrCreateKeyForPassport } from '@/utils/identity';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});

// Deterministic, distinct, and all far below 2^253 so warnIfBadSk stays quiet.
// `mock` prefix is required: jest hoists the factory above this declaration
// and only lets it close over variables named that way.
let mockMinted = 0;
jest.mock('@rarimo/rarime-rn-sdk', () => ({
  RarimeUtils: { generateBJJPrivateKey: () => (++mockMinted).toString(16).padStart(64, '0') },
}));

// The flag is read at call time; mock it so individual tests can flip it.
jest.mock('@/constants/universal-person-key', () => ({ UNIVERSAL_PERSON_KEY: true }));
const flag = jest.requireMock('@/constants/universal-person-key') as { UNIVERSAL_PERSON_KEY: boolean };

// --- chips ----------------------------------------------------------------

const utf8hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
const tlv = (tag: string, v: string) => tag + (utf8hex(v).length / 2).toString(16).padStart(2, '0') + utf8hex(v);
function dg11(name: string, dob: string, place: string): Uint8Array {
  const body = tlv('5f0e', name) + tlv('5f2b', dob) + tlv('5f11', place);
  return new Uint8Array(Buffer.from('6b' + (body.length / 2).toString(16).padStart(2, '0') + body, 'hex'));
}
/** A chip: DG1 sized for its document type, a unique SOD, and DG11. */
function chip(kind: 'passport' | 'idCard', sodSeed: number, dg11Bytes?: Uint8Array) {
  return {
    dg1: new Uint8Array(kind === 'passport' ? 93 : 95).fill(1),
    sod: new Uint8Array(64).fill(sodSeed),
    dg11: dg11Bytes,
  };
}

const ALICE_CARD = dg11('DUPONT<<ALICE<MARIE-LOUISE', '19800505', 'LYON<69');
const ALICE_PASS = dg11('DUPONT<<ALICE<MARIE LOUISE', '19800505', 'LYON<<FRANCE');
const BOB_CARD = dg11('DUPONT<<ALICE<MARIE-LOUISE', '19800505', 'PARIS<75'); // homonym, different birthplace

beforeEach(async () => {
  await wipeDb();
  await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
  flag.UNIVERSAL_PERSON_KEY = true;
});

describe('getOrCreateKeyForPassport — linking', () => {
  it('an ID card scanned after its owner passport inherits the passport key', async () => {
    const pass = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(card.privateKey).toBe(pass.privateKey);
    expect(card.isNew).toBe(true);
    expect(card.linkedToExisting).toBe(true);
    expect(pass.linkedToExisting).toBe(false);
    // two rows, one key
    const rows = await getAllEntries();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.privateKey)).size).toBe(1);
    expect(new Set(rows.map((r) => r.personKey)).size).toBe(1);
  });

  it('works in the other order too', async () => {
    const card = await getOrCreateKeyForPassport(chip('idCard', 1, ALICE_CARD));
    const pass = await getOrCreateKeyForPassport(chip('passport', 2, ALICE_PASS));
    expect(pass.privateKey).toBe(card.privateKey);
    expect(pass.linkedToExisting).toBe(true);
  });

  it('leaves the legacy slot pointing at the shared key', async () => {
    await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY)).toBe(card.privateKey);
  });
});

describe('getOrCreateKeyForPassport — when it must NOT link', () => {
  it('two documents of the SAME type never share, even for one person', async () => {
    // A renewed passport, or a homonym. Either way today's behaviour.
    const a = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    const b = await getOrCreateKeyForPassport(chip('passport', 2, ALICE_PASS));
    expect(b.privateKey).not.toBe(a.privateKey);
    expect(b.linkedToExisting).toBe(false);
  });

  it('a different person with the same name and DOB gets a different key', async () => {
    const alice = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    const bob = await getOrCreateKeyForPassport(chip('idCard', 2, BOB_CARD));
    expect(bob.privateKey).not.toBe(alice.privateKey);
    expect(bob.linkedToExisting).toBe(false);
  });

  it('a document with no DG11 keeps a key of its own', async () => {
    const pass = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, undefined));
    expect(card.privateKey).not.toBe(pass.privateKey);
    expect(card.linkedToExisting).toBe(false);
    expect((await lookupKeyForPassport(card.passportHash))?.personKey).toBeUndefined();
  });

  // C3: the write follows the flag. The person key is a hash of low-entropy
  // public data, so a stored one confirms a guessed identity offline; storing
  // it for a feature that is switched off is collection without a purpose.
  it('with the flag off, nothing links and no person key is stored', async () => {
    flag.UNIVERSAL_PERSON_KEY = false;
    const pass = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(card.privateKey).not.toBe(pass.privateKey);
    expect(card.linkedToExisting).toBe(false);
    const rows = await getAllEntries();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.personKey === undefined)).toBe(true);
    expect(rows.every((r) => !('personKey' in r))).toBe(true);
  });

  it('with the flag off, a rescan does not backfill a person key either', async () => {
    flag.UNIVERSAL_PERSON_KEY = false;
    const first = await getOrCreateKeyForPassport(chip('passport', 1, undefined));
    await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    expect((await lookupKeyForPassport(first.passportHash))?.personKey).toBeUndefined();
  });

  it('with the flag on, it is stored, and turning it on later backfills on the next read', async () => {
    flag.UNIVERSAL_PERSON_KEY = false;
    const pass = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    expect((await lookupKeyForPassport(pass.passportHash))?.personKey).toBeUndefined();
    // A later build with the flag on: reading the same chip indexes the row.
    flag.UNIVERSAL_PERSON_KEY = true;
    const again = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    expect(again.isNew).toBe(false);
    expect((await lookupKeyForPassport(again.passportHash))?.personKey).toBeDefined();
    // and the link then works as before
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(card.privateKey).toBe(pass.privateKey);
    expect(card.linkedToExisting).toBe(true);
  });

  it('the legacy-slot migration still wins on an empty DB', async () => {
    // A valid key (< 2^253), so warnIfBadSk stays quiet: the point here is
    // the migration precedence, not the dead-zone warning, and a warning that
    // reads "on-chain identity is unrecoverable" in CI output would send
    // someone chasing a problem that isn't there.
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, '1'.repeat(64));
    const first = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    expect(first.migratedFromLegacy).toBe(true);
    expect(first.linkedToExisting).toBe(false);
    // and the sibling then inherits the migrated key
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(card.privateKey).toBe(first.privateKey);
    expect(card.linkedToExisting).toBe(true);
  });
});

describe('getOrCreateKeyForPassport — rescans and backfill', () => {
  it('a rescan returns the existing key and records the person key it lacked', async () => {
    // The pre-Level-1 row: written without DG11, so no person key.
    const before = await getOrCreateKeyForPassport(chip('passport', 1, undefined));
    expect((await lookupKeyForPassport(before.passportHash))?.personKey).toBeUndefined();
    // Owner votes with it later — same chip, DG11 now supplied.
    const again = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    expect(again.isNew).toBe(false);
    expect(again.privateKey).toBe(before.privateKey);
    expect(again.linkedToExisting).toBe(false); // nothing to share with yet
    expect((await lookupKeyForPassport(again.passportHash))?.personKey).toBeDefined();
    // and NOW the ID card finds it
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(card.privateKey).toBe(before.privateKey);
    expect(card.linkedToExisting).toBe(true);
  });

  // Step 7 reads the link on every scan, and a refused registration is
  // retried by rescanning: the flag must not be true only on the scan that
  // created the row.
  it('a rescan of either linked document still reports the link', async () => {
    await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    const cardAgain = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(cardAgain.isNew).toBe(false);
    expect(cardAgain.linkedToExisting).toBe(true);
    // ...and the passport, whose key the card took, reports it too.
    const passAgain = await getOrCreateKeyForPassport(chip('passport', 1, ALICE_PASS));
    expect(passAgain.linkedToExisting).toBe(true);
  });

  it('documents the limitation: without that rescan, the second document misses', async () => {
    // Same setup, but the ID card arrives BEFORE the passport is rescanned.
    const before = await getOrCreateKeyForPassport(chip('passport', 1, undefined));
    const card = await getOrCreateKeyForPassport(chip('idCard', 2, ALICE_CARD));
    expect(card.privateKey).not.toBe(before.privateKey);
    expect(card.linkedToExisting).toBe(false);
  });
});

// Dossier 2.0.2, item 14 (h): key resolution and the existing writes are
// serialised. SecureStore is made slow here so that, without the queue, two
// resolutions would interleave between their read and their write.
describe('getOrCreateKeyForPassport — serialisation', () => {
  let restore: () => void;
  beforeEach(() => {
    const get = SecureStore.getItemAsync as jest.Mock;
    const orig = get.getMockImplementation()!;
    get.mockImplementation(async (k: string) => {
      await new Promise((r) => setTimeout(r, 5));
      return orig(k);
    });
    restore = () => get.mockImplementation(orig);
  });
  afterEach(() => restore());

  it('two concurrent resolutions of one document give one key and one row', async () => {
    const [a, b] = await Promise.all([
      getOrCreateKeyForPassport(chip('passport', 7, ALICE_PASS)),
      getOrCreateKeyForPassport(chip('passport', 7, ALICE_PASS)),
    ]);
    expect(b.privateKey).toBe(a.privateKey);
    expect([a.isNew, b.isNew]).toEqual([true, false]);
    expect(await getAllEntries()).toHaveLength(1);
  });

  it('two documents resolved back to back: each keeps its own key, the slot ends on the last one', async () => {
    const [x, y] = await Promise.all([
      getOrCreateKeyForPassport(chip('passport', 8, undefined)),
      getOrCreateKeyForPassport(chip('idCard', 9, undefined)),
    ]);
    expect(x.privateKey).not.toBe(y.privateKey);
    expect((await lookupKeyForPassport(x.passportHash))?.privateKey).toBe(x.privateKey);
    expect((await lookupKeyForPassport(y.passportHash))?.privateKey).toBe(y.privateKey);
    expect(await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY)).toBe(y.privateKey);
  });

  it('a failing resolution does not block the next one', async () => {
    const bad = getOrCreateKeyForPassport({ dg1: undefined as any, sod: undefined as any });
    const good = getOrCreateKeyForPassport(chip('passport', 10, undefined));
    await expect(bad).rejects.toBeDefined();
    await expect(good).resolves.toMatchObject({ isNew: true });
  });
});
