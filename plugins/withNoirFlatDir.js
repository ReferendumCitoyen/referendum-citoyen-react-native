/**
 * Expo config plugin: declare the `flatDir` repository that resolves
 * @rarimo/rarime-rn-sdk's bundled noir.aar.
 *
 * Why this is required
 * --------------------
 * The SDK's own android/build.gradle declares its native Noir library as
 *
 *     implementation(name: 'noir', ext: 'aar')
 *
 * — a flatDir-style coordinate with no group and no version. Gradle can only
 * resolve that against a `flatDir` repository, and the SDK declares none of
 * its own: it relies on the ROOT project supplying one. Expo's generated
 * android/build.gradle ships google() / mavenCentral() / jitpack and no
 * flatDir, so without this the build dies at configuration time with
 *
 *     Could not resolve all dependencies for configuration
 *     ':rarimo-rarime-rn-sdk:debugCompileClasspath'
 *      > Could not find :noir:.
 *
 * which names the SDK subproject rather than the missing repository, and so
 * reads like a broken dependency rather than an undeclared repo.
 *
 * Why this exists when the SDK already injects the same block
 * ----------------------------------------------------------
 * It is NOT the case that this repo hand-edits the generated file. The SDK's
 * app.plugin.js is itself a withProjectBuildGradle mod that injects this exact
 * flatDir, and '@rarimo/rarime-rn-sdk' is registered in app.config.ts — so the
 * block sitting in android/build.gradle today is that plugin's output and does
 * already survive `expo prebuild --clean`. Two things still make owning it
 * here worth the duplication:
 *
 *   1. The SDK's version fails silently. If its `allprojects { repositories {`
 *      pattern ever stops matching, it console.warn()s and returns the file
 *      unchanged — one grey line during prebuild, then "Could not find :noir:."
 *      minutes later at Gradle configuration time, pointing at the wrong thing.
 *      This one throws, so prebuild stops at the cause.
 *   2. The flatDir is an implementation detail of a third-party app.plugin.js,
 *      and ours to lose. An SDK bump that drops the mod, renames android/libs,
 *      or starts publishing noir.aar under a real Maven coordinate would take
 *      our Android build with it. Declaring the repository ourselves means such
 *      a bump can only ever make this plugin redundant, never break the build.
 *
 * The two do not fight, in either order. Each guards on a string the other's
 * injection contains: the SDK's guard is the `dirs new File(rootDir, '…/libs')`
 * line, which our injected line reproduces verbatim, and ours is MARKER below,
 * which its injected block contains. Whichever mod runs first inserts, the
 * other no-ops, and exactly one flatDir lands. (@expo/config-plugins runs the
 * LAST-registered mod for a given file first, so with this plugin listed after
 * '@rarimo/rarime-rn-sdk' in app.config.ts it is ours that lands — the commented
 * one-liner below rather than the SDK's block.)
 *
 * If this ever needs updating: android/ is gitignored and fully regenerated, so
 * do not fix a resolution failure by editing android/build.gradle — that edit
 * disappears on the next prebuild. Fix the anchor here.
 *
 * Placement note: the block must land in `allprojects`, not `buildscript`. The
 * consumer is the SDK's own subproject, not the root build's classpath.
 */

const { withProjectBuildGradle } = require('@expo/config-plugins');

const LIBS_DIR = '../node_modules/@rarimo/rarime-rn-sdk/android/libs';

// Deliberately the libs path and not a "withNoirFlatDir" plugin name: this
// marker has to recognise the SDK app.plugin.js's block as well as our own, or
// running after it would inject a second, redundant flatDir.
const MARKER = 'rarime-rn-sdk/android/libs';

module.exports = function withNoirFlatDir(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `[withNoirFlatDir] expected a Groovy android/build.gradle, got ${cfg.modResults.language}`
      );
    }

    // Idempotent: prebuild can run this more than once per invocation, and the
    // SDK's own mod may have injected an equivalent block already.
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }

    const anchor = /allprojects\s*\{\s*\n(\s*)repositories\s*\{\s*\n/;
    if (!anchor.test(cfg.modResults.contents)) {
      // Fail loudly rather than silently handing Gradle a build that can't
      // resolve :noir: — that error surfaces far from its cause. This is the
      // one behaviour we have that the SDK's console.warn version does not.
      throw new Error(
        '[withNoirFlatDir] could not find the allprojects { repositories { block in ' +
          'android/build.gradle; the Expo template has changed and this plugin needs updating.'
      );
    }

    cfg.modResults.contents = cfg.modResults.contents.replace(
      anchor,
      (match, indent) =>
        `${match}${indent}  // Local AARs shipped inside @rarimo/rarime-rn-sdk (noir.aar,\n` +
        `${indent}  // swapped for the 16 KB-aligned rebuild by withAlignedNoir).\n` +
        `${indent}  // Injected by plugins/withNoirFlatDir.js.\n` +
        `${indent}  flatDir { dirs new File(rootDir, '${LIBS_DIR}') }\n`
    );

    return cfg;
  });
};
