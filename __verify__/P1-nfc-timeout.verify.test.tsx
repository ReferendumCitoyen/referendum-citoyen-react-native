/**
 * P1: chip reads end in "NFC scan timeout" exactly 30 s after
 * `Starting scanDocument`. Successful Android reads in the reports take up to
 * 27.6 s (29.98 s on 2.0.0), so the 30 s JavaScript watchdog sits right on
 * the tail of legitimate reads, and on iOS it races CoreNFC's own 60 s
 * session.
 *
 * Replays a read that the chip completes after 45 s (Android) and 50 s (iOS):
 * the result must reach the flow instead of a timeout. Runs Step 6 over the
 * real modules/e-document wrapper with the native module mocked.
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
const DG1_TD1 = Buffer.alloc(95, 1).toString('base64');
const nativeResult = JSON.stringify({ dg1: DG1_TD1, sod: Buffer.alloc(10, 2).toString('base64'), personDetails: {} });

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
};

async function readThatTakes(os: 'ios' | 'android', readMs: number) {
  jest.replaceProperty(Platform, 'OS', os);
  mockNativeScan.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(nativeResult), readMs)),
  );
  const onNFCSuccess = jest.fn();
  const r = render(
    <ThemeProvider>
      <Step6
        containerWidth={300}
        player={null}
        accessKey={CAN_KEY as any}
        onNFCSuccess={onNFCSuccess}
        onGoBack={jest.fn()}
        {...({ isActive: true } as any)}
      />
    </ThemeProvider>,
  );
  fireEvent.press(r.getByText('common.analyze'));
  await flush();
  // Android waits up to 5 s before arming the reader; then the read itself.
  const total = (os === 'android' ? 5_000 : 0) + readMs + 1_000;
  for (let t = 0; t < total; t += 1_000) {
    await act(async () => { jest.advanceTimersByTime(1_000); });
    await flush();
  }
  return { r, onNFCSuccess };
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

describe('P1: a slow but successful chip read is not cut at 30 s', () => {
  it('control: a 10 s read reaches the flow on both platforms', async () => {
    expect((await readThatTakes('android', 10_000)).onNFCSuccess).toHaveBeenCalledTimes(1);
    expect((await readThatTakes('ios', 10_000)).onNFCSuccess).toHaveBeenCalledTimes(1);
  });

  it('Android: a read that completes after 45 s reaches the flow', async () => {
    const { onNFCSuccess } = await readThatTakes('android', 45_000);
    expect(onNFCSuccess).toHaveBeenCalledTimes(1);
  });

  it('iOS: a read that completes after 50 s (inside CoreNFC\'s 60 s session) reaches the flow', async () => {
    const { onNFCSuccess } = await readThatTakes('ios', 50_000);
    expect(onNFCSuccess).toHaveBeenCalledTimes(1);
  });
});
