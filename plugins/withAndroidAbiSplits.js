/**
 * Expo config plugin: restrict the Android build to arm64-v8a and emit
 * per-ABI APK splits (no universal APK).
 *
 * Why:
 *   The Rarimo prebuilts our app depends on for vote + register
 *   (libnoir_java.so, libwitnesscalc_queryIdentity.so) ship only as
 *   arm64-v8a. Without an abiFilter the default `assembleRelease` builds
 *   a universal APK (~290 MB) containing armv7 / x86 / x86_64 binaries
 *   that look complete (Hermes / Expo / RN libs all ship multi-ABI) but
 *   crash at System.loadLibrary() time when the user reaches Step 7 or
 *   Step 11. With this filter, only arm64-v8a is built; non-arm64
 *   devices can't install instead of installing-then-crashing.
 *
 * APK splits:
 *   The Play Store path is AAB (Android App Bundle); Play splits per
 *   ABI server-side. For the direct-download path (referendumcitoyen.fr
 *   APK) we still want a single arm64-v8a APK rather than a universal,
 *   so consumers download ~80 MB instead of ~290 MB. `universalApk
 *   false` suppresses the legacy universal output entirely.
 *
 * Per-ABI versionCode shift:
 *   Convention is `baseVersionCode + N * abiOffset` so per-architecture
 *   APKs sort correctly in Play. We only ship arm64-v8a so a single
 *   offset is enough — kept here for future multi-ABI builds.
 *
 * Idempotent under `expo prebuild --clean`: re-injection checks for the
 * marker comment and skips if already present.
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

const NDK_MARKER = '// withAndroidAbiSplits: ndk';

const NDK_BLOCK = `        ${NDK_MARKER}
        ndk {
            abiFilters 'arm64-v8a'
        }
`;

function inject(buildGradle) {
  if (buildGradle.includes(NDK_MARKER)) {
    return buildGradle;
  }
  // \`ndk { abiFilters 'arm64-v8a' }\` belongs INSIDE \`defaultConfig\`.
  // Targeting a single ABI here is enough on its own — Gradle builds
  // one APK containing only those native libs. A separate
  // \`splits.abi { include 'arm64-v8a' }\` would conflict with this
  // (\`Conflicting configuration : 'arm64-v8a' in ndk abiFilters cannot
  // be present when splits abi filters are set\`). Splits only add
  // value when emitting MULTIPLE per-ABI APKs from one build; we ship
  // arm64-v8a only.
  const pattern = /(defaultConfig\s*\{\s*\n)/;
  if (!buildGradle.match(pattern)) {
    console.warn(
      '[withAndroidAbiSplits] Could not find "defaultConfig {" — skipping.',
    );
    return buildGradle;
  }
  return buildGradle.replace(pattern, (m) => `${m}${NDK_BLOCK}`);
}

module.exports = function withAndroidAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      cfg.modResults.contents = inject(cfg.modResults.contents);
    }
    return cfg;
  });
};
