import { ConfigContext, ExpoConfig } from '@expo/config';
import { execSync } from 'node:child_process';

// The source revision a binary was built from, surfaced on the Settings screen
// via utils/app-version.ts::appCommitLabel. Resolved at config-evaluation time,
// i.e. at build time — the only moment a bundle is made, now that the app
// carries no over-the-air updater: what the stores serve is what was built.
//
// Why the build number isn't enough: several commits can land between two
// uploads.
//
// EAS Build sets EAS_BUILD_GIT_COMMIT_HASH, and the archive it extracts there
// may not be a git repo — so git is preferred only for the dirty check, which
// nothing else can answer. `dirty` matters here specifically because EAS
// uploads uncommitted working-tree changes, so a build from a dirty tree is not
// the commit it names. Where git is unreachable the marker is simply absent
// rather than wrong.
//
// Everything is wrapped: a config that throws takes the entire build down, and
// a missing commit label is nowhere near worth that.
function gitCommit(): { commitHash?: string; commitDirty?: boolean } {
  const git = (args: string) =>
    execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const fromEas = process.env.EAS_BUILD_GIT_COMMIT_HASH;
  let commitHash = fromEas;
  let commitDirty: boolean | undefined;
  try {
    if (!commitHash) commitHash = git('rev-parse HEAD');
    commitDirty = git('status --porcelain').length > 0;
  } catch {
    // No git here. Keep whatever EAS told us and say nothing about dirtiness.
  }
  return commitHash ? { commitHash, commitDirty } : {};
}

// Which app this config describes. The same code ships twice: `beta` is the
// test app on the testers' phones, `production` is the store app June's
// voters already have — its own bundle id, EAS project (where the store
// credentials live and its update channels), icons and version. Runtime code
// keys off the bundle id instead (constants/app-flavour.ts), which cannot
// drift from the binary.
//
// One repository per app (team decision, 2026-09-14/15): the store app comes
// from the
// checkout of referendum-citoyen-react-native, the beta from the checkout of
// referendum-citoyen-beta, and nothing built, submitted or published from one
// may reach the other. Resolution, in order:
//   1. APP_FLAVOUR — set per build profile in eas.json; the only source on
//      EAS servers, where the archive has no git remote.
//   2. The checkout's origin. Every command run by hand — eas submit, eas
//      update, expo prebuild, expo run — then addresses this checkout's EAS
//      project, bundle id and App Store Connect record without being told.
//   3. beta: an archive with neither cannot be a store build.
// When 1 and 2 are both known and disagree, the config throws, which stops
// the command before anything is uploaded: a store profile in the beta
// checkout, or the reverse, is always a mistake.
type Flavour = 'production' | 'beta';
function checkoutFlavour(): Flavour | undefined {
  try {
    const origin = execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (origin.includes('referendum-citoyen-react-native')) return 'production';
    if (origin.includes('referendum-citoyen-beta')) return 'beta';
  } catch {
    // No git here (EAS servers): the profile's APP_FLAVOUR decides.
  }
  return undefined;
}
const FLAVOUR_FROM_ENV: Flavour | undefined =
  process.env.APP_FLAVOUR === 'production' || process.env.APP_FLAVOUR === 'beta'
    ? process.env.APP_FLAVOUR
    : undefined;
const FLAVOUR_FROM_CHECKOUT = checkoutFlavour();
if (FLAVOUR_FROM_ENV && FLAVOUR_FROM_CHECKOUT && FLAVOUR_FROM_ENV !== FLAVOUR_FROM_CHECKOUT) {
  throw new Error(
    `APP_FLAVOUR=${FLAVOUR_FROM_ENV} in the ${FLAVOUR_FROM_CHECKOUT} checkout — refused. ` +
      'The store app is built from referendum-citoyen-react-native, the beta from ' +
      'referendum-citoyen-beta; run this from the other repository.',
  );
}
const PRODUCTION = (FLAVOUR_FROM_ENV ?? FLAVOUR_FROM_CHECKOUT ?? 'beta') === 'production';

const IDENTITY = PRODUCTION
  ? {
      name: 'Référendum Citoyen',
      slug: 'referendum-citoyen',
      // 2.0.x: the first store release that reads ID cards and votes them
      // (the brief said 1.6.0; "production build 2.0" won). 2.0.1 is the
      // first build without the over-the-air updater, the PACE entitlement
      // that lets an iOS ID-card session start, and every profile in this
      // checkout addressing the store app — 2.0.0 never reached the stores,
      // only TestFlight (builds 15–22). constants/terms.ts says "2.0.0 et
      // versions suivantes", so the CGU cover it. The beta stays on its own
      // number and its own EAS project.
      //
      // 2.0.2 is this release. Keep this equal to package.json's "version":
      // the repository published under repository.url is this app's, so a
      // reader opening either file must find the same number. There is no
      // runtimeVersion to keep in step, on purpose (see below): without an
      // over-the-air updater there is no runtime to match a bundle against.
      version: '2.0.2',
      // The 2026-09-13 artwork: ballot box with the gold ID-card marker
      // bottom right. iOS wants no alpha channel and shows the whole square.
      // The Android file is the same artwork re-centred and scaled to 60 %
      // so that it sits inside the adaptive icon's 66 dp safe zone:
      // launchers mask the outer third of the 108 dp canvas (circle,
      // squircle, rounded square), and at full size the card marker was cut
      // off — on the Android 12+ system splash too, which draws the same
      // file in a circle. Don't swap the iOS PNG back in for Android.
      icon: './assets/images/app-icon-carte.png',
      scheme: 'referendumcitoyen',
      projectId: '3cb72532-b213-4dc5-8d33-0b9ef3298949',
      splash: './assets/images/splash.png',
      splashColor: '#ffffff',
      bundleIdentifier: 'app.referendumcitoyen.fr',
      package: 'fr.referendumcitoyen.app',
      androidIcon: './assets/images/app-icon-android-carte.png',
      androidColor: '#ffffff',
    }
  : {
      name: 'Beta Référendum Citoyen',
      slug: 'referendum-citoyen-beta',
      // The App Store / Play version, shown as-is in-app (utils/app-version.ts).
      // Deliberately NOT the store app's number: the beta is a separate store
      // record with its own, strictly increasing version line, and TestFlight
      // build 1.6.x is what the testers already have. package.json carries the
      // store app's number because that is the repository being published.
      version: '1.6.0',
      icon: './assets/images/app-icon-beta.png',
      scheme: 'referendumcitoyenbeta',
      projectId: '3a8a8a53-f257-4385-9057-3942ccb27eca',
      splash: './assets/images/splash-beta.png',
      // Both background colours match the beta artwork's own purple
      // (#633AC4). Upstream used #ffffff because the icon/splash art had a
      // white background; the beta art is purple-backed, so leaving these
      // white letterboxed the purple square inside white bars on the
      // Android splash (resizeMode 'contain' on a tall screen) and risked a
      // white fringe behind the adaptive-icon mask.
      splashColor: '#633AC4',
      bundleIdentifier: 'app.referendumcitoyen.fr.beta',
      package: 'fr.referendumcitoyen.app.beta',
      androidIcon: './assets/images/app-icon-android-beta.png',
      androidColor: '#633AC4',
    };

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: IDENTITY.name,
    slug: IDENTITY.slug,
    version: IDENTITY.version,
    orientation: 'portrait',
    icon: IDENTITY.icon,
    scheme: IDENTITY.scheme,
    userInterfaceStyle: 'automatic',
    owner: 'referendum-citoyen-fr',
    newArchEnabled: true,
    // No `updates` / `runtimeVersion` and no expo-updates package, on purpose
    // (2.0.1, 2026-09-17): an over-the-air updater lets whoever holds the EAS
    // project replace this app's JavaScript on every phone, silently, without
    // a store review or a tag on GitHub — and this app is open source so that
    // people can check what runs on their phone. Without it, the binary is
    // self-contained: what the stores serve is what was built from the tagged
    // commit, and every fix goes through a store release.
    splash: {
      image: IDENTITY.splash,
      resizeMode: 'cover',
      backgroundColor: IDENTITY.splashColor,
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: IDENTITY.bundleIdentifier,
      deploymentTarget: '16.0',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NFCReaderUsageDescription:
          "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
        NSCameraUsageDescription:
          "Cette application a besoin d'accéder à la caméra pour scanner la zone MRZ de votre carte d'identité.",
        // Required to satisfy ITMS-90683: a transitive dependency references the
        // location API even though the app never requests the user's location.
        NSLocationWhenInUseUsageDescription:
          "Cette application n'utilise pas votre position. Cette autorisation est requise par un composant tiers mais aucune donnée de localisation n'est collectée.",
        'com.apple.developer.nfc.readersession.iso7816.select-identifiers': [
          'A0000002471001',
          'A0000001510000',
          '00000000000000',
          'D4100000030001',
        ],
      },
    },
    android: {
      package: IDENTITY.package,
      adaptiveIcon: {
        foregroundImage: IDENTITY.androidIcon,
        backgroundColor: IDENTITY.androidColor,
      },
      splash: {
        image: IDENTITY.androidIcon,
        resizeMode: 'contain',
        backgroundColor: IDENTITY.androidColor,
      },
      // True switches RN 0.81's Android template + react-native-screens to
      // WindowCompat / WindowInsetsControllerCompat — the APIs Android 15
      // requires. Leaving this false makes RN fall back to the deprecated
      // Window.setStatusBarColor / setNavigationBarColor path, which Play
      // Console now flags. SafeAreaProvider + useSafeAreaInsets are already
      // in place at the root (app/_layout.tsx) and in the load-bearing
      // surfaces (CustomTabBar, voting-flow), so the visual layout stays
      // correct under the new path. Visually verify any custom-headered
      // screen and the navigation-bar area after toggling.
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      // Keep the app's private storage out of the phone's backups. The Expo
      // template leaves android:allowBackup at the platform default, true,
      // which lets Auto Backup copy the AsyncStorage database and files/ into
      // the user's Google Drive.
      // ./plugins/withNoBackup.js adds the Android 12+ half of the same
      // decision (device-to-device transfer) and explains the trade.
      allowBackup: false,
      permissions: ['android.permission.NFC', 'android.permission.CAMERA'],
      // Block permissions pulled in transitively by deps but never used
      // by our code. Without these, the Play Store data-safety page and
      // app-install permissions screen would falsely flag microphone +
      // external-storage access (added by expo-av's audio surface even
      // though we only use it for the splash/intro video). Each entry
      // emits `<uses-permission … tools:node="remove"/>` in the merged
      // AndroidManifest, so the runtime install doesn't request them.
      // FOREGROUND_SERVICE_MEDIA_PLAYBACK: declared transitively by
      // expo-video / expo-av but we never play media in the background
      // (audio mode sets staysActiveInBackground: false in
      // app/_layout.tsx; no playInBackground / allowsBackgroundPlayback
      // flags anywhere). Blocking it avoids the Play Console "describe
      // your use of this permission" prompt that otherwise requires a
      // demonstration video.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      ],
    },
    web: {
      bundler: 'metro',
      // QA web preview: one client-side page, no static
      // render of every route on Node, where the native modules cannot load.
      output: process.env.QA_WEB === '1' ? 'single' : 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-video',
      '@rarimo/rarime-rn-sdk',
      // Replaces the Rarime SDK's bundled noir.aar with a 16 KB page-size
      // aligned rebuild (modules/noir-16k/noir.aar) so the Noir register flow
      // doesn't crash at System.loadLibrary() on Android 15+ 16 KB-page
      // devices. Must run after '@rarimo/rarime-rn-sdk'. Built reproducibly by
      // scripts/native-build/noir — see scripts/native-build/README.md.
      './plugins/withAlignedNoir.js',
      // Declares the flatDir repository in android/build.gradle that Gradle
      // needs to resolve the SDK's `implementation(name: 'noir', ext: 'aar')`
      // — the AAR withAlignedNoir just swapped, in the same libs directory.
      // Must be LISTED after '@rarimo/rarime-rn-sdk': that package's own
      // app.plugin.js injects an equivalent flatDir, and mods for a given
      // file execute last-registered-FIRST, so listing ours later is what
      // makes OUR commented version land instead of the SDK's. Both are guarded on a
      // string the other emits, so exactly one flatDir is injected either
      // way. Kept even though the SDK covers it today because the SDK's
      // version console.warn()s when its anchor stops matching (silent
      // prebuild, then "Could not find :noir:." at Gradle configuration
      // time) whereas ours throws — and because a future SDK bump could drop
      // that mod, rename android/libs, or publish noir.aar under a real Maven
      // coordinate. If the SDK is ever bumped, re-verify that libs path in
      // plugins/withNoirFlatDir.js still exists.
      './plugins/withNoirFlatDir.js',
      // Sets android:largeHeap="true" on the <application/> element. The
      // Groth16 witness calculator on the Mainnet vote path allocates a
      // ~100 MB buffer which OOMs the default 256 MB Dalvik heap. See the
      // file for the full rationale.
      './plugins/withLargeHeap.js',
      // Writes android:allowBackup="false" and a data_extraction_rules
      // resource that excludes every domain from cloud backup AND from
      // device-to-device transfer, which `android.allowBackup: false` alone
      // does not cover from Android 12 on. See the file for what a user
      // loses when they change phone.
      './plugins/withNoBackup.js',
      // Restricts Android build to arm64-v8a and emits per-ABI APK splits
      // (no universal APK). The Rarimo prebuilts the vote / register
      // flows depend on (libnoir_java.so, libwitnesscalc_queryIdentity.so)
      // ship only as arm64-v8a — building for
      // armv7 / x86 / x86_64 produces APKs that install but crash at
      // Step 7 / Step 11. The direct-download .apk now lands at ~80 MB
      // (was ~290 MB universal). Play Store path uses AAB; Play splits
      // per ABI server-side.
      './plugins/withAndroidAbiSplits.js',
      // Patches the pinned NFCPassportReader fork's PassportReader.swift
      // (Podfile post_install) so the PACE authentication phase animates a
      // heartbeat progress signal instead of reporting nothing for the full
      // 1-3s handshake. Feeds EDocumentModule.swift's continuous progress
      // bar. See the plugin file for the exact anchor line it patches and
      // what to re-verify if the pinned pod commit changes.
      './plugins/withPaceAuthHeartbeat.js',
      // Two more Podfile post_install patches on the same fork, both needed
      // for a CNIe opened with its CAN (the ID-card flow since 2026-09-09):
      //  - withPaceCanFix: the fork SHA-1s every PACE password, but the CAN
      //    must be used unhashed (ICAO 9303-11 §9.7.2). Without it a scan
      //    works with an EMPTY CAN and fails with the right one.
      //  - withPaceParamId: send the PACE parameterId (tag 0x84) in MSE:Set
      //    AT when the CAN is used — a CNIe announces two PACEInfos and
      //    TR-03110-3 B.1 requires naming the domain parameters then.
      // Proven on a real card, on this same pod commit.
      // Both are gated on the CAN key reference, so MRZ / passport scans are
      // byte-identical to before.
      './plugins/withPaceCanFix.js',
      './plugins/withPaceParamId.js',
      // Patches the same pinned NFCPassportReader fork's PassportReader.swift
      // (Podfile post_install) to expose a public cancelReading() method, so
      // EDocumentModule.swift's disableScan can release an in-flight
      // NFCTagReaderSession from outside the class. See the plugin file for
      // the exact anchor line it patches and what to re-verify if the
      // pinned pod commit changes.
      './plugins/withCancelReading.js',
      [
        './plugins/withNfc.plugin/build/index.js',
        {
          nfcPermission:
            "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
          includeNdefEntitlement: false,
        },
      ],
      [
        'react-native-nfc-manager',
        {
          nfcPermission:
            "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
          includeNdefEntitlement: false,
          includeTagEntitlement: true,
          includeIso15693Entitlement: false,
          includeIso18092Entitlement: false,
        },
      ],
      [
        'react-native-vision-camera',
        {
          cameraPermissionText:
            "Cette application a besoin d'accéder à la caméra pour scanner la zone MRZ de votre passeport.",
          enableCodeScanner: false,
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.0',
            extraPods: [
              {
                name: 'NFCPassportReader',
                git: 'https://github.com/referendumcitoyenfr/NFCPassportReader.git',
                // 9201876: conditional .pace polling based on skipPACE.
                // Built on 69368850 (retains can: param for CAN-PACE).
                // skipPACE=false (CNIe) → .pace + .iso14443 (Type A detected).
                // skipPACE=true (passport/BAC) → .iso14443 only (Type B detected).
                //
                // ed75f373, branch privacy/no-release-logging of our own fork. It is
                // 9201876 plus one commit: the seven Logger categories are bound
                // to OSLog.disabled outside DEBUG, and SimpleASN1DumpParser's
                // print() sits under #if DEBUG. Verified before pinning: same
                // seven categories in both branches, the package builds in
                // Release, and the runtime reports OSLog.disabled as disabled
                // at every level. Its parent, 9201876, logged chip-session
                // details in Release builds (modules/pod-logging-pin.test.ts
                // keeps that list).
                commit: 'ed75f3732ba9a1e7631923dc81c8e1b32c9577e4',
              },
            ],
          },
          android: {
            // Native dependencies in the vote/register stack (Rarime SDK
            // Noir module, witnesscalc query_identity, rapidsnark) require an
            // API 27 floor. Kept at 27 to match.
            minSdkVersion: 27,
            // Google Play requires targetSdkVersion >= 36 (Android 16) for
            // every app submitted or updated after 2026-08-31 — the Play
            // Console refused versionCode 21 (targeting 35) on 2026-09-17.
            // compileSdk matches so the toolchain has the same public APIs at
            // compile time. 36 is what Expo SDK 54 / RN 0.81 default to when
            // nothing is pinned (expo-modules-core's safeExtGet fallback), so
            // this only stops holding the toolchain back. Android 16 changes
            // that matter here are already met: edge-to-edge is mandatory at
            // 36 (`edgeToEdgeEnabled: true` above), predictive back stays
            // opted out, and the native libraries are 16 KB-page aligned
            // (plugins/withAlignedNoir.js, scripts/ci/check-16k-alignment.sh).
            targetSdkVersion: 36,
            compileSdkVersion: 36,
            packagingOptions: {
              // The 16 KB-aligned libnoir_java.so in modules/noir-16k/noir.aar
              // is pre-stripped and then patched with patchelf (--add-needed
              // libc++_shared.so — the upstream rebuild dropped the DT_NEEDED
              // entry while still referencing libc++ symbols, which made
              // System.loadLibrary throw UnsatisfiedLinkError on EVERY device
              // and broke registration entirely in v1.2/build 14). Running
              // AGP's llvm-strip over a patchelf-modified ELF corrupts its
              // dynamic section (empty DT_GNU_HASH) — so strip must skip it.
              doNotStrip: ['**/libnoir_java.so'],
            },
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: IDENTITY.projectId,
      },
      ...gitCommit(),
    },
  };
};
