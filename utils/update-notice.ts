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
 */

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
