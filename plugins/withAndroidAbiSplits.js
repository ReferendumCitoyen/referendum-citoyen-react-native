/**
 * Expo config plugin: restrict the Android build to arm64-v8a.
 *
 * Why:
 *   The Rarimo prebuilts our app depends on for vote + register
 *   (libnoir_java.so, libwitnesscalc_queryIdentity.so) ship only as
 *   arm64-v8a. Without a filter the build packages armv7 / x86 / x86_64
 *   binaries that look complete (Hermes / Expo / RN libs all ship
 *   multi-ABI) but crash at System.loadLibrary() time when the user
 *   reaches Step 7 or Step 11. With the filter, only arm64-v8a is built;
 *   non-arm64 devices can't install instead of installing-then-crashing.
 *
 * Two knobs, and BOTH are needed (2026-09-24, the 32 bit crash on Galaxy A):
 *
 *   1. `ndk { abiFilters 'arm64-v8a' }` inside `defaultConfig` of
 *      app/build.gradle. On its own it is NOT enough: the React Native
 *      Gradle plugin (NdkConfiguratorUtils.kt) does
 *      `defaultConfig.ndk.abiFilters.addAll(reactNativeArchitectures)`,
 *      an addition to the set, not a replacement. The Expo template's
 *      gradle.properties sets `reactNativeArchitectures` to all four
 *      ABIs, so the effective filter was the union, all four ABIs, and
 *      the AAB shipped an armeabi-v7a split without libnoir_java.so.
 *      Verified on the EAS build of 55f1d54 (beta, versionCode 5): lib/ has
 *      four ABI folders.
 *
 *   2. `reactNativeArchitectures=arm64-v8a` in gradle.properties. This is
 *      the value the RN plugin adds, so the union collapses to arm64-v8a.
 *      It also restricts the RN / Hermes native build to that ABI.
 *
 *   Keeping both means the outcome does not depend on which one a future
 *   template or plugin version happens to honour.
 *
 * Not used, on purpose: `splits.abi`. It conflicts with abiFilters
 * (`Conflicting configuration : 'arm64-v8a' in ndk abiFilters cannot be
 * present when splits abi filters are set`) and only adds value when
 * emitting MULTIPLE per-ABI APKs; we ship arm64-v8a only. Also not used:
 * `packagingOptions { exclude }`, which leaves a 32 bit Hermes in the
 * package so the app installs and then crashes.
 *
 * Idempotent under `expo prebuild --clean`: the build.gradle injection
 * checks for the marker comment, the property is set by key.
 */

const {
  withAppBuildGradle,
  withGradleProperties,
} = require('@expo/config-plugins');

const ABI = 'arm64-v8a';
const NDK_MARKER = '// withAndroidAbiSplits: ndk';
const ARCH_PROPERTY = 'reactNativeArchitectures';

const NDK_BLOCK = `        ${NDK_MARKER}
        ndk {
            abiFilters '${ABI}'
        }
`;

function inject(buildGradle) {
  if (buildGradle.includes(NDK_MARKER)) {
    return buildGradle;
  }
  const pattern = /(defaultConfig\s*\{\s*\n)/;
  if (!buildGradle.match(pattern)) {
    console.warn(
      '[withAndroidAbiSplits] Could not find "defaultConfig {" — skipping.',
    );
    return buildGradle;
  }
  return buildGradle.replace(pattern, (m) => `${m}${NDK_BLOCK}`);
}

// gradle.properties as parsed by @expo/config-plugins: a list of
// { type: 'property', key, value } / { type: 'comment' } / { type: 'empty' }
// items. Replace the template's value in place (keeps its comment above),
// append if the template ever drops the key.
function setArchitectures(properties) {
  const item = properties.find(
    (p) => p.type === 'property' && p.key === ARCH_PROPERTY,
  );
  if (item) {
    item.value = ABI;
    return properties;
  }
  return [
    ...properties,
    { type: 'empty' },
    {
      type: 'comment',
      value: 'withAndroidAbiSplits: the only ABI our native prebuilts exist for',
    },
    { type: 'property', key: ARCH_PROPERTY, value: ABI },
  ];
}

function withAndroidAbiSplits(config) {
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      cfg.modResults.contents = inject(cfg.modResults.contents);
    }
    return cfg;
  });
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = setArchitectures(cfg.modResults);
    return cfg;
  });
  return config;
}

module.exports = withAndroidAbiSplits;
module.exports.inject = inject;
module.exports.setArchitectures = setArchitectures;
module.exports.ABI = ABI;
module.exports.ARCH_PROPERTY = ARCH_PROPERTY;
