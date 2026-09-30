/**
 * Dossier 2.0.2, R2 / item 14 (a, f, g): the attempt's key is resolved per
 * document, handed on as a value, and a failed resolution stops the attempt
 * instead of falling back to the global slot.
 */
import * as SecureStore from 'expo-secure-store';

import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';
import { resolveAttemptKey } from '@/utils/attempt-key';
import { wipeDb } from '@/utils/passport-key-db';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});

let mockMinted = 0;
jest.mock('@rarimo/rarime-rn-sdk', () => ({
  RarimeUtils: { generateBJJPrivateKey: () => (++mockMinted + 100).toString(16).padStart(64, '0') },
}));
jest.mock('@/constants/universal-person-key', () => ({ UNIVERSAL_PERSON_KEY: false }));

const doc = (kind: 'passport' | 'idCard', seed: number) => ({
  dg1: new Uint8Array(kind === 'passport' ? 93 : 95).fill(1),
  sod: new Uint8Array(64).fill(seed),
});

beforeEach(async () => {
  await wipeDb();
  await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
});

describe('resolveAttemptKey', () => {
  it('two documents alternated each keep their own key, whatever the global slot says afterwards', async () => {
    const x = (await resolveAttemptKey(doc('idCard', 1))).key;
    const y = (await resolveAttemptKey(doc('idCard', 2))).key;
    expect(x.privateKey).not.toBe(y.privateKey);
    // The slot now holds Y's key; X's captured value is untouched.
    expect(await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY)).toBe(y.privateKey);
    const xAgain = (await resolveAttemptKey(doc('idCard', 1))).key;
    expect(xAgain.privateKey).toBe(x.privateKey);
    expect(xAgain.passportHash).toBe(x.passportHash);
    expect(xAgain.keySource).toBe('per-document');
  });

  it('labels a key adopted from the pre-DB slot as legacy-fallback', async () => {
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, '2'.repeat(64)); // nosec: test fixture key
    const { key } = await resolveAttemptKey(doc('passport', 3));
    expect(key.keySource).toBe('legacy-fallback');
  });

  it('a failed resolution rejects and never falls back to the global slot', async () => {
    const identity = require('@/utils/identity');
    const spy = jest
      .spyOn(identity, 'getOrCreateKeyForPassport')
      .mockRejectedValueOnce(new Error('SecureStore unavailable'));
    (SecureStore.getItemAsync as jest.Mock).mockClear();
    await expect(resolveAttemptKey(doc('idCard', 4))).rejects.toThrow('SecureStore unavailable');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
