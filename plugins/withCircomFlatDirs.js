/**
 * Expo config plugin: inject flatDir entries into android/build.gradle for the
 * three native modules that ship local AARs but aren't on Maven.
 *
 * The Rarime SDK already publishes its own withAndroidFlatDir plugin for
 * @rarimo/rarime-rn-sdk's libs/. This plugin does the same for our ported
 * Groth16 stack — without it, Gradle can't resolve `:RmoCalcs:` or
 * `:rapidsnark:` AAR references and the build fails with
 * "Could not find :RmoCalcs:".
 *
 * Why three modules:
 *   - modules/rapidsnark-wrp  — Groth16 prover bindings (libs/rapidsnark.aar)
 *   - modules/witnesscalculator — cpp witnesscalc binaries (libs/RmoCalcs.aar)
 *
 * Used by the Mainnet vote flow (Groth16 query proof). Registration uses the
 * Rarime SDK's own Noir module which has its own plugin.
 */

const { withProjectBuildGradle } = require('@expo/config-plugins');

const DIRS = [
  'modules/rapidsnark-wrp/android/libs',
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
