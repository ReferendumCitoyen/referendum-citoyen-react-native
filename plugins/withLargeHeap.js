/**
 * Expo config plugin: set `android:largeHeap="true"` on the <application/>
 * element of the regenerated AndroidManifest.xml.
 *
 * Why this is required (not optional):
 *   The Mainnet TD3 (passport) vote flow runs a native Groth16 witness
 *   calculator (modules/witnesscalculator, called from Step 11 via
 *   utils/groth16-vote.ts). The query_identity circuit's witness calc
 *   allocates a single ~100 MB buffer. Android's default per-app Dalvik
 *   heap is 256 MB on most devices; with React Native + Hermes + the
 *   Rarime modules already resident, the free headroom at vote time is
 *   ~70 MB, so the 100 MB allocation fails with
 *
 *     java.lang.OutOfMemoryError: Failed to allocate a 104857616 byte
 *     allocation with 73744544 free bytes and 70MB until OOM
 *
 *   `android:largeHeap="true"` lifts the cap (typically to 512 MB+,
 *   device-dependent) and the allocation succeeds.
 *
 * Without this plugin a direct edit to android/app/src/main/AndroidManifest.xml
 * works for the current dev APK but is wiped on the next `expo prebuild
 * --clean` (the android/ folder is gitignored and regenerated). This plugin
 * makes the attribute survive every prebuild.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('[withLargeHeap] AndroidManifest has no <application/> element');
    }
    application.$ = application.$ || {};
    application.$['android:largeHeap'] = 'true';
    return cfg;
  });
};
