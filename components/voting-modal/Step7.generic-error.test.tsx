/**
 * QA Android 2.0.2, item 4.3 — `step7-generic`.
 *
 * On all four device/scale combinations the state stayed on the spinner and
 * "Vérification en cours…", with no message and no report button, although
 * the log showed `[Step7] Verification error: Error: QA simulated unexpected
 * failure` and the gallery recorder showed the `onError` action had fired.
 *
 * The scenario, reproduced exactly:
 *   - Step 7 is rendered with `nfcData={null}` (what the gallery state does),
 *     so the first thing the verification effect touches — `getMRZData()` —
 *     throws, before any `await`;
 *   - the error carries no sentinel, so the mapping falls through to its
 *     `fallback` translator (formatRpcError), the only Step 7 message source
 *     that does not go through the component's own `t`. Here that translator
 *     answers nothing, as an i18next instance that is not up does.
 *
 * Before the fix the empty answer was stored as-is: `errorMessage` was falsy,
 * the render stayed in its loading branch and the report button never showed.
 */
import React from 'react';
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
// The component's own translator answers; the lazily-required one inside
// formatRpcError does not — exactly the asymmetry the defect lived in.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => undefined },
}));
// Rendered as plain text so the assertion can see the gate, not the button.
jest.mock('@/components/ErrorReportButton', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  return { ErrorReportButton: () => ReactLib.createElement(RN.Text, null, 'REPORT-BUTTON') };
});
jest.mock('@/constants/mock-backend', () => ({ isMockBackend: () => false, mockDelay: async () => {} }));
jest.mock('@/utils/e-document/dg11', () => ({ parseDg11: () => null }));
jest.mock('@/utils/e-document/e-document', () => ({
  EPassport: class {
    sod = { encapsulatedContent: new Uint8Array(313) };
  },
}));
jest.mock('@/utils/register-via-noir', () => ({
  generateHeavyNoirProofWithCscaBootstrap: jest.fn(),
  registerIdentityViaNoir: jest.fn(),
}));
jest.mock('@/utils/key-diagnosis', () => ({
  diagnoseKeyMismatch: () => ({}),
  formatKeyDiagnosis: () => '',
}));
jest.mock('@modules/witnesscalculator/src/WitnesscalculatorModule', () => ({
  __esModule: true,
  default: { probeNoirLibrary: () => 'ok' },
}));
jest.mock('@/utils/csca-bootstrap', () => ({
  releaseMastersCache: jest.fn(),
  warmMastersCache: jest.fn(() => 1),
  ensureMastersCache: jest.fn(async () => ({})),
}));
jest.mock('@/utils/identity', () => ({
  getOrCreatePrivateKey: async () => 'aa',
  readPrivateKey: async () => 'aa',
}));
jest.mock('@/utils/passport-key-db', () => ({
  computePassportHash: () => 'DOCHASH',
  lookupKeyForPassport: async () => ({ privateKey: 'aa' }),
  markRegistered: async () => {},
  setOnChainIdentity: async () => {},
  getAllEntries: async () => [],
  docTypeFromDg1: () => 'idCard',
}));
jest.mock('@rarimo/rarime-rn-sdk', () => ({
  DocumentStatus: {
    NotRegistered: 'NOT_REGISTERED',
    RegisteredWithThisPk: 'REGISTERED_WITH_THIS_PK',
    RegisteredWithOtherPk: 'REGISTERED_WITH_OTHER_PK',
  },
  RarimeUtils: { getProfileKey: (k: string) => 'profile-' + k },
  Rarime: class {},
}));

import Step7 from './Step7';
import { ThemeProvider } from '@/contexts/ThemeContext';

const ATTEMPT = { privateKey: 'aa', passportHash: 'DOCHASH', keySource: 'created' };

/** The gallery's `failingStep7Sdk`: the first call Step 7 makes throws. */
function failingPassport(message: string) {
  return {
    dataGroup1: new Uint8Array(95),
    sod: new Uint8Array(0),
    dataGroup15: undefined,
    getMRZData: () => {
      throw new Error(message);
    },
    extractDGHashAlgo: () => '',
    getSignatureAlgorithm: () => '',
  } as any;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('Step 7: an unexpected failure whose fallback translator answers nothing', () => {
  it('leaves the loading state, shows a message and offers the report button', async () => {
    const onError = jest.fn();
    const r = render(
      <ThemeProvider>
        <Step7
          containerWidth={300}
          player={null}
          network="mainnet"
          nfcData={null}
          isActive
          rarime={{} as any}
          passport={failingPassport('QA simulated unexpected failure')}
          attemptKey={ATTEMPT as any}
          onError={onError}
        />
      </ThemeProvider>,
    );
    await flush();

    // The failure reached the screen at all.
    expect(onError).toHaveBeenCalledTimes(1);
    // …with a sentence, not `undefined` (this is what used to fail).
    const shown = onError.mock.calls[0][0];
    expect(typeof shown).toBe('string');
    expect(String(shown).trim().length).toBeGreaterThan(0);
    // The spinner's status line is gone: no more "Vérification en cours…".
    expect(r.queryByText('voting.step7Verifying')).toBeNull();
    // The message is on screen, and the report button with it.
    expect(r.queryByText(String(shown))).not.toBeNull();
    expect(r.queryByText('REPORT-BUTTON')).not.toBeNull();
  });
});
