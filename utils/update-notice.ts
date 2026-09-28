/**
 * "Please update the app" notice, driven by the signed proposal index.
 *
 * The published proposals.json (GitHub Pages, Ed25519-signed — see
 * utils/proposal-index.ts) carries an optional
 * `min_supported_app_versions: { android, ios }` block. On startup the home
 * screen compares the native app version against the platform's minimum and
 * shows a dismissible banner when the install is older. Piggybacking on the
 * proposal-index fetch means zero additional network calls.
 *
 * Dismissal is per-minimum-version: dismissing "1.2.4" hides the banner
 * until the published minimum moves past 1.2.4, at which point it reappears.
 *
 * Since 23/09/2026 that block may carry one entry per flavour instead of one
 * for everybody, because the beta and the store app run on two version lines
 * (see AppVersionTable in utils/proposal-index.ts, and fromTable below).
 */
import { isBetaBuild } from '@/constants/app-flavour';
import type { AppVersionTable } from './proposal-index';

/** Numeric dotted-version compare. Missing segments count as 0 (error
 * reports show 4-segment versions like "1.2.1.0"), non-numeric segments
 * count as 0 — lenient by design, never throws on server-supplied input. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((s) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function shouldShowUpdateNotice(args: {
  /** Native app version (Application.nativeApplicationVersion). */
  current: string;
  /** Published minimum for this platform; undefined/empty → no notice. */
  min: string | undefined;
  /** The minimum version the user last dismissed, or null. */
  dismissedMin: string | null;
}): boolean {
  const { current, min, dismissedMin } = args;
  if (!min) return false;
  if (compareVersions(current, min) >= 0) return false;
  if (dismissedMin && compareVersions(dismissedMin, min) >= 0) return false;
  return true;
}

/** AsyncStorage key holding the minimum version the user dismissed. */
export const UPDATE_NOTICE_DISMISSED_KEY = 'update_notice_dismissed_min';

// ---------------------------------------------------------------------------
// Item 9 + R10 (21/09 team decision): two banners from the signed index, no
// automatic update and no request to the stores.
//   - green, dismissible: installed < recommended_app_versions ("Une nouvelle
//     version est disponible", Update button = the store page, opened only on
//     a tap);
//   - red, not dismissible, voting disabled: installed < min_supported_app_versions
//     ("Mettez à jour l'application pour voter"); results stay readable.
// The unsupported-phone banner (32-bit phones, item 4b: the prover probe of
// utils/device-support.ts answered "missing") wins over both: telling a phone
// that can never prove to update would prompt it forever.
// ---------------------------------------------------------------------------

export type AppPlatform = 'ios' | 'android';

/** Which of the two apps this binary is: the store app or the beta. They run
 * on two version lines, 2.0.x and 1.6.x, which is why a published threshold
 * has to be able to name one (constants/app-flavour.ts). */
export type AppFlavour = 'beta' | 'production';

export type AppBanner =
  | { kind: 'unsupported' }
  | { kind: 'required'; min: string }
  | { kind: 'recommended'; version: string }
  | null;

/** AsyncStorage key holding the recommended version the user dismissed. */
export const RECOMMENDED_NOTICE_DISMISSED_KEY = 'update_notice_dismissed_recommended';

/** Store pages of the store app, opened on a tap only. */
export const STORE_URLS: Readonly<Record<AppPlatform, string>> = {
  // TODO(DECISION-D8): App Store id to confirm with the product owner and the
  // operations lead.
  ios: 'https://apps.apple.com/app/id6777138213',
  android: 'https://play.google.com/store/apps/details?id=fr.referendumcitoyen.app',
};

/** Below the published minimum. An unknown installed version is never
 * blocked: a missing native value must not disable voting. */
export function isBelowMinimum(current: string | null | undefined, min: string | undefined): boolean {
  if (!current || !min) return false;
  return compareVersions(current, min) < 0;
}

export function resolveAppBanner(args: {
  current: string | null | undefined;
  min?: string;
  recommended?: string;
  /** The recommended version the user last dismissed, or null. */
  dismissedRecommended: string | null;
  /** From the device-capability probe (item 4b); false when absent. */
  deviceUnsupported?: boolean;
}): AppBanner {
  if (args.deviceUnsupported) return { kind: 'unsupported' };
  if (isBelowMinimum(args.current, args.min)) return { kind: 'required', min: args.min! };
  const { current, recommended, dismissedRecommended } = args;
  if (!current || !recommended) return null;
  if (compareVersions(current, recommended) >= 0) return null;
  if (dismissedRecommended && compareVersions(dismissedRecommended, recommended) >= 0) return null;
  return { kind: 'recommended', version: recommended };
}

/**
 * The published version that applies to ONE build, out of a table that may
 * hold one line or two.
 *
 * The same code ships as two apps on two version lines: the store app in
 * 2.0.x and the beta in 1.6.x. A single published minimum cannot serve both.
 * Raising it to 2.0.2 so store users update would, the same minute, take the
 * vote away from every beta tester, because 1.6.0 is below 2.0.2. So the
 * table may name a flavour, and a build reads its own entry and no other.
 *
 * Resolution, in order:
 *   1. the entry for this build's flavour, when the table names any flavour;
 *   2. otherwise the legacy per-platform keys, which is every index published
 *      before 23/09/2026 and behaves exactly as it did.
 *
 * A table that names the OTHER flavour only returns nothing for this one, so
 * this build has no threshold and is never blocked. That asymmetry is
 * deliberate: a half-filled table must fail towards "nobody is blocked".
 */
function fromTable(
  table: AppVersionTable | null | undefined,
  platform: AppPlatform,
  flavour: AppFlavour,
): string | undefined {
  if (!table) return undefined;
  const named = table.beta !== undefined || table.production !== undefined;
  if (named) return table[flavour]?.[platform];
  return table[platform];
}

/** The two published versions for this platform and this flavour. */
export function publishedVersionsFor(
  index: {
    min_supported_app_versions?: AppVersionTable;
    recommended_app_versions?: AppVersionTable;
  } | null | undefined,
  platform: AppPlatform,
  flavour: AppFlavour,
): { min?: string; recommended?: string } {
  return {
    min: fromTable(index?.min_supported_app_versions, platform, flavour),
    recommended: fromTable(index?.recommended_app_versions, platform, flavour),
  };
}

/** The installed native version, platform and flavour, read lazily so this
 * module stays importable in tests and scripts. */
export function installedApp(): { current: string | null; platform: AppPlatform; flavour: AppFlavour } {
  let current: string | null = null;
  let platform: AppPlatform = 'android';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    current = require('expo-application').nativeApplicationVersion ?? null;
  } catch {
    current = null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    platform = require('react-native').Platform.OS === 'ios' ? 'ios' : 'android';
  } catch {
    platform = 'android';
  }
  return { current, platform, flavour: isBetaBuild() ? 'beta' : 'production' };
}

/** Voting is disabled on this install by the signed index's minimum. */
export function isVotingBlockedByVersion(
  index: Parameters<typeof publishedVersionsFor>[0],
  app: { current: string | null; platform: AppPlatform; flavour: AppFlavour } = installedApp(),
): boolean {
  return isBelowMinimum(app.current, publishedVersionsFor(index, app.platform, app.flavour).min);
}
