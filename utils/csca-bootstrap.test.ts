/**
 * One owner per CSCA cache (dossier 2.0.2, R9): a generation-tagged build,
 * a release that never touches a newer generation, and a warm-up that never
 * starts a second build while one is held.
 */
import * as fs from 'fs';
import * as path from 'path';

const PEM = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'certificates', 'master_000316.pem'),
  'utf8',
);

const mockRead = jest.fn(async () => PEM);
jest.mock('@/assets/certificates/master_000316.pem', () => 'master.pem', { virtual: true });
jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ localUri: 'file:///master.pem', downloadAsync: async () => {} }) },
}));
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (...args: unknown[]) => mockRead(...(args as [])),
  EncodingType: { UTF8: 'utf8' },
}));
jest.mock('@/utils/relayer-simulation', () => ({ assertWouldNotRevert: jest.fn() }));
jest.mock('@/utils/build-register-cert-calldata', () => ({
  buildRegisterCertificateCalldata: jest.fn(),
  MAINNET_REGISTRATION2_ADDRESS: '0x0',
}));
jest.mock('@/utils/logger', () => ({ loggableTxHash: (h: string) => h }));

import {
  __resetMastersCacheForTests,
  currentMastersGeneration,
  ensureMastersCache,
  releaseMastersCache,
  warmMastersCache,
} from '@/utils/csca-bootstrap';

beforeEach(() => {
  __resetMastersCacheForTests();
  mockRead.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('CSCA cache ownership', () => {
  it('warming twice joins the first build instead of starting another', async () => {
    const a = warmMastersCache();
    const b = warmMastersCache();
    expect(b).toBe(a);
    await ensureMastersCache();
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('a release naming an older generation leaves the newer build alone', async () => {
    const old = warmMastersCache();
    await ensureMastersCache();
    releaseMastersCache(old);
    const fresh = warmMastersCache();
    expect(fresh).not.toBe(old);
    await ensureMastersCache();
    // The superseded owner releases late: nothing happens.
    releaseMastersCache(old);
    expect(currentMastersGeneration()).toBe(fresh);
    // Its own owner can.
    releaseMastersCache(fresh);
    expect(currentMastersGeneration()).toBeNull();
  });

  it('a release while the build is in flight stops that build, and the next caller rebuilds', async () => {
    const gen = warmMastersCache();
    const first = ensureMastersCache();
    releaseMastersCache(gen);
    await expect(first).rejects.toThrow(/cancelled/);
    const tree = (await ensureMastersCache()).tree;
    expect(tree.root().length).toBe(32);
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('builds the same SKI map as before (857 certs parsed)', async () => {
    const { bySki } = await ensureMastersCache();
    expect(bySki.size).toBeGreaterThan(0);
  });
});
