#!/usr/bin/env bash
#
# Mirror of the `Android Release (signed APK)` GitHub Actions workflow, but
# runnable locally. Lets you smoke-test the signing pipeline without cutting
# a tag.
#
# Usage (run from anywhere; the script `cd`s to the repo root):
#
#   ./scripts/ci/build-signed-apk-local.sh
#
# Reads the keystore from ~/.android-signing-keystores/referendum-citoyen-upload.keystore
# (the path the generator script creates). Prompts for the keystore password
# interactively — never on the command line, never in shell history.
#
# Output: dist/referendum-citoyen-<version>-local.apk + .sha256

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

KEYSTORE_FILE="${HOME}/.android-signing-keystores/referendum-citoyen-upload.keystore"
ALIAS="referendum-upload"
OUTPUT_DIR="$REPO_ROOT/dist"

# ---- preflight ------------------------------------------------------------

if [ ! -f "$KEYSTORE_FILE" ]; then
  echo "Error: keystore not found at $KEYSTORE_FILE" >&2
  echo "Run ./scripts/ci/generate-upload-keystore.sh first." >&2
  exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
  echo "Error: keytool not found in PATH (install JDK 17+)." >&2
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Android/Sdk" ]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
  echo "Using ANDROID_HOME=$ANDROID_HOME"
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  echo "Error: ANDROID_HOME is not set and ~/Android/Sdk doesn't exist." >&2
  exit 1
fi

# Locate apksigner under build-tools (newest version wins). Need PATH so
# the verify step at the end finds it.
APKSIGNER="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -name apksigner -executable 2>/dev/null | sort | tail -n 1)"
if [ -z "$APKSIGNER" ]; then
  echo "Error: apksigner not found under $ANDROID_HOME/build-tools" >&2
  exit 1
fi

VERSION="$(grep -E "^\s+version:\s+'" app.config.ts | head -1 | sed -E "s/.*version:\s+'([^']+)'.*/\1/")"
if [ -z "$VERSION" ]; then VERSION="local"; fi
echo "App version (from app.config.ts): $VERSION"

# ---- password ------------------------------------------------------------

read -rsp "Keystore password: " STORE_PW
echo
if [ ${#STORE_PW} -lt 8 ]; then
  echo "Error: empty/short password." >&2
  exit 1
fi

# Quick verify the password matches the keystore BEFORE we spend 5 min on
# a release build that would fail at the very end with a useless error.
export __KEYTOOL_PW="$STORE_PW"
if ! keytool -list -keystore "$KEYSTORE_FILE" -alias "$ALIAS" \
       -storepass:env __KEYTOOL_PW >/dev/null 2>&1; then
  unset STORE_PW __KEYTOOL_PW
  echo "Error: password does not unlock $KEYSTORE_FILE — aborting." >&2
  exit 1
fi
unset __KEYTOOL_PW
echo "Keystore password verified."

# ---- prebuild + patch ----------------------------------------------------

echo
echo "==> Building withNfc plugin"
(cd plugins/withNfc.plugin && npm install --no-audit --no-fund --ignore-scripts >/dev/null 2>&1 && npx tsc)

echo
echo "==> Running expo prebuild (--clean) — regenerates android/"
EXPO_NO_TELEMETRY=1 EXPO_NO_CAPABILITY_SYNC=1 \
  npx expo prebuild --platform android --clean --no-install

echo
echo "==> Injecting release signing config into android/app/build.gradle"
node scripts/ci/inject-android-signing.mjs

chmod +x android/gradlew

# ---- build ---------------------------------------------------------------

echo
echo "==> Building release APK (assembleRelease)"
echo "    This takes 5–10 minutes on a fresh checkout."

# Scope the password env vars to the gradlew subprocess. Don't `export` them
# to the parent shell.
(
  cd android
  REFCIT_RELEASE_STORE_FILE="$KEYSTORE_FILE" \
  REFCIT_RELEASE_STORE_PASSWORD="$STORE_PW" \
  REFCIT_RELEASE_KEY_ALIAS="$ALIAS" \
  REFCIT_RELEASE_KEY_PASSWORD="$STORE_PW" \
    ./gradlew assembleRelease --no-daemon --stacktrace
)

unset STORE_PW

# ---- locate + verify + checksum ------------------------------------------

APK_SRC="$(find android/app/build/outputs/apk/release -name "*.apk" | head -n 1)"
if [ -z "$APK_SRC" ] || [ ! -f "$APK_SRC" ]; then
  echo "Error: no APK found under android/app/build/outputs/apk/release/" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUT_NAME="referendum-citoyen-v${VERSION}-local.apk"
cp "$APK_SRC" "$OUTPUT_DIR/$OUT_NAME"
(cd "$OUTPUT_DIR" && sha256sum "$OUT_NAME" > "$OUT_NAME.sha256")

echo
echo "==> Verifying APK signature"
"$APKSIGNER" verify --verbose --print-certs "$OUTPUT_DIR/$OUT_NAME" \
  | tee "$OUTPUT_DIR/$OUT_NAME.apksigner-verify.txt"

echo
echo "=========================================================="
echo "Signed APK ready."
echo "  $OUTPUT_DIR/$OUT_NAME"
echo "  $OUTPUT_DIR/$OUT_NAME.sha256"
echo "  $OUTPUT_DIR/$OUT_NAME.apksigner-verify.txt"
echo
echo "Install on a connected device:"
echo "  adb install -r '$OUTPUT_DIR/$OUT_NAME'"
echo "=========================================================="
