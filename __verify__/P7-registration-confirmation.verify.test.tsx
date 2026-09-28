/**
 * P7: the relayer accepted the registration, the SMT poll kept answering
 * existence=false, and after 60 s Step 7 showed "service temporairement
 * indisponible ... votre vote n'a pas encore été enregistré". Successful
 * confirmations elsewhere in the reports took up to 558 s.
 *
 * Replays a registration accepted at once whose leaf shows up in the SMT 90 s
 * later: the step must end on success, not on a failure after 60 s.
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
jest.mock('@/utils/csca-bootstrap', () => ({
  releaseMastersCache: jest.fn(),
  warmMastersCache: jest.fn(() => 1),
  ensureMastersCache: jest.fn(async () => ({})),
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

describe('P7: a registration that lands after 60 s is not reported as failed', () => {
  it('the leaf appears 90 s after the relayer accepted: Step 7 succeeds', async () => {
    mockGenerate.mockResolvedValue({ proof: 'p' });
    mockRegister.mockImplementation(async () => {
      setTimeout(() => { mockState.boundKey = 'aa'; mockState.landed = true; }, 90_000);
      return { txHash: '0x' + 'ab'.repeat(32) };
    });
    const { onSuccess, onError } = mountStep7({
      rarime: sdkWithKey('aa'),
      passport: passportMock,
      attemptKey: { privateKey: 'aa', passportHash: 'DOCHASH', keySource: 'db' },
    });
    await advance(130_000);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(true);
  });
});
