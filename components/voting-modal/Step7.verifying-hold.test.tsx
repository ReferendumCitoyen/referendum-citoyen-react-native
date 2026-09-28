/**
 * QA iPhone 2.0.2, item 3: `step7-verifying` failed on the three iPhone
 * combinations ("No visible element found: Vérification en cours...") and
 * passed on the four Android ones.
 *
 * Cause: nothing about the rendering. The state is transient by construction.
 * Step 7 shows that line while it waits for the SDK refs and, after 30 s
 * without them, the missing-data watchdog replaces it with "Données
 * d'identité manquantes". The iPhone run needed 45 to 135 s per state (deep
 * link, sheet animation, XCTest view hierarchy), so it always screenshotted
 * the watchdog's message; the faster Android run caught the waiting line.
 *
 * The fix gives the watchdog an injectable delay, which the QA gallery raises
 * so the state it publishes is the state on screen. Production keeps the 30 s.
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

const draw = (props: Record<string, unknown>) =>
  render(
    <ThemeProvider>
      <Step7 containerWidth={300} slideAreaHeight={482} player={null} isActive {...props} />
    </ThemeProvider>,
  );

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('step 7 waiting state', () => {
  it('shows it, then lets the 30 s watchdog replace it (production default)', async () => {
    const r = draw({});
    expect(r.queryByText('voting.step7Verifying')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(31_000); });
    await flush();
    expect(r.queryByText('voting.step7Verifying')).toBeNull();
  });

  it('holds it for as long as the caller asks (what the QA gallery passes)', async () => {
    const r = draw({ missingDataTimeoutMs: 600_000 });
    await act(async () => { jest.advanceTimersByTime(120_000); });
    await flush();
    expect(r.queryByText('voting.step7Verifying')).toBeTruthy();
  });
});
