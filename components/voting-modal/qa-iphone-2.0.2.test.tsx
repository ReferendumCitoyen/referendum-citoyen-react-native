/**
 * The six display defects the local iPhone QA of 2.0.2 found (campaign of
 * 22 to 23/09/2026, qa-ios-reconciled/RESULTATS.md).
 *
 * One block per defect. Each assertion is written so that it fails on the
 * code as it was before the fix:
 *   1. step 11: see Step11.preparing-hold.test.tsx (its own mock set);
 *   2. step 5 padded its slide from the outside with a KeyboardAvoidingView,
 *      which grew it past the frame the flow clips instead of making the
 *      button scrollable;
 *   3. step 7: see Step7.verifying-hold.test.tsx (its own mock set);
 *   4. step 4 without a reader must be bounded and scrollable;
 *   5. step 6 had every button inside the scroll, below the fold on an
 *      iPhone SE;
 *   6. step 13 centred its scroll content, so an overflow cut the title off
 *      the top with no way to scroll back to it.
 */
import React from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, View } from 'react-native';
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
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: async () => true }),
}));
jest.mock('expo-video', () => ({ VideoView: () => null }));
jest.mock('lottie-react-native', () => 'LottieView');
jest.mock('@/modules/e-document/src/EDocumentModule', () => ({
  __esModule: true,
  default: {
    scanDocument: jest.fn(() => new Promise(() => {})),
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

import Step4 from './Step4';
import Step5Can from './Step5Can';
import Step6 from './Step6';
import Step12Error from './Step12Error';
import { slideScrollContent } from './styles';
import { ThemeProvider } from '@/contexts/ThemeContext';

const SLIDE = 482;
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Defect 2: step 5, "Continuer" unreachable with the keyboard open
// ---------------------------------------------------------------------------

describe('step 5 keeps Continuer reachable with the keyboard open', () => {
  const draw = () =>
    render(
      <ThemeProvider>
        <Step5Can containerWidth={300} slideAreaHeight={SLIDE} isActive />
      </ThemeProvider>,
    );

  // 2026-09-25: "Continuer" lives in a fixed footer under the scroll; the
  // footer's bottom padding grows by the keyboard height (the scroll box
  // above shrinks), so the button stays on screen while the voter types.
  it('lifts the footer by the keyboard height instead of the slide', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const listeners: Record<string, (e: unknown) => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, cb: (e: unknown) => void) => {
      listeners[name] = cb;
      return { remove: () => undefined };
    }) as never);

    const r = draw();
    const footerOf = () => r.getByTestId('step5-footer');
    const before = flat(footerOf().props.style).paddingBottom as number;
    const scrollPadBefore = flat(r.UNSAFE_getByType(ScrollView).props.contentContainerStyle).paddingBottom;

    act(() => listeners.keyboardWillShow?.({ endCoordinates: { height: 291 } }));

    const after = flat(footerOf().props.style).paddingBottom as number;
    expect(after).toBeGreaterThanOrEqual(291);
    expect(after).toBeGreaterThan(before);
    // The scroll content is not padded any more: the footer is what moves.
    expect(flat(r.UNSAFE_getByType(ScrollView).props.contentContainerStyle).paddingBottom).toBe(scrollPadBefore);

    act(() => listeners.keyboardWillHide?.({}));
    expect(flat(footerOf().props.style).paddingBottom).toBe(before);
  });

  // The slide itself must never grow: the flow clips it (slidingWrapper,
  // overflow: 'hidden'), so anything the keyboard pushes past the frame is
  // gone, which is exactly what KeyboardAvoidingView behavior="padding" did.
  it('never wraps the slide in a KeyboardAvoidingView', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const src = require('fs').readFileSync(`${__dirname}/Step5Can.tsx`, 'utf8');
    expect(src).not.toMatch(/<KeyboardAvoidingView/);
    expect(src.split('\n')[1]).not.toMatch(/KeyboardAvoidingView/);
    const r = draw();
    // The slide is a box of exactly the measured height; the scroll inside
    // it flexes (2026-09-25, footer), it is no longer capped by a maxHeight.
    const outer = r.UNSAFE_getByType(ScrollView).parent as { props: { style: unknown } };
    expect(flat(outer.props.style).height).toBe(SLIDE);
    expect(flat(r.UNSAFE_getByType(ScrollView).props.style).flex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Defect 4: step 4 without a reader, no way out on an iPhone SE
// ---------------------------------------------------------------------------

describe('step 4 without an NFC reader', () => {
  const draw = (os: 'ios' | 'android') => {
    jest.replaceProperty(Platform, 'OS', os);
    return render(
      <ThemeProvider>
        <Step4
          player={null}
          containerWidth={300}
          slideAreaHeight={SLIDE}
          nfcUnsupported
          onExit={jest.fn()}
        />
      </ThemeProvider>,
    );
  };

  it('puts the way out inside a ScrollView bounded by the slide area (iOS)', () => {
    const r = draw('ios');
    const scroll = r.UNSAFE_getByType(ScrollView);
    expect(scroll).toBeTruthy();
    // The frame the ScrollView scrolls inside: without it the ScrollView is as
    // tall as its content, never scrolls, and the flow clips the bottom.
    const frame = r.UNSAFE_getAllByType(View).find((v) => flat(v.props.style).height === SLIDE);
    expect(frame).toBeTruthy();
    expect(r.queryByText('common.backToHome')).toBeTruthy();
    // and it is a child of the scroll, not of the clipped frame.
    expect(scroll.findAllByProps({ children: 'common.backToHome' }).length).toBeGreaterThan(0);
  });

  it('keeps the Android layout scrollable too', () => {
    const r = draw('android');
    expect(r.UNSAFE_getByType(ScrollView)).toBeTruthy();
    expect(r.queryByText('common.backToHome')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Defect 5: step 6, no button on screen when it opens on an iPhone SE
// ---------------------------------------------------------------------------

describe('step 6 shows its action without scrolling', () => {
  const draw = (os: 'ios' | 'android') => {
    jest.replaceProperty(Platform, 'OS', os);
    return render(
      <ThemeProvider>
        <Step6
          containerWidth={300}
          player={null}
          accessKey={{ kind: 'can', can: '123456' } as any}
          slideAreaHeight={SLIDE}
          onNFCSuccess={jest.fn()}
          onGoBack={jest.fn()}
          {...({ isActive: true } as any)}
        />
      </ThemeProvider>,
    );
  };

  const analyseLabels = ['common.analyze', 'common.retry', 'voting.step6Scanning'];

  it('renders the analyse button outside the scroll on iOS', () => {
    const r = draw('ios');
    const scroll = r.UNSAFE_getByType(ScrollView);
    const inScroll = analyseLabels.some((l) => scroll.findAllByProps({ children: l }).length > 0);
    expect(inScroll).toBe(false);
    // It is still on screen, under the scroll, in the bounded frame.
    expect(analyseLabels.some((l) => r.queryByText(l) !== null)).toBe(true);
    const frame = r.UNSAFE_getAllByType(View).find((v) => flat(v.props.style).height === SLIDE);
    expect(frame).toBeTruthy();
  });

  // Android had been left out of this fix, and this test pinned that choice.
  // The layout lint then recorded 15 step-6 states at HIGH severity on
  // a 360 x 640 Android for the very defect the fix was about, which is the
  // measurement that settles it: the footer goes on both platforms, and the
  // slide takes the measured slide area as a box so that it has room.
  it('does the same on Android, action under the scroll in a bounded frame', () => {
    const r = draw('android');
    const scroll = r.UNSAFE_getByType(ScrollView);
    const inScroll = analyseLabels.some((l) => scroll.findAllByProps({ children: l }).length > 0);
    expect(inScroll).toBe(false);
    expect(analyseLabels.some((l) => r.queryByText(l) !== null)).toBe(true);
    expect(flat(r.UNSAFE_getAllByType(View)[0].props.style).height).toBe(SLIDE);
  });
});

// ---------------------------------------------------------------------------
// Defect 6: step 13 opens already scrolled, title off the top
// ---------------------------------------------------------------------------

describe('step 13 never opens above its own top', () => {
  it('stops centring its scroll content once the content overflows', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const r = render(
      <ThemeProvider>
        <Step12Error
          containerWidth={300}
          slideAreaHeight={SLIDE}
          errorReason={'x '.repeat(400)}
          onGoHome={jest.fn()}
          onRetry={jest.fn()}
        />
      </ThemeProvider>,
    );
    const scroll = r.UNSAFE_getByType(ScrollView);
    expect(flat(scroll.props.contentContainerStyle).justifyContent).toBe('center');

    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: SLIDE } } });
      scroll.props.onContentSizeChange(300, SLIDE + 260);
    });
    expect(flat(r.UNSAFE_getByType(ScrollView).props.contentContainerStyle).justifyContent).toBe('flex-start');

    // Content that fits keeps the centred look of the short error screens.
    act(() => {
      scroll.props.onContentSizeChange(300, SLIDE - 120);
    });
    expect(flat(r.UNSAFE_getByType(ScrollView).props.contentContainerStyle).justifyContent).toBe('center');
  });

  it('slideScrollContent only drops the centring when told the content overflows', () => {
    const centred = { justifyContent: 'center' as const, flex: 1, padding: 8 };
    expect(slideScrollContent(centred).justifyContent).toBe('center');
    expect(slideScrollContent(centred, { overflowing: false }).justifyContent).toBe('center');
    expect(slideScrollContent(centred, { overflowing: true }).justifyContent).toBe('flex-start');
    // flex is still dropped, flexGrow still added: a content container with
    // flex: 1 caps itself at the viewport and makes the overflow unreachable.
    expect(slideScrollContent(centred, { overflowing: true }).flex).toBeUndefined();
    expect(slideScrollContent(centred, { overflowing: true }).flexGrow).toBe(1);
  });
});
