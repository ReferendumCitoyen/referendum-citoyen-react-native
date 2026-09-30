/**
 * Replace @rarimo/rarime-rn-sdk's bundled noir.aar with the 16 KB-aligned
 * rebuild committed at modules/noir-16k/noir.aar.
 *
 * Runs from TWO places — both must stay wired:
 *
 *   1. `npm postinstall` (package.json) — the load-bearing one. Any
 *      `npm ci`/`npm install` restores the SDK package pristine, undoing a
 *      previous swap. Split CI jobs (android-release.yml: prebuild job ≠
 *      build job, each runs its own `npm ci`) ship the ORIGINAL 4 KB aar if
 *      the swap only happens at prebuild — that's exactly the regression the
 *      check-16k-alignment gate caught on the v1.0 release run.
 *
 *   2. plugins/withAlignedNoir.js (expo prebuild) — belt-and-suspenders for
 *      flows that bypass our postinstall (e.g. `npm ci --ignore-scripts`).
 *
 * Idempotent: compares sha256 and skips when already swapped, so running it
 * any number of times in any order is safe.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALIGNED_AAR_REL = 'modules/noir-16k/noir.aar';
const SDK_AAR_REL = 'node_modules/@rarimo/rarime-rn-sdk/android/libs/noir.aar';

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function injectAlignedNoir(projectRoot, logTag) {
  const tag = logTag || '[postinstall-aligned-noir]';
  const aligned = path.join(projectRoot, ALIGNED_AAR_REL);
  const sdk = path.join(projectRoot, SDK_AAR_REL);

  if (!fs.existsSync(aligned)) {
    console.warn(
      `${tag} ${ALIGNED_AAR_REL} not found — SKIPPING. The register ` +
        `flow will ship the misaligned upstream noir.aar (crashes on 16 KB-page ` +
        `devices). Build it via scripts/native-build/noir/run.sh --install.`,
    );
    return;
  }
  if (!fs.existsSync(sdk)) {
    console.warn(`${tag} SDK aar not found at ${SDK_AAR_REL} — SKIPPING (run npm ci first).`);
    return;
  }

  if (sha256(aligned) === sha256(sdk)) {
    console.log(`${tag} SDK noir.aar already 16 KB-aligned — skip.`);
    return;
  }

  fs.copyFileSync(aligned, sdk);
  console.log(
    `${tag} Replaced SDK noir.aar with the 16 KB-aligned build ` +
      `(sha256 ${sha256(sdk).slice(0, 12)}…).`,
  );
}

module.exports = { injectAlignedNoir, ALIGNED_AAR_REL, SDK_AAR_REL };

// Run directly (postinstall): npm sets cwd to the package root.
if (require.main === module) {
  injectAlignedNoir(process.cwd());
}
