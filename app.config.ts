import { ConfigContext, ExpoConfig } from '@expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  // Toggle between accounts: false = referendum-citoyen (organization), true = eklchan (personal)
  const usePersonalAccount = true;

  // Account configurations
  const accountConfig = {
    organizationAccount: {
      owner: 'referendum-citoyen',
      projectId: '0eeee796-7544-484f-9b24-615ec638f7d3'
    },
    personalAccount: {
      owner: 'eklchan',
      projectId: '2393a07c-1e68-4433-9772-c091d69eb99e'
    }
  };

  const currentAccount = usePersonalAccount
    ? accountConfig.personalAccount
    : accountConfig.organizationAccount;

  return {
    ...config,
    name: 'referendum-citoyen',
    slug: 'referendum-citoyen',
    version: '1.1',
    orientation: 'portrait',
    icon: './assets/images/app-icon.png',
    scheme: 'referendumcitoyen',
    userInterfaceStyle: 'automatic',
    owner: currentAccount.owner,
    newArchEnabled: true,
    splash: {
      image: './assets/images/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff'
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.referendumcitoyen.app2',
      deploymentTarget: '16.0',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NFCReaderUsageDescription: "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
        NSCameraUsageDescription: "Cette application a besoin d'accéder à la caméra pour scanner la zone MRZ de votre carte d'identité.",
        NSLocationWhenInUseUsageDescription: "Cette application a besoin d'accéder à votre localisation.",
        'com.apple.developer.nfc.readersession.iso7816.select-identifiers': [
          'A0000002471001',
          '00000000000000',
          'D4100000030001'
        ]
      }
    },
    android: {
      package: 'com.referendumcitoyen.app',
      adaptiveIcon: {
        foregroundImage: './assets/images/app-icon-android.png',
        backgroundColor: '#ffffff'
      },
      splash: {
        image: './assets/images/app-icon-android.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff'
      },
      edgeToEdgeEnabled: false,
      predictiveBackGestureEnabled: false,
      permissions: [
        'android.permission.NFC',
        'android.permission.CAMERA'
      ]
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png'
    },
    plugins: [
      'expo-router',
      'expo-video',
      '@rarimo/rarime-rn-sdk',
      [
        './plugins/withNfc.plugin/build/index.js',
        {
          nfcPermission: "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
          includeNdefEntitlement: false
        }
      ],
      [
        'react-native-nfc-manager',
        {
          nfcPermission: "Cette application a besoin de lire la puce NFC de votre carte d'identité pour vérifier votre âge et nationalité de manière anonyme.",
          includeNdefEntitlement: false,
          includeTagEntitlement: true,
          includeIso15693Entitlement: false,
          includeIso18092Entitlement: false
        }
      ],
      [
        'react-native-vision-camera',
        {
          cameraPermissionText: "Cette application a besoin d'accéder à la caméra pour scanner la zone MRZ de votre carte d'identité.",
          enableCodeScanner: false
        }
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.0',
            extraPods: [
              {
                name: 'NFCPassportReader',
                git: 'https://github.com/rarimo/NFCPassportReader.git',
                commit: '4c463a687f59eb6cc5c7955af854c7d41295d54f'
              }
            ]
          }
        }
      ]
    ],
    experiments: {
      typedRoutes: true
    },
    extra: {
      router: {},
      eas: {
        projectId: currentAccount.projectId
      }
    }
  };
};
