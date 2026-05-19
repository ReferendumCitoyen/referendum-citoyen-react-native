/**
 * Expo config plugin: inject a flatDir entry into android/build.gradle for
 * the witnesscalculator module's local AAR (RmoCalcs.aar), which isn't
 * published to Maven.
 *
 * The Rarime SDK already publishes its own withAndroidFlatDir plugin for
 * @rarimo/rarime-rn-sdk's libs/. This plugin does the same for the cpp
 * witnesscalc binaries we ship locally — without it, Gradle can't resolve
 * `:RmoCalcs:` and the build fails with "Could not find :RmoCalcs:".
 *
 * Used by the Mainnet vote flow (Groth16 query proof). Registration uses
 * the Rarime SDK's own Noir module which has its own plugin.
 *
 * Note: rapidsnark-wrp previously also needed a flatDir here, but its
 * module build.gradle now pulls `io.iden3:rapidsnark` from Maven Central —
 * the old `modules/rapidsnark-wrp/android/libs/` entry was dropped to
 * silence a flatDir warning.
 */

const { withProjectBuildGradle } = require('@expo/config-plugins');

const DIRS = [
  'modules/witnesscalculator/android/libs',
];

function addFlatDirs(buildGradle) {
  const flatDirBlock = DIRS.map(
    (rel) => `  flatDir { dirs new File(rootDir, '../${rel}') }`,
  ).join('\n');

  // Skip if already injected (idempotent for prebuild --clean).
  if (buildGradle.includes(`'../${DIRS[0]}'`)) {
    return buildGradle;
  }

  const pattern = /allprojects\s*\{[\s\S]*?repositories\s*\{/;
  if (!buildGradle.match(pattern)) {
    console.warn(
      '[withCircomFlatDirs] Could not find "allprojects { repositories {" in android/build.gradle — skipping.',
    );
    return buildGradle;
  }

  return buildGradle.replace(pattern, (match) => `${match}\n${flatDirBlock}`);
}

module.exports = (config) =>
  withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = addFlatDirs(config.modResults.contents);
    }
    return config;
  });
