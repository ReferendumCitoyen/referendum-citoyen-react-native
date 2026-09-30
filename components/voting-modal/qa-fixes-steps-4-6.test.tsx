/**
 * QA 2.0.2 fixes on steps 4 and 6 (items 10 and 11 of the gallery findings):
 *   - "Lancer l'analyse" is disabled during the 500 ms hand-off after a
 *     successful read;
 *   - "CAN manquant" offers the button that goes back to the CAN field;
 *   - a phone without NFC gets a way out of step 4.
 * Step 6 harness shared with __verify__/P15-android-auth-tag-lost.verify.test.tsx.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Buffer } from 'buffer';

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

function mount(os: 'ios' | 'android', accessKey: unknown = CAN_KEY) {
  jest.replaceProperty(Platform, 'OS', os);
  const onNFCSuccess = jest.fn();
  const onGoBack = jest.fn();
  const r = render(
    <ThemeProvider>
      <Step6
        containerWidth={300}
        player={null}
        accessKey={accessKey as any}
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


jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: async () => true }),
}));
jest.mock('expo-video', () => ({ VideoView: () => null }));
import Step4 from './Step4';

const CHIP = { dg1Bytes: new Uint8Array(95), sodBytes: new Uint8Array(10), personDetails: {} };

function isDisabled(node: any): boolean {
  let n = node;
  while (n) {
    if (n.props?.accessibilityState?.disabled || n.props?.disabled === true) return true;
    n = n.parent;
  }
  return false;
}

describe('Step 6: the hand-off after a successful read', () => {
  it('"Lancer l\'analyse" cannot start a new read during the 500 ms before step 7', async () => {
    let finish!: (v: string) => void;
    mockNativeScan.mockImplementation(() => new Promise<string>((res) => { finish = res; }));
    const { r, onNFCSuccess } = mount('android');
    fireEvent.press(r.getByText('common.analyze'));
    await advance(6_000);
    expect(mockNativeScan).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(JSON.stringify({ dg1: Buffer.from(CHIP.dg1Bytes).toString('base64'), sod: Buffer.from(CHIP.sodBytes).toString('base64'), personDetails: {} }));
    });
    await flush();
    const button = r.getByText('common.analyze');
    expect(isDisabled(button)).toBe(true);
    fireEvent.press(button);
    await advance(750);
    expect(mockNativeScan).toHaveBeenCalledTimes(1);
    expect(onNFCSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('Step 6: no CAN to open the chip with', () => {
  it('shows the missing-CAN message with the button back to the CAN field', async () => {
    const { r, onGoBack } = mount('ios', null);
    fireEvent.press(r.getByText('common.analyze'));
    await flush();
    expect(r.queryByText('voting.step6MissingAccess_idCard')).not.toBeNull();
    fireEvent.press(r.getByText('voting.step6EditAccess_idCard'));
    expect(onGoBack).toHaveBeenCalledTimes(1);
    expect(mockNativeScan).not.toHaveBeenCalled();
  });
});

describe('Step 4: a phone without NFC', () => {
  it.each(['ios', 'android'] as const)('%s: the notice comes with a way back home', (os) => {
    jest.replaceProperty(Platform, 'OS', os);
    const onExit = jest.fn();
    const r = render(
      <ThemeProvider>
        <Step4 player={null} containerWidth={300} nfcUnsupported onExit={onExit} />
      </ThemeProvider>,
    );
    expect(r.queryByText('voting.nfcUnsupportedDevice')).not.toBeNull();
    expect(r.queryByText('voting.step4Start')).toBeNull();
    fireEvent.press(r.getByText('common.backToHome'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
