# File Manifest

## 📦 What's Included

### Essential Files (Required)

**Native Module:**
- `modules/e-document/` - Complete NFC passport reading module
  - `ios/` - iOS Swift implementation using NFCPassportReader
  - `android/` - Android Kotlin implementation using JMRTD
  - `src/` - TypeScript interfaces
  - `index.ts` - Main entry point

**Utilities:**
- `src/utils/e-document/` - EDocument/EPassport data classes
  - `e-document.ts` - Main classes
  - `sod.ts` - Security Object Document parsing
  - `extended-cert.ts` - Certificate handling
  - `inid-nfc-reader.ts` - eID NFC reader
  - `helpers/` - Helper utilities

**Permissions:**
- `plugins/withNfc.plugin/` - NFC permissions Expo plugin

### UI Components (Optional - Customize as needed)

- `src/pages/app/pages/document-scan/` - Complete scan flow UI
  - `ScanMrzStep.tsx` - Camera MRZ scanning with OCR
  - `ScanNfcStep.tsx` - NFC chip reading UI
  - `SelectDocTypeStep.tsx` - Document type selector
  - `DocumentPreviewStep.tsx` - Preview scanned data
  - `ScanProvider/` - Context for managing scan state

### Configuration Examples

- `app-config-example.ts` - Example app.config.ts setup
- `package-dependencies.json` - Required npm packages
- `README.md` - Full documentation
- `QUICK-START.md` - Quick setup guide
- `FILE-MANIFEST.md` - This file

## 🚀 Quick Copy Commands

### Minimal (Core NFC reading only):
```bash
cp -r passport-scan-export/modules <your-project>/
cp -r passport-scan-export/src/utils <your-project>/src/
cp -r passport-scan-export/plugins <your-project>/
```

### Full (With UI):
```bash
cp -r passport-scan-export/modules <your-project>/
cp -r passport-scan-export/src <your-project>/
cp -r passport-scan-export/plugins <your-project>/
```

## 📋 What You Need to Do Next

1. ✅ Copy files to your project
2. ✅ Install dependencies from `package-dependencies.json`
3. ✅ Update `app.config.ts` (see `app-config-example.ts`)
4. ✅ Run `npx expo prebuild` to generate native code
5. ✅ Test on physical device with real passport

## 📱 Platform Requirements

- **iOS:** 13+ (for NFC support)
- **Android:** API 26+ (Android 8+)
- **Testing:** Must use physical device (NFC doesn't work in simulators)

## 🔑 Key Features

✅ MRZ (Machine Readable Zone) scanning with camera OCR
✅ NFC chip reading (DG1, DG11, DG15, SOD)
✅ Basic Access Control (BAC) authentication
✅ Active Authentication signature verification
✅ Support for both passports and national ID cards
✅ Cross-platform (iOS & Android)
