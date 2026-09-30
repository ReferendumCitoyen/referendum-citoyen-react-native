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
// Keys, not translations: the assertions name the key each branch must use.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
  }),
}));
jest.mock('@/contexts/DevModeContext', () => ({ useDevMode: () => ({ devMode: false }) }));
jest.mock('@/components/ErrorReportButton', () => ({ ErrorReportButton: () => null }));
jest.mock('@/components/FadeInImage', () => () => null);

const mockListeners: Record<string, (payload: unknown) => void> = {};
const mockScanDocument = jest.fn();
const mockCancelScan = jest.fn(() => Promise.resolve());
jest.mock('@/modules/e-document', () => ({
  scanDocument: (...args: unknown[]) => mockScanDocument(...args),
  cancelScan: () => mockCancelScan(),
  EDocumentModuleListener: (name: string, cb: (payload: unknown) => void) => {
    mockListeners[name] = cb;
    return { remove: () => { delete mockListeners[name]; } };
  },
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
}));

import Step6 from './Step6';
import { ThemeProvider } from '@/contexts/ThemeContext';

const CAN_KEY = { kind: 'can', can: '123456' } as const;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Lets the component's awaits (dynamic import, NFC pre-check) run, then
// moves the clock.
const advance = async (ms = 0) => {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve(); });
  }
  if (ms > 0) {
    await act(async () => { jest.advanceTimersByTime(ms); });
  }
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = (props: Partial<React.ComponentProps<typeof Step6>> = {}) => {
  const onNFCSuccess = jest.fn();
  const onGoBack = jest.fn();
  const tree = (extra: Partial<React.ComponentProps<typeof Step6>> = {}) => (
    <ThemeProvider>
      <Step6
        containerWidth={300}
        player={null}
        accessKey={CAN_KEY}
        onNFCSuccess={onNFCSuccess}
        onGoBack={onGoBack}
        isActive
        {...props}
        {...extra}
      />
    </ThemeProvider>
  );
  const r = render(tree());
  return { ...r, onNFCSuccess, onGoBack, setProps: (extra: Partial<React.ComponentProps<typeof Step6>>) => r.rerender(tree(extra)) };
};

const withPlatform = (os: 'ios' | 'android') => {
  jest.replaceProperty(Platform, 'OS', os);
};

let logSpy: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  mockScanDocument.mockReset();
  mockCancelScan.mockClear();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Step6 on Android: the scan owns its wait', () => {
  beforeEach(() => withPlatform('android'));

  it('leaving during the 5 s pre-start wait never arms the reader', async () => {
    mockScanDocument.mockImplementation(() => deferred().promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance(2_000);
    r.setProps({ isActive: false });
    await advance(10_000);
    expect(mockScanDocument).not.toHaveBeenCalled();
    expect(mockCancelScan).not.toHaveBeenCalled();
  });

  it('cancel then retry: the old timer never cancels the new scan', async () => {
    mockScanDocument.mockImplementation(() => deferred().promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance(5_000);
    expect(mockScanDocument).toHaveBeenCalledTimes(1);

    await advance(10_000); // t = 15 s
    fireEvent.press(r.getByText('common.cancel'));
    await advance();
    expect(mockCancelScan).toHaveBeenCalledTimes(1);
    expect(r.getByText('voting.step6Cancelled')).toBeTruthy();

    fireEvent.press(r.getByText('common.retry'));
    await advance(5_000); // t = 20 s, second scan armed
    expect(mockScanDocument).toHaveBeenCalledTimes(2);

    await advance(45_000); // t = 65 s: the first scan's 60 s would fire here
    expect(mockCancelScan).toHaveBeenCalledTimes(1);
    expect(r.getByText('voting.step6Scanning')).toBeTruthy();

    await advance(15_000); // t = 80 s: the second scan's own 60 s
    expect(mockCancelScan).toHaveBeenCalledTimes(2);
    expect(r.getByText(/voting\.step6Timeout_idCard/)).toBeTruthy();
    expect(r.queryByText(/NFC scan timeout/)).toBeNull();
  });

  it('leaving the step while the reader is armed releases it', async () => {
    mockScanDocument.mockImplementation(() => deferred().promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance(5_000);
    r.setProps({ isActive: false });
    await advance();
    expect(mockCancelScan).toHaveBeenCalledTimes(1);
  });
});

describe('Step6 on iOS', () => {
  beforeEach(() => withPlatform('ios'));

  it('arms no read timer: CoreNFC ends the session, the 75 s net is the only JS limit', async () => {
    mockScanDocument.mockImplementation(() => deferred().promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance(70_000);
    expect(mockCancelScan).not.toHaveBeenCalled();
    await advance(5_000);
    expect(mockCancelScan).toHaveBeenCalledTimes(1);
    expect(r.getByText(/voting\.step6Timeout_idCard/)).toBeTruthy();
  });

  it('a late NFC success after leaving the step is ignored', async () => {
    const native = deferred<any>();
    mockScanDocument.mockImplementation(() => native.promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance();
    r.setProps({ isActive: false });
    await advance();
    native.resolve({ dg1Bytes: new Uint8Array(95), sodBytes: new Uint8Array(10) });
    await advance(2_000);
    expect(r.onNFCSuccess).not.toHaveBeenCalled();
  });

  it('a success is not handed on when the step is left within the 500 ms', async () => {
    const native = deferred<any>();
    mockScanDocument.mockImplementation(() => native.promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance();
    native.resolve({ dg1Bytes: new Uint8Array(95), sodBytes: new Uint8Array(10) });
    await advance(200);
    r.setProps({ isActive: false });
    await advance(1_000);
    expect(r.onNFCSuccess).not.toHaveBeenCalled();
  });

  it('a success on screen is handed on after 500 ms', async () => {
    const native = deferred<any>();
    mockScanDocument.mockImplementation(() => native.promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance();
    native.resolve({ dg1Bytes: new Uint8Array(95), sodBytes: new Uint8Array(10) });
    await advance(600);
    expect(r.onNFCSuccess).toHaveBeenCalledTimes(1);
  });

  it('a wrong CAN says so in French, brings the CAN edit forward, and Retry cools down 3 s', async () => {
    const native = deferred<any>();
    mockScanDocument.mockImplementation(() => native.promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance(4_000);
    native.reject(Object.assign(new Error('❌ La puce a refusé le numéro CAN…'), {
      nativeMessage: 'NFCPassportReaderError: InvalidResponse - Security status not satisfied',
      hasSpecificMessage: true,
    }));
    await advance();
    expect(r.getByText('voting.step6CanRejected')).toBeTruthy();
    expect(r.queryByText(/vérifiez que le NFC est activé/i)).toBeNull();

    // "Modifier le numéro CAN" is rendered before Retry.
    const edit = r.getByText('voting.step6EditAccess_idCard');
    const retry = r.getByText('common.retry');
    const texts = r.UNSAFE_root.findAllByType(require('react-native').Text).map((n: any) => n.props.children);
    expect(texts.indexOf(edit.props.children)).toBeLessThan(texts.indexOf(retry.props.children));

    fireEvent.press(retry);
    await advance();
    expect(mockScanDocument).toHaveBeenCalledTimes(1);
    await advance(3_000);
    mockScanDocument.mockImplementation(() => deferred().promise);
    fireEvent.press(r.getByText('common.retry'));
    await advance();
    expect(mockScanDocument).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['today: UnexpectedError at 60 s', 'NFCPassportReaderError: UnexpectedError', 60_000, /voting\.step6Timeout_idCard/],
    ['today: immediate UnexpectedError', 'NFCPassportReaderError: UnexpectedError', 0, /^voting\.step6NfcBusy$/],
    ['2.0.2: Unknown(Session timeout)', 'NFCPassportReaderError: Unknown(Error Domain=NFCError Code=201 "Session timeout")', 60_000, /voting\.step6Timeout_idCard/],
    ['2.0.2: Unknown(System resource unavailable)', 'NFCPassportReaderError: Unknown(Error Domain=NFCError Code=203 "System resource unavailable")', 5, /^voting\.step6NfcBusy$/],
  ])('%s → French message, no English', async (_label, nativeText, afterMs, expected) => {
    const native = deferred<any>();
    mockScanDocument.mockImplementation(() => native.promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance(afterMs);
    native.reject(Object.assign(new Error('❌ Erreur NFC'), { nativeMessage: nativeText, hasSpecificMessage: false }));
    await advance();
    expect(r.getByText(expected)).toBeTruthy();
    expect(r.queryByText(/UnexpectedError|Unknown\(|Session timeout|System resource/)).toBeNull();
  });

  /* -----------------------------------------------------------------------
   * The failure message has to be on screen without scrolling.
   *
   * Reproduced by hand on an iPhone 17, default text size, 2026-09-23: after a
   * failed read the screen showed the title, the picture, the instructions cut
   * mid sentence, and the three buttons in the fixed footer, with no message.
   * One drag revealed it. The footer, added on 15/09 so the buttons would stop
   * falling below the fold, had taken the room the message needed.
   * --------------------------------------------------------------------------*/
  describe('a failed read shows its reason without scrolling', () => {
    it('folds the illustration away and puts the message up', async () => {
      const native = deferred<any>();
      mockScanDocument.mockImplementation(() => native.promise);
      const r = mount();
      expect(r.getByTestId('step6-illustration')).toBeTruthy();

      fireEvent.press(r.getByText('common.analyze'));
      await advance(4_000);
      // Still reading: the picture is what the person needs, it stays.
      expect(r.getByTestId('step6-illustration')).toBeTruthy();

      native.reject(Object.assign(new Error('❌ Erreur NFC'), {
        nativeMessage: 'NFCPassportReaderError: UnexpectedError',
        hasSpecificMessage: false,
      }));
      await advance();

      // The message itself is covered by the French-message tests above; what
      // this one pins is that nothing pushes it off the viewport any more.
      expect(r.queryByTestId('step6-illustration')).toBeNull();
      expect(r.getByText('voting.step6RemoveBeforeRetry_idCard')).toBeTruthy();
      expect(r.getByText('common.retry')).toBeTruthy();
    });

    it('folds it away when the CAN is missing, where there is no retry either', async () => {
      const r = mount({ accessKey: null });
      expect(r.getByTestId('step6-illustration')).toBeTruthy();
      fireEvent.press(r.getByText('common.analyze'));
      await advance();
      expect(r.queryByTestId('step6-illustration')).toBeNull();
      expect(r.getByText('voting.step6MissingAccess_idCard')).toBeTruthy();
    });

    it('keeps it on a success, which lives 500 ms before step 7 takes over', async () => {
      const native = deferred<any>();
      mockScanDocument.mockImplementation(() => native.promise);
      const r = mount();
      fireEvent.press(r.getByText('common.analyze'));
      await advance(1_000);
      mockListeners['SUCCESSFUL_READ']?.({});
      await advance();
      // The success message is up, and the screen must not jump under it.
      expect(r.getByTestId('step6-illustration')).toBeTruthy();
    });

    it('asks the scroll for its end so the message is reached whatever the text size', async () => {
      const { ScrollView } = require('react-native');
      const scrollToEnd = jest
        .spyOn(ScrollView.prototype as any, 'scrollToEnd')
        .mockImplementation(() => {});
      try {
        const native = deferred<any>();
        mockScanDocument.mockImplementation(() => native.promise);
        const r = mount();
        fireEvent.press(r.getByText('common.analyze'));
        await advance(4_000);
        scrollToEnd.mockClear();
        native.reject(Object.assign(new Error('❌ Erreur NFC'), {
          nativeMessage: 'NFCPassportReaderError: UnexpectedError',
          hasSpecificMessage: false,
        }));
        // The scroll is asked for on a zero-delay timer, so the layout that
        // follows the fold has settled first: the clock has to move.
        await advance(10);
        expect(scrollToEnd).toHaveBeenCalled();
      } finally {
        scrollToEnd.mockRestore();
      }
    });
  });

  it('logs milestone lines with names and durations only', async () => {
    mockScanDocument.mockImplementation(() => deferred().promise);
    const r = mount();
    fireEvent.press(r.getByText('common.analyze'));
    await advance();
    const chipLike = { dg1: 'P<FRADUPONT<<JEAN', can: '123456', message: 'AUTH 9000 6f1a' };
    for (const name of [
      'SCAN_STARTED', 'REQUEST_PRESENT_PASSPORT',
      'AUTHENTICATING_WITH_PASSPORT', 'AUTHENTICATING_WITH_PASSPORT',
      'READING_DATA_GROUP_PROGRESS', 'READING_DATA_GROUP_PROGRESS',
      'SUCCESSFUL_READ', 'SCAN_ERROR',
    ]) {
      await act(async () => { jest.advanceTimersByTime(250); mockListeners[name]?.(chipLike); });
    }
    const lines = logSpy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('[Step6] event'));
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line).toMatch(/^\[Step6\] event (ScanStarted|RequestPresentPassport|AuthenticatingWithPassport|ReadingDataGroupProgress|SuccessfulRead|ScanError) \+\d+ms$/);
      expect(line).not.toMatch(/123456|DUPONT|9000|6f1a/);
    }
    expect(lines.filter((l) => l.includes('AuthenticatingWithPassport'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('ReadingDataGroupProgress'))).toHaveLength(1);
    r.unmount();
  });
});
