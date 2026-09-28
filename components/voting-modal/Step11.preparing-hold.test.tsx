/**
 * QA iPhone 2.0.2, item 1: `flow-step11-preparing` failed on the three iPhone
 * combinations ("No visible element found: Préparation...") and passed on the
 * four Android ones.
 *
 * Cause: the state is transient. Step 11 shows "Préparation..." while it waits
 * for the SDK refs and, 15 s later, the missing-data timeout replaces the text
 * with "Erreur : scannez d'abord votre carte d'identité" and leaves for step
 * 13. The iPhone run took 45 s to reach the assertion (deep link, sheet
 * animation, a looping Lottie that waitForAnimationToEnd waits out, XCTest
 * view hierarchy), so it screenshotted the failure every time; the faster
 * Android run caught the waiting line.
 *
 * The fix gives that timeout an injectable delay, which the QA gallery raises
 * so the state it publishes is the state on screen. Production keeps the 15 s.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

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
jest.mock('lottie-react-native', () => 'LottieView');
// The installed version the eligibility rule compares with the index minimum.
jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.1', applicationId: 'app.referendumcitoyen.fr' }));
jest.mock('@/utils/circuit-preload', () => ({ ensureCircuitsReady: async () => undefined }));
jest.mock('@/utils/mainnet-vote-flow', () => ({}));
jest.mock('@/utils/identity', () => ({ getOrCreatePrivateKey: async () => '01'.repeat(32) }));
jest.mock('@/constants/mock-backend', () => ({
  isMockBackend: () => false,
  mockDelay: async () => undefined,
  mockTxHash: () => '0x0',
}));
jest.mock('@/utils/vote-confirmation', () => ({ waitForVoteReceipt: async () => 'success' }));
jest.mock('@/utils/logger', () => ({ registerPublicAddress: () => undefined, purgeVoteTrace: async () => undefined }));

import { act } from '@testing-library/react-native';
import Step11, { STEP11_MISSING_DATA_TIMEOUT_MS } from './Step11';
import { ThemeProvider } from '@/contexts/ThemeContext';

const draw = (props: Record<string, unknown>) =>
  render(
    <ThemeProvider>
      <Step11 containerWidth={300} slideAreaHeight={482} isActive {...props} />
    </ThemeProvider>,
  );

const settle = async () => {
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

describe('step 11 waiting state', () => {
  it('shows the preparing line as soon as the step becomes active', () => {
    const r = draw({});
    expect(r.queryByText('voting.step11Preparing')).toBeTruthy();
  });

  it('lets the 15 s timeout replace it (production default)', async () => {
    const r = draw({});
    await act(async () => { jest.advanceTimersByTime(STEP11_MISSING_DATA_TIMEOUT_MS + 100); });
    await settle();
    expect(r.queryByText('voting.step11Preparing')).toBeNull();
  });

  it('holds it for as long as the caller asks (what the QA gallery passes)', async () => {
    const r = draw({ missingDataTimeoutMs: 600_000 });
    await act(async () => { jest.advanceTimersByTime(60_000); });
    await settle();
    expect(r.queryByText('voting.step11Preparing')).toBeTruthy();
  });
});
