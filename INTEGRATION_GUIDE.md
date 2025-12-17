# Rarime Rust SDK - React Native Integration Guide

## 🎯 Purpose
This SDK enables privacy-preserving identity verification using zero-knowledge proofs for passport-based authentication in React Native apps.

## ⚠️ IMPORTANT: Privacy & Security Requirements

### What This SDK Does
- ✅ Generates ZK proofs **100% locally** on device
- ✅ **NO personal data leaves the device** (DG1, DG15, SOD stay local)
- ✅ Only cryptographic proofs are submitted to blockchain
- ✅ Private keys remain on user's device

### External Services Called
| Service | Purpose | Data Sent | Safe? |
|---------|---------|-----------|-------|
| Blockchain RPC | Read contract state | None (read-only) | ✅ YES |
| Smart Contract | Submit vote proof | ZK proof bytes only | ✅ YES |

### ❌ Functions to AVOID (Privacy-Violating)
- `light_registration()` - Calls external Rarimo API, sends passport data
- `verify_sod()` - Sends SOD/DG15 to centralized service

### ✅ Functions to USE (Privacy-Preserving)
- `generate_bjj_private_key()` - 100% local
- `get_profile_key()` - 100% local
- `get_document_status()` - Only reads from blockchain
- `generate_query_proof()` - Local computation + blockchain reads

---

## 📦 Integration Steps

### Prerequisites
- Rust toolchain installed: https://rustup.rs/
- Android NDK (for Android builds)
- Xcode command line tools (for iOS builds)
- Node.js and npm

### Step 1: Build Rust Libraries for Mobile

Open terminal in **THIS directory** (`rarime-rust-sdk/`):

```bash
# Install mobile targets (one-time setup)
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

# Install cargo-ndk for Android (one-time setup)
cargo install cargo-ndk

# Build for iOS (all architectures)
echo "🍎 Building for iOS..."
cargo build --release --target aarch64-apple-ios           # Device
cargo build --release --target aarch64-apple-ios-sim       # Simulator (ARM)
cargo build --release --target x86_64-apple-ios            # Simulator (Intel)

# Build for Android (all architectures)
echo "🤖 Building for Android..."
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o ./jniLibs build --release

echo "✅ Rust libraries built!"
```

**Output locations:**
- iOS: `target/aarch64-apple-ios/release/librarime_rust_sdk.a`
- Android: `jniLibs/arm64-v8a/librarime_rust_sdk.so`

---

### Step 2: Generate React Native Module

**Still in THIS directory** (`rarime-rust-sdk/`):

```bash
# Generate the entire Expo module automatically
npx uniffi-bindgen-react-native \
  --udl rarime_rust_sdk.udl \
  --out-dir ../referendum-citoyen/modules/rarime-sdk \
  --crate-name rarime_rust_sdk \
  --ios-framework-name RarimeRustSDK

echo "✅ Module generated at: ../referendum-citoyen/modules/rarime-sdk/"
```

This auto-generates:
- `referendum-citoyen/modules/rarime-sdk/android/` - Kotlin wrapper
- `referendum-citoyen/modules/rarime-sdk/ios/` - Swift wrapper
- `referendum-citoyen/modules/rarime-sdk/index.ts` - TypeScript types

---

### Step 3: Copy Native Libraries

**Still in THIS directory** (`rarime-rust-sdk/`):

```bash
# Copy iOS libraries
mkdir -p ../referendum-citoyen/modules/rarime-sdk/ios/libs
cp target/aarch64-apple-ios/release/librarime_rust_sdk.a \
   ../referendum-citoyen/modules/rarime-sdk/ios/libs/
cp target/x86_64-apple-ios/release/librarime_rust_sdk.a \
   ../referendum-citoyen/modules/rarime-sdk/ios/libs/librarime_rust_sdk_simulator.a
cp target/aarch64-apple-ios-sim/release/librarime_rust_sdk.a \
   ../referendum-citoyen/modules/rarime-sdk/ios/libs/librarime_rust_sdk_sim_arm64.a

# Copy Android libraries
cp -r jniLibs ../referendum-citoyen/modules/rarime-sdk/android/src/main/

echo "✅ Libraries copied!"
```

---

### Step 4: Setup Frontend App

**Switch to frontend directory:**

```bash
cd ../referendum-citoyen

# Clean build cache
rm -rf ios/build android/build node_modules/.cache

# Rebuild native modules
npx expo prebuild --clean

# Install iOS pods
cd ios && pod install && cd ..

echo "✅ Frontend setup complete!"
```

---

### Step 5: Run Your App

**In frontend directory** (`referendum-citoyen/`):

```bash
# Run on iOS
npm run ios

# Or run on Android
npm run android
```

---

## 🔧 Complete Setup Script

Save this as `setup-rarime.sh` in the parent directory:

```bash
#!/bin/bash
# Run from: /Users/chanedward/Desktop/fun-projects/

set -e  # Exit on error

echo "🦀 Building Rust SDK for mobile..."
cd rarime-rust-sdk

# Install targets (skip if already installed)
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim 2>/dev/null || true
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android 2>/dev/null || true

# Build
cargo build --release --target aarch64-apple-ios
cargo build --release --target aarch64-apple-ios-sim
cargo build --release --target x86_64-apple-ios
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o ./jniLibs build --release

echo ""
echo "🔗 Generating React Native module..."
npx uniffi-bindgen-react-native \
  --udl rarime_rust_sdk.udl \
  --out-dir ../referendum-citoyen/modules/rarime-sdk \
  --crate-name rarime_rust_sdk \
  --ios-framework-name RarimeRustSDK

echo ""
echo "📦 Copying native libraries..."
mkdir -p ../referendum-citoyen/modules/rarime-sdk/ios/libs
cp target/aarch64-apple-ios/release/librarime_rust_sdk.a \
   ../referendum-citoyen/modules/rarime-sdk/ios/libs/
cp target/x86_64-apple-ios/release/librarime_rust_sdk.a \
   ../referendum-citoyen/modules/rarime-sdk/ios/libs/librarime_rust_sdk_simulator.a
cp target/aarch64-apple-ios-sim/release/librarime_rust_sdk.a \
   ../referendum-citoyen/modules/rarime-sdk/ios/libs/librarime_rust_sdk_sim_arm64.a
cp -r jniLibs ../referendum-citoyen/modules/rarime-sdk/android/src/main/

echo ""
echo "🔨 Setting up frontend app..."
cd ../referendum-citoyen
rm -rf ios/build android/build node_modules/.cache
npx expo prebuild --clean
cd ios && pod install && cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "To run your app:"
echo "  cd referendum-citoyen"
echo "  npm run ios    # or npm run android"
```

---

## 📱 Usage in React Native App

### Import the SDK

```typescript
// app/(tabs)/index.tsx
import { Rarime, RarimeUtils, type RarimePassport } from '@/modules/rarime-sdk'
```

### Initialize SDK

```typescript
const initRarime = async () => {
  // Generate private key (do this once, store securely)
  const privateKey = await RarimeUtils.generateBjjPrivateKey()

  const rarime = new Rarime({
    contractsConfiguration: {
      stateKeeperContractAddress: "0x9EDADB216C1971cf0343b8C687cF76E7102584DB",
      registerContractAddress: "0xd63782478CA40b587785700Ce49248775398b045",
      poseidonSmtAddress: "0xF19a85B10d705Ed3bAF3c0eCe3E73d8077Bf6481"
    },
    apiConfiguration: {
      jsonRpcEvmUrl: "https://rpc.evm.mainnet.rarimo.com",  // Public RPC only
      rarimeApiUrl: ""  // Not used for privacy reasons
    },
    userConfiguration: {
      userPrivateKey: privateKey
    }
  })

  return rarime
}
```

### Check if Already Voted

```typescript
// After NFC scan (using e-document module)
import { scanDocument } from '@/modules/e-document'

const handleNFCScan = async (nfcData) => {
  // Convert e-document data to Rarimo format
  const passport: RarimePassport = {
    data_group1: nfcData.dg1Bytes,
    data_group15: nfcData.dg15Bytes,
    aa_signature: nfcData.aaSignature,
    aa_challenge: null,
    sod: nfcData.sodBytes
  }

  // Check registration status (reads from blockchain only)
  const status = await rarime.getDocumentStatus(passport)

  if (status === 'RegisteredWithThisPk') {
    // Already voted - show error
    setVerificationResult('error')
  } else {
    // Can vote - proceed
    setVerificationResult('success')
    setPassportData(passport)
  }
}
```

### Generate ZK Proof and Vote

```typescript
const handleVote = async (voteChoice: 'oui' | 'non' | 'blanc') => {
  try {
    // 1. Generate proof locally (takes ~5 seconds)
    const proof = await rarime.generateQueryProof(passportData, {
      eventId: currentVote.id,
      eventData: ethers.utils.id(voteChoice),
      selector: '3072',
      timestampLowerbound: '0',
      timestampUpperbound: String(Date.now()),
      identityCountLowerbound: '0',
      identityCountUpperbound: '1',  // Prevent double voting
      birthDateLowerbound: getMinAge(18),  // 18+ only
      birthDateUpperbound: '0x303030303030',
      expirationDateLowerbound: getTodayDate(),
      expirationDateUpperbound: '0x303030303030',
      citizenshipMask: '0x01'  // French citizens only
    })

    // 2. Submit proof directly to YOUR smart contract
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
    const votingContract = new ethers.Contract(
      VOTING_CONTRACT_ADDRESS,
      VOTING_ABI,
      provider
    )

    const tx = await votingContract.submitVote(proof, voteChoice)
    await tx.wait()

    setVoteSubmissionResult('success')
  } catch (error) {
    console.error('Vote failed:', error)
    setVoteSubmissionResult('error')
  }
}
```

---

## 🔄 Update Workflow

When you modify the Rust SDK:

```bash
# 1. In rarime-rust-sdk/: Edit Rust code
vim src/lib.rs

# 2. Rebuild
cargo build --release --target aarch64-apple-ios
cargo ndk -t arm64-v8a build --release

# 3. Regenerate module
npx uniffi-bindgen-react-native \
  --udl rarime_rust_sdk.udl \
  --out-dir ../referendum-citoyen/modules/rarime-sdk \
  --crate-name rarime_rust_sdk

# 4. Copy libraries (repeat Step 3)

# 5. Rebuild app
cd ../referendum-citoyen
npm run ios
```

---

## 🗂️ Project Structure

```
/Users/chanedward/Desktop/fun-projects/
├── rarime-rust-sdk/                    ← THIS REPO
│   ├── src/
│   │   ├── lib.rs                      ← Main SDK code
│   │   ├── document.rs                 ← Passport parsing
│   │   ├── proofs/                     ← ZK proof generation
│   │   └── contracts/                  ← Blockchain interaction
│   ├── target/                         ← Rust build output
│   ├── jniLibs/                        ← Android libraries
│   ├── Cargo.toml                      ← Rust dependencies
│   ├── rarime_rust_sdk.udl             ← UniFFI interface definition
│   └── INTEGRATION_GUIDE.md            ← This file
│
└── referendum-citoyen/                 ← FRONTEND APP
    ├── app/                            ← Your React Native screens
    ├── components/                     ← Your React components
    └── modules/
        ├── e-document/                 ← Existing NFC module
        └── rarime-sdk/                 ← GENERATED (don't edit!)
            ├── android/                ← Auto-generated Kotlin
            ├── ios/                    ← Auto-generated Swift
            └── index.ts                ← Auto-generated TypeScript
```

---

## 🐛 Troubleshooting

### "uniffi-bindgen-react-native not found"
```bash
# Install globally
npm install -g uniffi-bindgen-react-native

# Or use npx (no install needed)
npx uniffi-bindgen-react-native --version
```

### "cargo-ndk not found"
```bash
cargo install cargo-ndk
```

### "Android NDK not found"
Install Android Studio, then:
- Open Android Studio → Preferences → Appearance & Behavior → System Settings → Android SDK
- SDK Tools tab → Check "NDK (Side by side)"
- Set ANDROID_NDK_HOME environment variable

### iOS build fails
```bash
# Install Xcode command line tools
xcode-select --install

# Clean and rebuild
cd referendum-citoyen
rm -rf ios/Pods ios/build
cd ios && pod install && cd ..
npm run ios
```

### Module not found in app
```bash
# Rebuild native code
cd referendum-citoyen
npx expo prebuild --clean
npm run ios  # or npm run android
```

---

## 📊 Build Times

- **First Rust build**: 10-15 minutes (downloads dependencies)
- **Incremental builds**: 2-3 minutes
- **Module generation**: 10-30 seconds
- **App rebuild**: 2-5 minutes

---

## 🔐 Security Notes

1. **Private keys**: Never log or transmit private keys
2. **Passport data**: Stays on device, never sent to any server
3. **Only proof bytes** are transmitted to blockchain
4. **Blockchain RPC**: Only read operations for public data
5. **No external APIs**: Avoid `light_registration()` and `verify_sod()`

---

## 📞 Support

- Rust SDK: https://github.com/rarimo/rarime-rust-sdk
- UniFFI: https://mozilla.github.io/uniffi-rs/
- Expo Modules: https://docs.expo.dev/modules/

---

## ✅ Quick Reference

| Command | Location | Purpose |
|---------|----------|---------|
| `cargo build --release` | `rarime-rust-sdk/` | Build Rust libraries |
| `npx uniffi-bindgen-react-native` | `rarime-rust-sdk/` | Generate RN module |
| `npm run ios` | `referendum-citoyen/` | Run app on iOS |
| `npm run android` | `referendum-citoyen/` | Run app on Android |

---

**Last Updated**: 2025-01-11
