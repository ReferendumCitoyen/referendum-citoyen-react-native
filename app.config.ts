import { ConfigContext, ExpoConfig } from '@expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: 'Référendum Citoyen',
    slug: 'referendum-citoyen',
    version: '1.5',
    orientation: 'portrait',
    icon: './assets/images/app-icon.png',
    scheme: 'referendumcitoyen',
    userInterfaceStyle: 'automatic',
    owner: 'referendum-citoyen-fr',
    newArchEnabled: true,
    splash: {
      image: './assets/images/splash.png',
      resizeMode: 'cover',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'fr.referendumcitoyen.app',
      deploymentTarget: '16.0',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NFCReaderUsageDescription:
          "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
        NSCameraUsageDescription:
          "Cette application a besoin d'accéder à la caméra pour scanner la zone MRZ de votre carte d'identité.",
        NSLocationWhenInUseUsageDescription:
          "Cette application a besoin d'accéder à votre localisation.",
        'com.apple.developer.nfc.readersession.iso7816.select-identifiers': [
          '',
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
      edgeToEdgeEnabled: false,
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.NFC', 'android.permission.CAMERA'],
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
      // Injects flatDir entries for the Groth16 stack's local AARs
      // (modules/rapidsnark-wrp + modules/witnesscalculator). Needed by the
      // Mainnet vote flow's witnesscalc + rapidsnark prove pipeline.
      './plugins/withCircomFlatDirs.js',
      // Sets android:largeHeap="true" on the <application/> element. The
      // Groth16 witness calculator on the Mainnet vote path allocates a
      // ~100 MB buffer which OOMs the default 256 MB Dalvik heap. See the
      // file for the full rationale.
      './plugins/withLargeHeap.js',
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
                git: 'https://github.com/eklchan/NFCPassportReader.git',
                // 9201876: conditional .pace polling based on skipPACE.
                // Built on 69368850 (retains can: param for CAN-PACE).
                // skipPACE=false (CNIe) → .pace + .iso14443 (Type A detected).
                // skipPACE=true (passport/BAC) → .iso14443 only (Type B detected).
                commit: '92018762f6103bf13a12b0bede9539f066de18a9',
              },
            ],
          },
          android: {
            // RmoCalcs.aar (modules/witnesscalculator) declares minSdkVersion
            // 27. Bumping our floor to match. Needed for the Groth16 vote flow.
            minSdkVersion: 27,
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
