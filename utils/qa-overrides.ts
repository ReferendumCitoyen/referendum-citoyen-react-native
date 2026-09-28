/**
 * Test seams for the QA gallery (app/qa-gallery.tsx), and nothing else.
 *
 * The gallery shows every error screen of the vote flow without a chip, a
 * chain or a network. Most screens take their state as props; the chip read
 * (Step 6) does not: its messages come from what the native scan throws. This
 * module lets the gallery stand in for the NATIVE call only, so the whole
 * JavaScript path after it (the French rewrite in modules/e-document/index.ts,
 * the classification in utils/e-document/scan-error.ts, Step 6's screens) runs
 * exactly as on a real failed read.
 *
 * Inert in production: an override can only be installed when the build is a
 * dev build or the beta app (`__DEV__ || isBetaBuild()`), and it is read back
 * under the same condition. The store app never has one, whatever calls this.
 */
import { isBetaBuild } from '@/constants/app-flavour';

/** Stands in for EDocumentModule.scanDocument: resolves with the native JSON
 *  string, or rejects with an error shaped like the native one. */
export type NativeScanOverride = (documentType: 'P' | 'I') => Promise<string>;

let nativeScan: NativeScanOverride | null = null;

/** Dev build or beta app: the only builds where the QA gallery exists. */
export function qaAllowed(): boolean {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__ === true;
  return dev || isBetaBuild();
}

/** Installs (or, with null, removes) the native scan stand-in. Ignored outside
 *  dev and beta builds. Returns whether it was installed. */
export function setQaNativeScanOverride(fn: NativeScanOverride | null): boolean {
  if (fn === null) {
    nativeScan = null;
    return true;
  }
  if (!qaAllowed()) return false;
  nativeScan = fn;
  return true;
}

/** The installed stand-in, or null. Always null outside dev and beta builds. */
export function qaNativeScanOverride(): NativeScanOverride | null {
  if (!nativeScan) return null;
  return qaAllowed() ? nativeScan : null;
}
