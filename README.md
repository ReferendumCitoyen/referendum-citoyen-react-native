# Referendum Citoyen

A React Native/Expo application for secure digital voting using passport NFC verification and zero-knowledge proofs.

## Features

- Passport MRZ scanning via camera (TD1 ID cards, TD3 passports)
- NFC passport chip reading with BAC authentication
- Zero-knowledge identity verification via Rarimo protocol
- Multi-step voting flow with video guidance
- Bilingual support (French/English)

## Prerequisites

- **Node.js** 20+
- **Expo CLI** (`npm install -g expo-cli`)
- **iOS**: Xcode 15+, CocoaPods
- **Android**: Android Studio, NDK 26.1.10909125

## Installation

```bash
# Install dependencies
npm install

# Generate native projects
npx expo prebuild

# Run on iOS
npx expo run:ios

# Run on Android
npx expo run:android
```

## Project Structure

```
referendum-citoyen/
├── app/                    # Expo Router screens
├── components/             # React components
│   ├── voting-modal/       # Voting flow components
│   └── icons/              # SVG icons
├── contexts/               # React context providers
├── hooks/                  # Custom React hooks
├── utils/                  # Utility functions
├── constants/              # Theme and content constants
├── modules/                # Native modules
│   └── e-document/         # NFC passport reading module
├── locales/                # i18n translations
└── assets/                 # Images, fonts, videos
```

## Development

```bash
# Start Expo development server
npm start

# Run linter
npm run lint

# Format code
npm run format

# Run tests
npm test
```

## Documentation

- [Integration Guide](./INTEGRATION_GUIDE.md) - Detailed setup for native modules
- [Roadmap](./TODO.md) - Development roadmap and tasks

## Technologies

- [Expo](https://expo.dev/) - React Native framework
- [Expo Router](https://docs.expo.dev/router/introduction/) - File-based routing
- [react-native-vision-camera](https://mrousavy.com/react-native-vision-camera/) - Camera and OCR
- [react-native-nfc-manager](https://github.com/revtel/react-native-nfc-manager) - NFC access
- [@rarimo/rarime-rn-sdk](https://github.com/rarimo/rarime-rn-sdk) - Zero-knowledge identity

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)
