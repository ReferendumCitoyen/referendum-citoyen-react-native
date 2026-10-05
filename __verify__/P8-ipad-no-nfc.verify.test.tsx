/**
 * P8: iPads (no NFC reader) go through the whole flow, type the CAN, and fail
 * at step 6 with "NFCPassportReaderError: NFCNotSupported" at 0 s, shown as
 * the generic "le NFC est activé sur votre téléphone" text, 21 attempts over
 * 5 iPads on 2.0.1.
 *
 * Replays: (1) step 4 on a device whose NFC hardware check says "no reader"
 * (the flow passes that answer as `nfcUnsupported`), which must not offer the
 * start button; (2) the NFCNotSupported rejection at step 6, which must name
 * the missing reader instead of blaming a disabled NFC.
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
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('expo-video', () => ({ VideoView: () => null }));
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
import Step4 from '@/components/voting-modal/Step4';
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

describe('P8: a device without an NFC reader', () => {
  it('step 4 says so and offers no start button when the hardware check says "no reader"', () => {
    const onStartAnalysis = jest.fn();
    const r = render(
      <ThemeProvider>
        <Step4 player={null} containerWidth={300} onStartAnalysis={onStartAnalysis} {...({ nfcUnsupported: true } as any)} />
      </ThemeProvider>,
    );
    expect(r.queryByText('voting.step4Start')).toBeNull();
    expect(r.queryByText('voting.nfcUnsupportedDevice')).not.toBeNull();
  });

  it('step 6 names the missing reader for NFCNotSupported, not a disabled NFC', async () => {
    nativeFails('NFCPassportReaderError: NFCNotSupported', 0);
    const { r } = mount('ios');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(1_000);
    expect(r.queryByText(/NFC est activé/)).toBeNull();
    expect(r.queryByText(/nfcUnsupportedDevice/)).not.toBeNull();
  });
});
