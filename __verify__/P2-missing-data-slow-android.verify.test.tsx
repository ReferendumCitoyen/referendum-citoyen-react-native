/**
 * P2: on slow Android phones, after a good chip read, Step 7 ends on
 * "Données d'identité manquantes". In all 23 reports the CSCA PEM parse took
 * 32 to 50 s, and the 30 s watchdog was logged at +33 to +51 s, in the same
 * second as `[FreedomTool] Initialising for network=mainnet`: the JS thread
 * was frozen by the synchronous parse, the watchdog callback ran first when it
 * came back, and the SDK refs arrived right after.
 *
 * Replays (1) that timeline at Step 7: the thread is frozen for 40 s while
 * the step waits for the SDK, the watchdog fires late, the SDK arrives just
 * after; (2) the parse itself on a large master list: other queued work must
 * get the thread while the parse runs.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, act } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    set() {}
    delete() {}
  },
}));
jest.mock('expo-video', () => ({ VideoView: () => null }));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: () => {},
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/ErrorReportButton', () => ({ ErrorReportButton: () => null }));
jest.mock('@/constants/mock-backend', () => ({ isMockBackend: () => false, mockDelay: async () => {} }));
jest.mock('@/constants/td1-heavy-register', () => ({ TD1_HEAVY_REGISTER: true }));
jest.mock('@/utils/heavy-circuits', () => ({ heavyCircuitNameForDg1: () => 'registerIdentity_TD1' }));
jest.mock('@/utils/e-document/dg11', () => ({ parseDg11: () => null }));
jest.mock('@/utils/e-document/e-document', () => ({
  EPassport: class {
    sod = { encapsulatedContent: new Uint8Array(313) };
  },
}));

const mockGenerate = jest.fn();
const mockRegister = jest.fn();
jest.mock('@/utils/register-via-noir', () => ({
  generateHeavyNoirProofWithCscaBootstrap: (...a: unknown[]) => mockGenerate(...a),
  registerIdentityViaNoir: (...a: unknown[]) => mockRegister(...a),
}));
jest.mock('@/utils/key-diagnosis', () => ({
  diagnoseKeyMismatch: () => ({}),
  formatKeyDiagnosis: () => 'keys held: 1 (idCard) — NOT RECOVERABLE on this device',
}));
jest.mock('@/utils/identity', () => ({
  getOrCreatePrivateKey: async () => mockState.globalSlotKey,
  readPrivateKey: async () => mockState.globalSlotKey,
}));
jest.mock('@/utils/passport-key-db', () => ({
  computePassportHash: () => 'DOCHASH',
  lookupKeyForPassport: async () => (mockState.dbKey ? { privateKey: mockState.dbKey } : null),
  markRegistered: async () => {},
  setOnChainIdentity: async () => {},
  getAllEntries: async () => [],
  docTypeFromDg1: () => 'idCard',
}));
const mockProbe = jest.fn(() => 'ok');
jest.mock('@modules/witnesscalculator/src/WitnesscalculatorModule', () => ({
  __esModule: true,
  default: { probeNoirLibrary: () => mockProbe() },
}));

/** What the chain says, per key: the key the document is bound to. */
const mockState: {
  boundKey: string | null;
  landed: boolean;
  globalSlotKey: string;
  dbKey: string | null;
} = { boundKey: null, landed: false, globalSlotKey: 'aa', dbKey: 'aa' };

function mockStatusFor(key: string): string {
  if (!mockState.boundKey) return 'NOT_REGISTERED';
  return mockState.boundKey === key ? 'REGISTERED_WITH_THIS_PK' : 'REGISTERED_WITH_OTHER_PK';
}

jest.mock('@rarimo/rarime-rn-sdk', () => ({
  DocumentStatus: {
    NotRegistered: 'NOT_REGISTERED',
    RegisteredWithThisPk: 'REGISTERED_WITH_THIS_PK',
    RegisteredWithOtherPk: 'REGISTERED_WITH_OTHER_PK',
  },
  RarimeUtils: { getProfileKey: (k: string) => 'profile-' + k },
  // Only the candidate builds an instance itself (its status re-read).
  Rarime: class {
    key: string;
    constructor(cfg: any) { this.key = cfg?.userConfiguration?.userPrivateKey; }
    async getDocumentStatus() { return mockStatusFor(this.key); }
    async getPassportInfo() { return [{ activeIdentity: 'x' }]; }
    async getSMTProof() { return { existence: mockState.landed, root: '0x1', siblings: [] }; }
  },
}));


// For the parse replay: the bundled master list, read from the repository,
// repeated to stand for a slow phone.
const mockPem: { text: string } = { text: '' };
jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ localUri: 'file:///master.pem', downloadAsync: async () => {} }) },
}));
jest.mock('@/assets/certificates/master_000316.pem', () => 1, { virtual: true });
jest.mock('@/utils/relayer-simulation', () => ({ assertWouldNotRevert: jest.fn() }));
jest.mock('@/utils/build-register-cert-calldata', () => ({
  buildRegisterCertificateCalldata: jest.fn(),
  MAINNET_REGISTRATION2_ADDRESS: '0x0',
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' },
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: async () => mockPem.text,
  writeAsStringAsync: async () => {},
  getInfoAsync: async () => ({ exists: false }),
  deleteAsync: async () => {},
}));

import Step7 from '@/components/voting-modal/Step7';
import { ThemeProvider } from '@/contexts/ThemeContext';

/** An SDK instance built with `key`, as voting-flow hands it to Step 7. */
function sdkWithKey(key: string) {
  return {
    getDocumentStatus: jest.fn(async () => mockStatusFor(key)),
    getPassportInfo: jest.fn(async () => [{ activeIdentity: 'x' }]),
    getSMTProof: jest.fn(async () => ({ existence: mockState.landed, root: '0x1', siblings: [] })),
    registerIdentity: jest.fn(),
  } as any;
}

const passportMock = {
  getMRZData: () => ({ issuingCountry: 'FRA' }),
  dataGroup1: new Uint8Array(95),
  sod: new Uint8Array(10),
  dataGroup15: undefined,
  extractDGHashAlgo: () => 'oid',
  getSignatureAlgorithm: () => 'oid',
} as any;

const nfcData = { dg1Bytes: new Uint8Array(95), sodBytes: new Uint8Array(10), personDetails: {} } as any;

function tree(props: Record<string, unknown>) {
  return (
    <ThemeProvider>
      <Step7 containerWidth={300} player={null} network="mainnet" nfcData={nfcData} {...(props as any)} />
    </ThemeProvider>
  );
}

function mountStep7(props: Record<string, unknown>) {
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const all = { isActive: true, onSuccess, onError, ...props };
  const r = render(tree(all));
  return {
    r,
    onSuccess,
    onError,
    update: (extra: Record<string, unknown>) => r.rerender(tree({ ...all, ...extra })),
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
};
const advance = async (ms: number, step = 500) => {
  for (let t = 0; t < ms; t += step) {
    await act(async () => { jest.advanceTimersByTime(step); });
    await flush();
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  mockGenerate.mockReset();
  mockRegister.mockReset();
  mockProbe.mockReset();
  mockProbe.mockReturnValue('ok');
  mockState.boundKey = null;
  mockState.landed = false;
  mockState.globalSlotKey = 'aa';
  mockState.dbKey = 'aa';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('P2: a frozen JS thread does not turn into "missing identity data"', () => {
  it('the SDK arriving right after a 40 s freeze is used, not declared missing', async () => {
    const S = mountStep7({ passport: passportMock });
    await advance(2_000);
    // The synchronous CSCA parse freezes the thread for 40 s: the clock moves,
    // no timer runs.
    jest.setSystemTime(Date.now() + 40_000);
    // The thread comes back: the queued watchdog runs first...
    await advance(30_000);
    // ...and the SDK init that was queued behind it lands a moment later.
    mockState.boundKey = 'aa';
    S.update({ rarime: sdkWithKey('aa'), attemptKey: { privateKey: 'aa', passportHash: 'DOCHASH', keySource: 'db' } });
    await advance(10_000);
    const missing = S.onError.mock.calls.filter((c) => /missing-data|step7MissingData/.test(String(c[0]) + String(c[1]?.message)));
    expect(missing).toHaveLength(0);
    expect(S.onSuccess).toHaveBeenCalledWith(false);
  });

  it('a genuine init failure on a free thread still ends on the missing-data message', async () => {
    const S = mountStep7({ passport: passportMock });
    await advance(35_000);
    expect(S.onError).toHaveBeenCalledWith('voting.step7MissingData_idCard', expect.anything());
  });
});

describe('P2: the master-list parse leaves the JS thread to other work', () => {
  it('a callback queued when the parse starts runs before the parse ends', async () => {
    jest.useRealTimers();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const one = fs.readFileSync(path.join(process.cwd(), 'assets/certificates/master_000316.pem'), 'utf8');
    mockPem.text = one.repeat(6);
    const order: string[] = [];
    (console.log as jest.Mock).mockImplementation((...a: unknown[]) => {
      if (String(a[0]).includes('PEM parsed')) order.push('parse-done');
    });
    let ensureMastersCache!: () => Promise<unknown>;
    jest.isolateModules(() => {
      jest.unmock('@/utils/csca-bootstrap');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ ensureMastersCache } = require('@/utils/csca-bootstrap'));
    });
    const build = ensureMastersCache();
    // Stands for the AsyncStorage / SDK-init reply that Step 7 waits for.
    setTimeout(() => order.push('other-work'), 0);
    await build;
    expect(order.indexOf('other-work')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('other-work')).toBeLessThan(order.indexOf('parse-done'));
  }, 120_000);
});
