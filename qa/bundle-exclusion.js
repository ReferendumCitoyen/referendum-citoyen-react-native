/**
 * Which bundles keep the QA gallery, and which get a stub instead.
 *
 * Used by metro.config.js. It lives here, as a plain module with no Metro
 * import, so the rule can be tested without loading Metro itself (audit item
 * C6; qa/bundle-exclusion.test.ts).
 *
 * The gallery is already inert on the store app: app/qa-gallery.tsx and
 * app/qa-gallery-flow.tsx redirect to the home before rendering, and
 * qa/production-guard.test.tsx pins it. What the run-time guard cannot do is
 * keep the gallery and its ~1 MB of fixtures OUT of the binary, and "the QA
 * screen ships in the store app" is a true sentence. Metro has no code
 * splitting for native, so React.lazy would only defer evaluation; resolving
 * the module to a stub removes it, and everything only it imports with it.
 *
 * The condition is the release bundle of the store app and nothing else:
 * APP_FLAVOUR=production is set by every profile of this repository's
 * eas.json, and NODE_ENV=production is what `expo export:embed` sets for a
 * non-dev bundle. The beta app, a dev client, Metro in development, the QA web
 * preview and jest all get the real gallery, so the beta gallery and the
 * Maestro deep links behave exactly as before. When either variable is absent
 * the real module is kept, which is the behaviour up to 2.0.2: this rule can
 * only remove code from a bundle it is sure about.
 */

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const QA_GALLERY_MODULE = path.join(ROOT, 'qa', 'GalleryView.tsx');
const QA_GALLERY_STUB = path.join(ROOT, 'qa', 'GalleryView.excluded.tsx');

/**
 * The flavour of the checkout, exactly as app.config.ts resolves it.
 *
 * Read once at module load: this runs inside Metro's resolver, which is called
 * for every module of the bundle, so it must never spawn a process per call.
 *
 * Why it exists (audit of 23/09/2026). This file used to read APP_FLAVOUR and
 * nothing else, while app.config.ts resolves the flavour from APP_FLAVOUR OR,
 * when that is unset, from the checkout's git origin. Two sources of truth for
 * one question. The GitHub Actions workflows never set APP_FLAVOUR, so in CI
 * the config would build the store app while this rule, seeing no variable,
 * kept the real gallery in the bundle. Not armed in the beta repository, where
 * the checkout resolves to beta and the gallery belongs; it is the production
 * repository that would have shipped it.
 *
 * The obvious fix, setting APP_FLAVOUR in the workflows, was rejected:
 * app.config.ts THROWS when APP_FLAVOUR contradicts the checkout, so a wrong
 * value there breaks every release build. Reading the same source is safer.
 */
let checkoutFlavourMemo;
function checkoutFlavour() {
  if (checkoutFlavourMemo !== undefined) return checkoutFlavourMemo;
  checkoutFlavourMemo = null;
  try {
    const origin = require('node:child_process')
      .execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    if (origin.includes('referendum-citoyen-react-native')) checkoutFlavourMemo = 'production';
    else if (origin.includes('referendum-citoyen-beta')) checkoutFlavourMemo = 'beta';
  } catch {
    // No git (EAS servers, a tarball): the variable is then the only source,
    // and its absence leaves the gallery in, which is the pre-2.0.2 behaviour.
  }
  return checkoutFlavourMemo;
}

/**
 * True only for the store app's release bundle.
 *
 * NODE_ENV stays a hard condition and is what keeps jest and the dev client
 * out of this branch whatever the checkout is.
 */
function excludesQaGallery(env = process.env) {
  if (env.NODE_ENV !== 'production') return false;
  const flavour = env.APP_FLAVOUR || checkoutFlavour();
  return flavour === 'production';
}

/**
 * Given what Metro resolved, the resolution to actually use. Matched on the
 * RESOLVED path, so it does not depend on how `@/…` was spelled or on where
 * the tsconfig alias is expanded.
 */
function applyQaGalleryExclusion(resolved, platform, env = process.env) {
  if (!excludesQaGallery(env)) return resolved;
  if (platform === 'web') return resolved;
  if (!resolved || resolved.filePath !== QA_GALLERY_MODULE) return resolved;
  return { filePath: QA_GALLERY_STUB, type: 'sourceFile' };
}

module.exports = {
  ROOT,
  QA_GALLERY_MODULE,
  QA_GALLERY_STUB,
  excludesQaGallery,
  applyQaGalleryExclusion,
};
