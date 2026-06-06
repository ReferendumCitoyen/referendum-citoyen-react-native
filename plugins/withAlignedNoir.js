/**
 * Expo config plugin: replace @rarimo/rarime-rn-sdk's bundled noir.aar with a
 * 16 KB-aligned rebuild, so the register flow doesn't crash at
 * System.loadLibrary() on Android 15+ devices with 16 KB pages (Pixel 8+,
 * GrapheneOS).
 *
 * The actual swap logic lives in scripts/postinstall-aligned-noir.js and runs
 * primarily from `npm postinstall` — REQUIRED because any later `npm ci`
 * (e.g. the second job of android-release.yml) restores the SDK package
 * pristine and silently undoes a prebuild-time-only swap. This plugin
 * re-applies it at prebuild as belt-and-suspenders for flows that install
 * with --ignore-scripts. Idempotent via sha256 comparison.
 *
 * The upstream noir.aar ships a 4 KB-aligned libnoir_java.so (and a redundant
 * 4 KB-aligned libc++_shared.so). Our drop-in replacement at
 * modules/noir-16k/noir.aar is built from the same pinned source graph
 * (noir v1.0.0-beta.1 / noir_rs 30a017c), relinked with
 * -Wl,-z,max-page-size=16384, libc++_shared.so removed (RN's NDK copy wins
 * gradle's pickFirst). Every Java class is identical, so it stays
 * binary-compatible with the SDK.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const { injectAlignedNoir } = require('../scripts/postinstall-aligned-noir');

module.exports = function withAlignedNoir(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      injectAlignedNoir(cfg.modRequest.projectRoot, '[withAlignedNoir]');
      return cfg;
    },
  ]);
};
