# Quick Start Guide

## Minimal Setup (Just NFC Reading)

If you only want the core NFC passport reading functionality without the UI:

### 1. Copy Core Module
```bash
cp -r passport-scan-export/modules/e-document <your-project>/modules/
cp -r passport-scan-export/src/utils/e-document <your-project>/src/utils/
cp -r passport-scan-export/plugins/withNfc.plugin <your-project>/plugins/
```

### 2. Install Dependencies
```bash
yarn add mrz expo-modules-core
```

### 3. Update app.config.ts
Add the NFC plugin and permissions (see app-config-example.ts)

### 4. Use in Your Code
```typescript
import { scanDocument } from '@modules/e-document'

// Get MRZ data first (scan with camera or manual input)
const mrzData = {
  documentNumber: 'C01X00T47',
  dateOfBirth: '690702',
  dateOfExpiry: '330114',
}

// Scan NFC chip
const eDocument = await scanDocument(
  'P',  // 'P' for passport, 'I' for ID card
  mrzData,
  new Uint8Array(32) // challenge bytes
)

console.log('Name:', eDocument.personDetails.firstName, eDocument.personDetails.lastName)
console.log('Nationality:', eDocument.personDetails.nationality)
console.log('Photo:', eDocument.personDetails.passportImageRaw)
```

## Full Setup (With UI)

Copy everything and customize the UI components as needed.

### Camera MRZ Scanning
The `ScanMrzStep.tsx` component uses `react-native-vision-camera` with OCR to automatically detect and parse MRZ codes.

Additional dependencies:
```bash
yarn add react-native-vision-camera react-native-vision-camera-text-recognition
```

## Testing Checklist

- [ ] Physical device (NFC doesn't work in simulators)
- [ ] Real biometric passport/ID with NFC chip
- [ ] Camera permissions granted (for MRZ scanning)
- [ ] NFC enabled on device
- [ ] Test both portrait and landscape orientations

## Troubleshooting

### iOS
- Ensure Info.plist has NFC usage description
- Check developer.apple.com for NFC entitlements
- iOS 13+ required

### Android
- Ensure NFC permission in AndroidManifest.xml
- Enable NFC in device settings
- Android 8+ (API 26+) required

### Common Issues
- "NFC not available" → Test on physical device
- "Authentication failed" → Check MRZ data is correct
- "No NFC tag detected" → Hold phone steady on passport for 3-5 seconds
