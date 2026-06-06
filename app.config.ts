import { ConfigContext, ExpoConfig } from '@expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: 'Référendum Citoyen',
    slug: 'referendum-citoyen',
    version: '1.2',
    orientation: 'portrait',
    icon: './assets/images/app-icon.png',
    scheme: 'referendumcitoyen',
    userInterfaceStyle: 'automatic',
    owner: 'referendum-citoyen-fr',
    newArchEnabled: true,
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/3cb72532-b213-4dc5-8d33-0b9ef3298949',
    },
    splash: {
      image: './assets/images/splash.png',
      resizeMode: 'cover',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'app.referendumcitoyen.fr',
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
      package: 'fr.referendumcitoyen.app',
      adaptiveIcon: {
        foregroundImage: './assets/images/app-icon-android.png',
        backgroundColor: '#ffffff',
      },
      splash: {
        image: './assets/images/app-icon-android.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
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
      output: 'static',
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
      // Sets android:largeHeap="true" on the <application/> element. The
      // Groth16 witness calculator on the Mainnet vote path allocates a
      // ~100 MB buffer which OOMs the default 256 MB Dalvik heap. See the
      // file for the full rationale.
      './plugins/withLargeHeap.js',
      // Restricts Android build to arm64-v8a and emits per-ABI APK splits
      // (no universal APK). The Rarimo prebuilts the vote / register
      // flows depend on (libnoir_java.so, libwitnesscalc_queryIdentity.so)
      // ship only as arm64-v8a — building for
      // armv7 / x86 / x86_64 produces APKs that install but crash at
      // Step 7 / Step 11. The direct-download .apk now lands at ~80 MB
      // (was ~290 MB universal). Play Store path uses AAB; Play splits
      // per ABI server-side.
      './plugins/withAndroidAbiSplits.js',
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
            "Cette application a besoin d'accéder à la caméra pour scanner la zone MRZ de votre carte d'identité.",
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
                commit: '92018762f6103bf13a12b0bede9539f066de18a9',
              },
            ],
          },
          android: {
            // Native dependencies in the vote/register stack (Rarime SDK
            // Noir module, witnesscalc query_identity, rapidsnark) require an
            // API 27 floor. Kept at 27 to match.
            minSdkVersion: 27,
            // Google Play requires targetSdkVersion >= 35 (Android 15) for
            // every app submitted or updated after 2025-08-31. compileSdk
            // is bumped to match so the toolchain has the matching public
            // APIs at compile time. No code changes needed at the floor
            // level — Expo SDK 54 / RN 0.81 already officially support 35.
            targetSdkVersion: 35,
            compileSdkVersion: 35,
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
        projectId: '3cb72532-b213-4dc5-8d33-0b9ef3298949',
      },
    },
  };
};
