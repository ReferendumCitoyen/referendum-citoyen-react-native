/**
 * P15: Android chip reads fail with "Authentication failed for ID card. Try
 * providing the CAN (6 digits) from the back of the card. Original error: Tag
 * was lost." The wrapper is Android's generic PACE failure text; the cause it
 * carries is a lost tag, and in the reports the same session usually reads the
 * card successfully later with the same CAN. The user must be told to hold the
 * card still, and not be steered first to re-typing a CAN that was right.
 *
 * Replays that native error through the real modules/e-document wrapper and
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

const ANDROID_TAG_LOST =
  'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card. ' +
  'Original error: Tag was lost.';

describe('P15: Android "Authentication failed ... Tag was lost"', () => {
  // Was `it.failing` on 7e5c760 (regression: any "Authentication failed for ID
  // card" without 6982 was read as canRejected). Fixed in scan-error.ts by
  // reading the "Original error" part first (plan D1).
  it('is explained as lost contact, with Retry as the main action', async () => {
    nativeFails(ANDROID_TAG_LOST, 4_000);
    const { r } = mount('android');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(10_000);
    expect(r.queryByText(/step6TagLostError/)).not.toBeNull();
    expect(r.queryByText(/step6CanRejected/)).toBeNull();
  });

  it.each([
    'java.io.IOException: Not connected',
    'java.lang.SecurityException: Tag 1a2b3c4d is out of date',
  ])('"%s" inside the wrapper is lost contact too', async (cause) => {
    nativeFails(ANDROID_TAG_LOST.replace('Tag was lost.', cause), 4_000);
    const { r } = mount('android');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(10_000);
    expect(r.queryByText(/step6TagLostError/)).not.toBeNull();
    expect(r.queryByText(/step6CanRejected/)).toBeNull();
  });
});

describe('P15 / D14: what the log keeps of that failure', () => {
  it('Step 6 logs the type and the closed code, not the native text', async () => {
    nativeFails(ANDROID_TAG_LOST.replace('Tag was lost.', 'Tag 04A1B2C3D4E5F6 is out of date'), 4_000);
    const { r } = mount('android');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(10_000);
    const logged = [console.log, console.warn, console.error]
      .flatMap((f) => (f as jest.Mock).mock.calls)
      .flat()
      .map(String)
      .join('\n');
    expect(logged).toContain('code=NFC_CONTACT_LOST');
    expect(logged).not.toContain('04A1B2C3D4E5F6');
    expect(r.queryByText(/step6TagLostError/)).not.toBeNull();
  });
});
