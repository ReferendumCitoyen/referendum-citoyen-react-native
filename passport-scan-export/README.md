# Passport Scanning Module - Export

This folder contains all the necessary files to implement passport scanning in a new React Native/Expo project.

## Folder Structure

```
passport-scan-export/
├── modules/e-document/              # CORE: Native module for NFC passport reading
│   ├── ios/                         # iOS native code (Swift)
│   ├── android/                     # Android native code (Kotlin)
│   ├── src/                         # TypeScript interface
│   └── index.ts                     # Main entry point
│
├── plugins/withNfc.plugin/          # REQUIRED: NFC permissions plugin
│
├── src/
│   ├── utils/e-document/            # REQUIRED: EDocument/EPassport classes
│   └── pages/app/pages/document-scan/  # OPTIONAL: UI components (customize as needed)
│       ├── ScanProvider/            # Scan flow state management
│       └── components/              # Step-by-step UI components
│
├── package-dependencies.json        # Dependencies to add to your package.json
├── app-config-example.ts            # Config to add to your app.config.ts
└── README.md                        # This file
```

## Installation Steps

### 1. Copy Files
Copy the contents to your new project:
- `modules/e-document/` → `<your-project>/modules/e-document/`
- `plugins/withNfc.plugin/` → `<your-project>/plugins/withNfc.plugin/`
- `src/utils/e-document/` → `<your-project>/src/utils/e-document/`
- `src/pages/` → `<your-project>/src/pages/` (or customize UI as needed)

### 2. Install Dependencies
```bash
yarn add react-native-vision-camera@^4.6.1
yarn add react-native-vision-camera-text-recognition@^0.3.0
yarn add mrz@^3.5.0
yarn add expo-modules-core
```

See `package-dependencies.json` for the complete list.

### 3. Configure NFC Permissions
Add to your `app.config.ts`:
```typescript
plugins: [
  ['./plugins/withNfc.plugin/build/index.js'],
],
```

See `app-config-example.ts` for full example.

### 4. iOS Setup
The native module will automatically configure via CocoaPods.
Required: iOS 13+ for NFC support.

### 5. Android Setup
The native module includes all Gradle dependencies.
Required: Android 8+ (API 26+) for NFC support.

### 6. Usage Example
```typescript
import { scanDocument } from '@modules/e-document'

// After MRZ scan
const eDocument = await scanDocument(
  documentCode,
  {
    dateOfBirth: 'YYMMDD',
    dateOfExpiry: 'YYMMDD',
    documentNumber: 'ABC123456'
  },
  challenge // Uint8Array
)

console.log(eDocument.personDetails)
```

## Testing
- NFC scanning **only works on physical devices**
- Simulators/emulators do not support NFC
- Test with a real biometric passport

## Notes
- The UI components are customizable - feel free to redesign
- The ZK proof generation code has been excluded (not needed for basic scanning)
- Core native module works standalone without the UI components
