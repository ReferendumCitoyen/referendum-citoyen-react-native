/**
 * The version string shown to users, in one place so every surface that
 * displays it (Settings, the home BETA badge, the launch splash, the report
 * and contact-mail headers) can never disagree.
 *
 * `version` in app.config.ts is the store version — what App Store Connect and
 * Play show — and it is the whole story: the app carries no over-the-air
 * updater (see the `updates` note in app.config.ts), so the JavaScript on a
 * phone is always the one built into that binary. Until 2.0.1 an OTA
 * generation could be appended here ("1.3.0.2"); there is no such thing now.
 */

import * as Application from 'expo-application';
import Constants from 'expo-constants';

/** e.g. "2.0.1". */
export function appVersionLabel(): string {
  return Application.nativeApplicationVersion ?? '1.0';
}

/** The native build number — the part that changes between store uploads. */
export function appBuildLabel(): string {
  return Application.nativeBuildVersion ?? '1';
}

/**
 * Short commit the running bundle was built from.
 *
 * The build number alone doesn't identify a revision: several commits can land
 * between two uploads, and an OTA re-publishes JS from whatever the tree was at
 * publish time without moving the build number at all. A tester reading this
 * off Settings names the exact source revision in their report.
 *
 * The trailing `+` means the tree had uncommitted changes when the bundle was
 * built — which matters here specifically, because EAS uploads uncommitted
 * working-tree changes, so such a build is NOT the commit it names. Best
 * effort: it is resolved from git at config-evaluation time, and where git
 * isn't reachable (EAS falls back to its own commit env var) the marker is
 * simply absent rather than wrong.
 *
 * Split from `appCommitLabel` so the formatting is testable without Constants —
 * same split `contact-info.ts` uses.
 */
export function formatCommitLabel(hash?: string | null, dirty?: boolean): string | null {
  if (!hash) return null;
  const short = hash.trim().toLowerCase().slice(0, 7);
  // Anything that isn't a hash — a git error string, a placeholder — renders as
  // nothing rather than as itself.
  if (!/^[0-9a-f]{7}$/.test(short)) return null;
  return dirty ? `${short}+` : short;
}

/** `formatCommitLabel` over what app.config.ts baked into `extra`. */
export function appCommitLabel(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { commitHash?: string; commitDirty?: boolean }
    | undefined;
  return formatCommitLabel(extra?.commitHash, extra?.commitDirty);
}
