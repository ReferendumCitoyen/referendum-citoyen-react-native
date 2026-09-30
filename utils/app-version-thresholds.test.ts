/**
 * Two minimum versions instead of one (product owner, 23/09/2026).
 *
 * The published index used to carry ONE minimum against TWO version lines:
 * the store app in 2.0.x and the beta in 1.6.x. Raising it to 2.0.2 so store
 * users update would have taken the vote away from every beta tester the same
 * minute, Vote button and all. The table may now name a flavour, and a build
 * reads its own entry and no other.
 *
 * What this file pins, case by case, is the matrix the decision hangs on:
 * an old-style index, a new-style one, a beta build under the store threshold
 * but above its own, a store build under the store threshold, both under, and
 * neither.
 */
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

const STORE_ID = 'app.referendumcitoyen.fr';
const BETA_ID = 'app.referendumcitoyen.fr.beta';

const mockApp = { nativeApplicationVersion: '2.0.2' as string | null, applicationId: STORE_ID };
jest.mock('expo-application', () => mockApp);

import { parseProposalIndex, type ProposalIndex } from './proposal-index';
import { installedApp, isVotingBlockedByVersion, publishedVersionsFor, resolveAppBanner } from './update-notice';
import { checkVoteEligibility, localEligibilityContext } from './vote-eligibility';

const index = (extra: Record<string, unknown>): ProposalIndex =>
  parseProposalIndex({
    version: 1,
    mainnet: { active: ['73'], devOnly: [] },
    testnet: { active: [], devOnly: [] },
    ...extra,
  })!;

/** What the publisher writes once both lines have to be steered apart. */
const NEW_STYLE = index({
  min_supported_app_versions: {
    beta: { android: '1.6.0', ios: '1.6.0' },
    production: { android: '2.0.2', ios: '2.0.2' },
  },
  recommended_app_versions: {
    beta: { android: '1.6.1', ios: '1.6.1' },
    production: { android: '2.0.3', ios: '2.0.3' },
  },
});

/** Every index published before 23/09/2026. */
const OLD_STYLE = index({
  min_supported_app_versions: { android: '1.6.0', ios: '1.6.0' },
  recommended_app_versions: { android: '2.0.3', ios: '2.0.3' },
});

/** Put the build on one line or the other, as the binary would be. */
const asBeta = (version: string) => {
  mockApp.applicationId = BETA_ID;
  mockApp.nativeApplicationVersion = version;
};
const asStore = (version: string) => {
  mockApp.applicationId = STORE_ID;
  mockApp.nativeApplicationVersion = version;
};

afterEach(() => asStore('2.0.2'));

describe('the index still holds one value for everybody: nothing changes', () => {
  it('both flavours read the same legacy keys, on both platforms', () => {
    for (const flavour of ['beta', 'production'] as const) {
      for (const platform of ['android', 'ios'] as const) {
        expect(publishedVersionsFor(OLD_STYLE, platform, flavour)).toEqual({
          min: '1.6.0',
          recommended: '2.0.3',
        });
      }
    }
  });

  it('an index with no version block at all thresholds nobody', () => {
    const bare = index({});
    expect(publishedVersionsFor(bare, 'ios', 'beta')).toEqual({ min: undefined, recommended: undefined });
    expect(publishedVersionsFor(bare, 'ios', 'production')).toEqual({ min: undefined, recommended: undefined });
    asBeta('1.6.0');
    expect(isVotingBlockedByVersion(bare)).toBe(false);
  });

  it('the schema stays version 1, so an older app still loads the list', () => {
    expect(NEW_STYLE.version).toBe(1);
    expect(OLD_STYLE.version).toBe(1);
    expect(NEW_STYLE.mainnet.active).toEqual(['73']);
  });
});

describe('the index names a flavour: each build reads its own line', () => {
  it('resolves the entry of the flavour asked for, and no other', () => {
    expect(publishedVersionsFor(NEW_STYLE, 'ios', 'beta')).toEqual({ min: '1.6.0', recommended: '1.6.1' });
    expect(publishedVersionsFor(NEW_STYLE, 'ios', 'production')).toEqual({ min: '2.0.2', recommended: '2.0.3' });
  });

  it('a named table hides its own legacy keys, so nothing leaks across lines', () => {
    // The publisher left 2.0.2 at the top AND named the flavours. The beta
    // must read 1.6.0, never the 2.0.2 sitting next to it.
    const mixed = index({
      min_supported_app_versions: {
        android: '2.0.2',
        ios: '2.0.2',
        beta: { android: '1.6.0', ios: '1.6.0' },
        production: { android: '2.0.2', ios: '2.0.2' },
      },
    });
    expect(publishedVersionsFor(mixed, 'ios', 'beta').min).toBe('1.6.0');
    expect(publishedVersionsFor(mixed, 'ios', 'production').min).toBe('2.0.2');
  });

  it('a half-filled table leaves the unnamed flavour unthresholded, never blocked', () => {
    // Only production named, and the legacy keys say 2.0.2. A beta build must
    // come out with no threshold at all rather than inherit the store one.
    const halfFilled = index({
      min_supported_app_versions: { android: '2.0.2', ios: '2.0.2', production: { android: '2.0.2', ios: '2.0.2' } },
    });
    expect(publishedVersionsFor(halfFilled, 'ios', 'beta').min).toBeUndefined();
    asBeta('1.6.0');
    expect(isVotingBlockedByVersion(halfFilled)).toBe(false);
  });

  it('a malformed flavour entry drops that flavour, never the list', () => {
    const idx = index({
      min_supported_app_versions: { beta: { ios: 'latest', android: 7 }, production: { android: '2.0.2', ios: '2.0.2' } },
    });
    expect(idx.mainnet.active).toEqual(['73']);
    expect(publishedVersionsFor(idx, 'ios', 'beta').min).toBeUndefined();
    expect(publishedVersionsFor(idx, 'ios', 'production').min).toBe('2.0.2');
  });
});

describe('the build reads its own flavour from the binary, not from a setting', () => {
  it('a .beta bundle id is the beta line, anything else the store line', () => {
    // The platform comes from the runner, not from the decision under test.
    asBeta('1.6.0');
    expect(installedApp()).toMatchObject({ current: '1.6.0', flavour: 'beta' });
    asStore('2.0.2');
    expect(installedApp()).toMatchObject({ current: '2.0.2', flavour: 'production' });
    // Nothing but a bundle id ending in .beta reads as the beta line.
    mockApp.applicationId = 'app.referendumcitoyen.fr.beta.of.someone.else';
    expect(installedApp().flavour).toBe('production');
  });
});

describe('the matrix asked for: store threshold 2.0.2, beta threshold 1.6.0', () => {
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
  const canVote = (idx: ProposalIndex) =>
    checkVoteEligibility(p73, 'idCard', localEligibilityContext(idx, 'mainnet', false)).ok;

  it('beta 1.6.0, under the store threshold but at its own: VOTES', () => {
    asBeta('1.6.0');
    expect(isVotingBlockedByVersion(NEW_STYLE)).toBe(false);
    expect(canVote(NEW_STYLE)).toBe(true);
    // ... and this is exactly what the old single value could not do.
    const singleValue = index({ min_supported_app_versions: { android: '2.0.2', ios: '2.0.2' } });
    expect(isVotingBlockedByVersion(singleValue)).toBe(true);
  });

  it('store 2.0.1, under the store threshold: BLOCKED, red banner', () => {
    asStore('2.0.1');
    expect(isVotingBlockedByVersion(NEW_STYLE)).toBe(true);
    expect(canVote(NEW_STYLE)).toBe(false);
    const app = installedApp();
    const { min, recommended } = publishedVersionsFor(NEW_STYLE, app.platform, app.flavour);
    expect(resolveAppBanner({ current: app.current, min, recommended, dismissedRecommended: null })).toEqual({
      kind: 'required',
      min: '2.0.2',
    });
  });

  it('both under their own threshold: both BLOCKED', () => {
    asBeta('1.5.0');
    expect(isVotingBlockedByVersion(NEW_STYLE)).toBe(true);
    expect(canVote(NEW_STYLE)).toBe(false);
    asStore('2.0.1');
    expect(isVotingBlockedByVersion(NEW_STYLE)).toBe(true);
    expect(canVote(NEW_STYLE)).toBe(false);
  });

  it('neither under: both VOTE, and each sees its own green banner', () => {
    asBeta('1.6.0');
    expect(isVotingBlockedByVersion(NEW_STYLE)).toBe(false);
    expect(canVote(NEW_STYLE)).toBe(true);
    let app = installedApp();
    let v = publishedVersionsFor(NEW_STYLE, app.platform, app.flavour);
    expect(resolveAppBanner({ current: app.current, ...v, dismissedRecommended: null })).toEqual({
      kind: 'recommended',
      version: '1.6.1',
    });

    asStore('2.0.2');
    expect(isVotingBlockedByVersion(NEW_STYLE)).toBe(false);
    expect(canVote(NEW_STYLE)).toBe(true);
    app = installedApp();
    v = publishedVersionsFor(NEW_STYLE, app.platform, app.flavour);
    expect(resolveAppBanner({ current: app.current, ...v, dismissedRecommended: null })).toEqual({
      kind: 'recommended',
      version: '2.0.3',
    });
  });

  it('the unsupported phone still wins over the red banner of either line', () => {
    asBeta('1.5.0');
    const app = installedApp();
    const v = publishedVersionsFor(NEW_STYLE, app.platform, app.flavour);
    expect(
      resolveAppBanner({ current: app.current, ...v, dismissedRecommended: null, deviceUnsupported: true }),
    ).toEqual({ kind: 'unsupported' });
  });
});
