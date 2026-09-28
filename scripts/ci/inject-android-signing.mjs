#!/usr/bin/env node
/**
 * Idempotently inject a release signing config into `android/app/build.gradle`
 * after `expo prebuild`. The `android/` directory is gitignored and
 * regenerated on every CI run, so we can't ship a one-time build.gradle
 * edit — it has to be re-applied each build.
 *
 * Credentials are read from env vars at gradle runtime (not bake-time), so
 * the secrets never land in the patched file:
 *   REFCIT_RELEASE_STORE_FILE      absolute path to the .keystore
 *   REFCIT_RELEASE_STORE_PASSWORD  keystore password
 *   REFCIT_RELEASE_KEY_ALIAS       key alias inside the keystore
 *   REFCIT_RELEASE_KEY_PASSWORD    key password
 *
 * If `REFCIT_RELEASE_STORE_FILE` is unset at build time, gradle falls back
 * to the unmodified debug signing config — so accidentally running this
 * script locally won't break debug builds.
 *
 * See `.github/workflows/android-release.yml` for the CI flow that wires
 * the secrets into the env.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const buildGradlePath = join(process.cwd(), 'android', 'app', 'build.gradle');
let gradle = readFileSync(buildGradlePath, 'utf8');

const SENTINEL = '// >>> CI release signing config injected';
if (gradle.includes(SENTINEL)) {
  console.log('[inject-android-signing] already injected, skipping');
  process.exit(0);
}

// 1. Append a `release { ... }` block inside `signingConfigs { }`.
//    Expo's prebuild template emits a `signingConfigs { debug { ... } }`
//    block; we locate the closing brace of that block and inject before it.
const signingConfigsRx =
  /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\}\s*)(\})/;
if (!signingConfigsRx.test(gradle)) {
  console.error(
    '[inject-android-signing] could not locate signingConfigs.debug block. ' +
    'Expo prebuild output may have changed — update this patcher.',
  );
  process.exit(1);
}
const releaseSigningBlock = `
        ${SENTINEL}
        release {
            def storeFileEnv = System.getenv('REFCIT_RELEASE_STORE_FILE')
            if (storeFileEnv) {
                storeFile file(storeFileEnv)
                storePassword System.getenv('REFCIT_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv('REFCIT_RELEASE_KEY_ALIAS')
                keyPassword System.getenv('REFCIT_RELEASE_KEY_PASSWORD')
            }
            // v1 (JAR signing) is for pre-Android-7 only; our minSdkVersion
            // is 27 (Android 8.1+) so we skip it. v2 + v3 give modern
            // install-time integrity and unlock APK Signing Key Rotation.
            enableV1Signing false
            enableV2Signing true
            enableV3Signing true
        }
    `;
gradle = gradle.replace(signingConfigsRx, `$1${releaseSigningBlock}$2`);

// 2. Switch buildTypes.release.signingConfig from `.debug` to `.release`.
//    Expo's template hard-codes `signingConfig signingConfigs.debug` in the
//    release block (with a // Caution! comment above). Match conservatively
//    so a future template tweak fails loud instead of silently no-op'ing.
const releaseSwapRx =
  /(buildTypes\s*\{[\s\S]*?release\s*\{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig\s+signingConfigs\.debug/;
if (!releaseSwapRx.test(gradle)) {
  console.error(
    '[inject-android-signing] could not locate buildTypes.release.signingConfig in build.gradle',
  );
  process.exit(1);
}
gradle = gradle.replace(
  releaseSwapRx,
  '$1signingConfig signingConfigs.release',
);

writeFileSync(buildGradlePath, gradle);
console.log('[inject-android-signing] patched android/app/build.gradle');
