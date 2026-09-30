/**
 * P4: iOS chip reads failing with "NFCPassportReaderError: Unknown error:
 * Tag response error / no response" (after 3 to 25 s) or
 * "NFCPassportReaderError: UnexpectedError" (at 0 s, six times in a row in
 * one field report of 21/09) end on the generic "Erreur NFC ... le NFC est
 * activé" text, and immediate retries fail the same way.
 *
 * Replays both native errors through the real modules/e-document wrapper and
 * Step 6 (native module mocked).
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

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
jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(() => Promise.resolve()),
    isEnabled: jest.fn(() => Promise.resolve(true)),
    isSupported: jest.fn(() => Promise.resolve(true)),
  },
}));
jest.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array) => a }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
  }),
}));
jest.mock('@/contexts/DevModeContext', () => ({ useDevMode: () => ({ devMode: false }) }));
jest.mock('@/components/ErrorReportButton', () => ({ ErrorReportButton: () => null }));
jest.mock('@/components/FadeInImage', () => () => null);

const mockNativeScan = jest.fn();
jest.mock('@/modules/e-document/src/EDocumentModule', () => ({
  __esModule: true,
  default: {
    scanDocument: (...a: unknown[]) => mockNativeScan(...a),
    cancelScan: jest.fn(async () => {}),
    disableScan: jest.fn(async () => {}),
  },
}));
jest.mock('@/modules/e-document', () => {
  const actual = jest.requireActual('@/modules/e-document');
  return {
    ...actual,
    EDocumentModuleListener: () => ({ remove: () => {} }),
    EDocumentModuleEvents: {
      ScanStarted: 'SCAN_STARTED',
      RequestPresentPassport: 'REQUEST_PRESENT_PASSPORT',
      AuthenticatingWithPassport: 'AUTHENTICATING_WITH_PASSPORT',
      ReadingDataGroupProgress: 'READING_DATA_GROUP_PROGRESS',
      ActiveAuthentication: 'ACTIVE_AUTHENTICATION',
      SuccessfulRead: 'SUCCESSFUL_READ',
      ScanError: 'SCAN_ERROR',
      DebugLog: 'DEBUG_LOG',
      ScanStopped: 'SCAN_STOPPED',
    },
  };
});

import Step6 from '@/components/voting-modal/Step6';
import { ThemeProvider } from '@/contexts/ThemeContext';

const CAN_KEY = { kind: 'can', can: '123456' } as const;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};
const advance = async (ms: number) => {
  for (let t = 0; t < ms; t += 250) {
    await act(async () => { jest.advanceTimersByTime(250); });
    await flush();
  }
};

function mount(os: 'ios' | 'android') {
  jest.replaceProperty(Platform, 'OS', os);
  const onNFCSuccess = jest.fn();
  const onGoBack = jest.fn();
  const r = render(
    <ThemeProvider>
      <Step6
        containerWidth={300}
        player={null}
        accessKey={CAN_KEY as any}
        onNFCSuccess={onNFCSuccess}
        onGoBack={onGoBack}
        {...({ isActive: true } as any)}
      />
    </ThemeProvider>,
  );
  return { r, onNFCSuccess, onGoBack };
}

/** The native reader fails with `text` after `ms`. */
function nativeFails(text: string, ms: number) {
  mockNativeScan.mockImplementation(
    () => new Promise((_res, rej) => setTimeout(() => rej(new Error(text)), ms)),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNativeScan.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const TAG_RESPONSE = 'NFCPassportReaderError: Unknown error: Tag response error / no response';
const UNEXPECTED = 'NFCPassportReaderError: UnexpectedError';

describe('P4: iOS "Tag response error" and "UnexpectedError"', () => {
  it('a Tag response error after 5 s is explained as lost contact, not as NFC being off', async () => {
    nativeFails(TAG_RESPONSE, 5_000);
    const { r } = mount('ios');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(6_000);
    expect(r.queryByText(/step6TagLostError/)).not.toBeNull();
    expect(r.queryByText(/NFC est activé/)).toBeNull();
  });

  it('an UnexpectedError at 0 s does not let the next attempt start at once', async () => {
    nativeFails(UNEXPECTED, 0);
    const { r } = mount('ios');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(500);
    expect(mockNativeScan).toHaveBeenCalledTimes(1);
    // The immediate retry that produced the bursts in the reports.
    fireEvent.press(r.getByText('common.retry'));
    await advance(250);
    expect(mockNativeScan).toHaveBeenCalledTimes(1);
    // A few seconds later the retry works.
    await advance(3_000);
    fireEvent.press(r.getByText('common.retry'));
    await advance(250);
    expect(mockNativeScan).toHaveBeenCalledTimes(2);
  });
});
