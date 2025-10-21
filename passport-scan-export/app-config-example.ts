// Add this to your app.config.ts or app.json

export default {
  // ... your existing config
  
  plugins: [
    // Add the NFC plugin
    ['./plugins/withNfc.plugin/build/index.js'],
    
    // Vision Camera permissions
    [
      'react-native-vision-camera',
      {
        cameraPermissionText: 'Allow camera access to scan passport MRZ',
        enableMicrophonePermission: false,
      },
    ],
  ],
  
  ios: {
    // ... your existing iOS config
    infoPlist: {
      // Required for NFC
      NFCReaderUsageDescription: 'This app needs to read NFC tags from passports',
      'com.apple.developer.nfc.readersession.iso7816.select-identifiers': [
        'A0000002471001',
        'A0000002472001',
        'E80704007F00070302',
      ],
    },
  },
  
  android: {
    // ... your existing Android config
    permissions: [
      'NFC',
      'CAMERA',
    ],
  },
}
