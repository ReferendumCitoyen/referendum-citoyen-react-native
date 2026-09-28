/**
 * Item 9 client + R10: the signed index stays version 1 with an optional
 * recommended_app_versions; green dismissible banner below the recommended
 * version, red banner and voting disabled below the minimum, results still
 * readable; the unsupported-device banner wins over both.
 */
import React from 'react';
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
const mockApp = { nativeApplicationVersion: '2.0.1' as string | null };
jest.mock('expo-application', () => mockApp);

import UpdateNoticeBanner from '@/components/UpdateNoticeBanner';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { parseProposalIndex } from './proposal-index';
import { isVotingBlockedByVersion, publishedVersionsFor, resolveAppBanner } from './update-notice';
import { checkVoteEligibility, localEligibilityContext } from './vote-eligibility';
import { __resetDeviceSupportForTests, __setProbeStatusForTests, isDeviceUnsupported } from './device-support';

const index = (extra: Record<string, unknown>) =>
  parseProposalIndex({
    version: 1,
    mainnet: { active: ['73'], devOnly: [] },
    testnet: { active: [], devOnly: [] },
    ...extra,
  })!;

describe('the signed index carries the versions without a schema bump', () => {
  it('reads recommended_app_versions next to min_supported_app_versions, version 1', () => {
    const idx = index({
      min_supported_app_versions: { android: '2.0.1', ios: '2.0.1' },
      recommended_app_versions: { android: '2.0.2', ios: '2.0.2' },
    });
    expect(idx.version).toBe(1);
    expect(publishedVersionsFor(idx, 'ios', 'production')).toEqual({ min: '2.0.1', recommended: '2.0.2' });
  });

  it('a malformed version block drops the field, never the list', () => {
    const idx = index({ recommended_app_versions: { ios: 'latest', android: 3 } });
    expect(idx.mainnet.active).toEqual(['73']);
    expect(publishedVersionsFor(idx, 'ios', 'production').recommended).toBeUndefined();
  });

  it('a version 2 index is still refused (older apps would refuse it too)', () => {
    expect(parseProposalIndex({ version: 2, mainnet: { active: [], devOnly: [] }, testnet: { active: [], devOnly: [] } })).toBeNull();
  });
});

describe('resolveAppBanner', () => {
  it('recommended above, minimum below the installed version: green, dismissible', () => {
    expect(resolveAppBanner({ current: '2.0.1', min: '2.0.0', recommended: '2.0.2', dismissedRecommended: null })).toEqual({
      kind: 'recommended',
      version: '2.0.2',
    });
    expect(resolveAppBanner({ current: '2.0.1', min: '2.0.0', recommended: '2.0.2', dismissedRecommended: '2.0.2' })).toBeNull();
    // A newer recommendation reappears.
    expect(resolveAppBanner({ current: '2.0.1', recommended: '2.0.3', dismissedRecommended: '2.0.2' })).toEqual({
      kind: 'recommended',
      version: '2.0.3',
    });
  });

  it('minimum above the installed version: red, whatever was dismissed', () => {
    expect(resolveAppBanner({ current: '2.0.0', min: '2.0.1', recommended: '2.0.2', dismissedRecommended: '2.0.2' })).toEqual({
      kind: 'required',
      min: '2.0.1',
    });
  });

  it('the unsupported device wins over both', () => {
    expect(
      resolveAppBanner({ current: '2.0.0', min: '2.0.1', recommended: '2.0.2', dismissedRecommended: null, deviceUnsupported: true }),
    ).toEqual({ kind: 'unsupported' });
  });

  it('up to date, or nothing published: no banner; an unknown installed version is never blocked', () => {
    expect(resolveAppBanner({ current: '2.0.2', min: '2.0.1', recommended: '2.0.2', dismissedRecommended: null })).toBeNull();
    expect(resolveAppBanner({ current: '2.0.0', dismissedRecommended: null })).toBeNull();
    expect(resolveAppBanner({ current: null, min: '9.9.9', dismissedRecommended: null })).toBeNull();
  });
});

describe('voting is disabled below the minimum, and only then', () => {
  const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
  const p73 = {
    id: '73',
    sendVoteContractAddress: CARD,
    startTimestamp: BigInt(Math.floor(Date.now() / 1000) - 86400),
    duration: BigInt(86400 * 365),
    questions: [{}],
    criteria: {
      selector: 1n,
      citizenshipWhitelist: [],
      birthDateLowerbound: 0n,
      birthDateUpperbound: 0n,
      expirationDateLowerbound: 0n,
    },
  };

  afterEach(() => {
    mockApp.nativeApplicationVersion = '2.0.1';
  });

  it('min 2.0.1 blocks 2.0.0 and not 2.0.1', () => {
    const idx = index({ min_supported_app_versions: { android: '2.0.1', ios: '2.0.1' } });
    expect(checkVoteEligibility(p73, 'idCard', localEligibilityContext(idx, 'mainnet', false))).toEqual({ ok: true });
    mockApp.nativeApplicationVersion = '2.0.0';
    expect(isVotingBlockedByVersion(idx)).toBe(true);
    expect(checkVoteEligibility(p73, 'idCard', localEligibilityContext(idx, 'mainnet', false))).toEqual({
      ok: false,
      reason: 'app-outdated',
    });
  });

  it('a recommended version above the installed one never blocks', () => {
    const idx = index({ recommended_app_versions: { android: '9.0.0', ios: '9.0.0' } });
    expect(isVotingBlockedByVersion(idx)).toBe(false);
  });
});

describe('UpdateNoticeBanner', () => {
  const draw = (props: React.ComponentProps<typeof UpdateNoticeBanner>) =>
    render(
      <ThemeProvider>
        <UpdateNoticeBanner {...props} />
      </ThemeProvider>,
    );

  it('green: dismissible, with the update link', () => {
    const onDismiss = jest.fn();
    const onUpdate = jest.fn();
    const r = draw({ banner: { kind: 'recommended', version: '2.0.2' }, onDismiss, onUpdate });
    expect(r.getByTestId('app-banner-recommended')).toBeTruthy();
    fireEvent.press(r.getByText('✕'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('red: no dismiss button, still the update link', () => {
    const r = draw({ banner: { kind: 'required', min: '2.0.1' }, onDismiss: jest.fn(), onUpdate: jest.fn() });
    expect(r.getByTestId('app-banner-required')).toBeTruthy();
    expect(r.queryByText('✕')).toBeNull();
    expect(r.getByText(/Mettre à jour|updateButton/)).toBeTruthy();
  });

  it('unsupported: neither dismiss nor update', () => {
    const r = draw({ banner: { kind: 'unsupported' }, onDismiss: jest.fn(), onUpdate: jest.fn() });
    expect(r.queryByText('✕')).toBeNull();
    expect(r.queryByText(/Mettre à jour|updateButton/)).toBeNull();
  });
});

describe('the unsupported-device state is the prover probe', () => {
  afterEach(() => __resetDeviceSupportForTests());

  it('is off until the probe answers "missing"', () => {
    expect(isDeviceUnsupported()).toBe(false);
    act(() => __setProbeStatusForTests('ok'));
    expect(isDeviceUnsupported()).toBe(false);
    act(() => __setProbeStatusForTests('missing'));
    expect(isDeviceUnsupported()).toBe(true);
  });

  it('a "failed" probe stops step 7 but keeps the home banner off (4b)', () => {
    act(() => __setProbeStatusForTests('failed'));
    expect(isDeviceUnsupported()).toBe(false);
  });
});
