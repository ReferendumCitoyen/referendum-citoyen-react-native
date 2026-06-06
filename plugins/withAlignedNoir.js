/**
 * Expo config plugin: replace @rarimo/rarime-rn-sdk's bundled noir.aar with a
 * 16 KB-aligned rebuild, so the register flow doesn't crash at
 * System.loadLibrary() on Android 15+ devices with 16 KB pages (Pixel 8+,
 * GrapheneOS).
 *
 * The upstream noir.aar ships a 4 KB-aligned libnoir_java.so (and a redundant
 * 4 KB-aligned libc++_shared.so). Our drop-in replacement at
 *
 *     modules/noir-16k/noir.aar
 *
 * is built reproducibly by scripts/native-build/noir (see
 * scripts/native-build/README.md): same pinned source graph, libnoir_java.so
 * relinked with -Wl,-z,max-page-size=16384, libc++_shared.so removed (RN's NDK
 * copy wins gradle's pickFirst). Every Java class is identical, so it stays
 * binary-compatible with the SDK.
 *
 * At prebuild this copies our aar over the SDK's in node_modules (which the
 * SDK's own flatDir gradle plugin then packages). Idempotent: compares sha256
 * and skips if already replaced.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALIGNED_AAR_REL = 'modules/noir-16k/noir.aar';
const SDK_AAR_REL = 'node_modules/@rarimo/rarime-rn-sdk/android/libs/noir.aar';

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function injectAlignedNoir(projectRoot) {
  const aligned = path.join(projectRoot, ALIGNED_AAR_REL);
  const sdk = path.join(projectRoot, SDK_AAR_REL);

  if (!fs.existsSync(aligned)) {
    console.warn(
      `[withAlignedNoir] ${ALIGNED_AAR_REL} not found — SKIPPING. The register ` +
        `flow will ship the misaligned upstream noir.aar (crashes on 16 KB-page ` +
        `devices). Build it via scripts/native-build/noir/run.sh --install.`,
    );
    return;
  }
  if (!fs.existsSync(sdk)) {
    console.warn(
      `[withAlignedNoir] SDK aar not found at ${SDK_AAR_REL} — SKIPPING ` +
        `(run npm ci first).`,
    );
    return;
  }

  if (sha256(aligned) === sha256(sdk)) {
    console.log('[withAlignedNoir] SDK noir.aar already 16 KB-aligned — skip.');
    return;
  }

  fs.copyFileSync(aligned, sdk);
  console.log(
    `[withAlignedNoir] Replaced SDK noir.aar with the 16 KB-aligned build ` +
      `(sha256 ${sha256(sdk).slice(0, 12)}…).`,
  );
}

module.exports = function withAlignedNoir(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      injectAlignedNoir(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};
