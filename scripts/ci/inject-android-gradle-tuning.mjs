#!/usr/bin/env node
/**
 * Idempotently patch `android/gradle.properties` with project-specific
 * Gradle JVM tuning. The Expo-generated default `org.gradle.jvmargs`
 * caps heap at 2 GB — fine for stock RN apps, but D8 OOMs during
 * mergeExtDexRelease on this repo's class graph (bundled Noir circuits
 * + Groth16 native modules + RN/Expo/Hermes + app code). Locally we set
 * 6 GB in `~/.gradle/gradle.properties` and the build succeeds; in CI
 * we have to apply the override here because `expo prebuild --clean`
 * regenerates `android/` each run.
 *
 * GitHub-hosted ubuntu-latest gives 16 GB RAM, so -Xmx6g leaves plenty
 * for the gradle daemon, node, kotlinc, etc.
 *
 * The Expo-generated file already has an `org.gradle.jvmargs=...` line
 * (=-Xmx2048m). Gradle does NOT reliably do last-wins for duplicate
 * keys in gradle.properties — the docs explicitly warn about
 * unpredictable behavior. So we REPLACE the existing line in place
 * rather than append a second one.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'android', 'gradle.properties');
const SENTINEL = '# >>> CI gradle JVM tuning injected';
const NEW_JVMARGS =
  'org.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8';
const REPLACEMENT = `${SENTINEL}
# Bumped from Expo default (-Xmx2048m) for D8 dex-merge OOM on the
# bundled Noir + Groth16 + RN/Hermes class graph. See
# scripts/ci/inject-android-gradle-tuning.mjs.
${NEW_JVMARGS}`;

let props = readFileSync(file, 'utf8');
if (props.includes(SENTINEL)) {
  console.log('[inject-android-gradle-tuning] already injected, skipping');
  process.exit(0);
}

// Match either a live `org.gradle.jvmargs=...` line or a commented-out
// one, since the Expo template ships it active by default. The multiline
// flag makes ^/$ match line boundaries.
const jvmargsRx = /^[#\s]*org\.gradle\.jvmargs\s*=.*$/m;
if (jvmargsRx.test(props)) {
  props = props.replace(jvmargsRx, REPLACEMENT);
  console.log('[inject-android-gradle-tuning] replaced existing org.gradle.jvmargs line');
} else {
  // Fallback: append if no existing line found. Shouldn't happen with
  // Expo's template, but defensive.
  if (!props.endsWith('\n')) props += '\n';
  props += '\n' + REPLACEMENT + '\n';
  console.log('[inject-android-gradle-tuning] no existing line — appended');
}

writeFileSync(file, props);
