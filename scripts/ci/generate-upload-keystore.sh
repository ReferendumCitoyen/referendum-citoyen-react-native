#!/usr/bin/env bash
#
# Interactive helper that generates the Android upload keystore for this app
# and optionally pushes the four required secrets to GitHub via the `gh` CLI.
#
# Usage (run from anywhere, but typically the repo root):
#
#   ./scripts/ci/generate-upload-keystore.sh
#
# The script:
#   1. Prompts for a strong password (twice, never echoed, no flag-arg leakage)
#   2. Generates a 4096-bit RSA keystore valid for ~68 years
#   3. Stores it at ~/.android-signing-keystores/referendum-citoyen-upload.keystore
#      (mode 600, outside the repo)
#   4. Base64-encodes it alongside for the GitHub secret
#   5. If `gh` is installed and authenticated, offers to push all four secrets
#      to the current repo's Actions secrets.
#
# CRITICAL: back up the .keystore file (and the password) to a password manager
# or encrypted vault. Losing them locks you out of publishing updates with the
# same signing identity FOREVER — Google Play and direct-install users will
# reject re-signed APKs.

set -euo pipefail

KEYSTORE_DIR="${HOME}/.android-signing-keystores"
KEYSTORE_FILE="${KEYSTORE_DIR}/referendum-citoyen-upload.keystore"
KEYSTORE_B64="${KEYSTORE_FILE}.b64"
ALIAS="referendum-upload"
DNAME="CN=Referendum Citoyen, OU=Releases, O=Referendum Citoyen, L=Paris, C=FR"
VALIDITY_DAYS=25000   # ≈ 68 years; Google Play requires ≥ 25 years from now

# ---- preflight ------------------------------------------------------------

if ! command -v keytool >/dev/null 2>&1; then
  echo "Error: keytool not found in PATH." >&2
  echo "Install a JDK 17+ (apt install temurin-17-jdk, or via brew/sdkman)." >&2
  exit 1
fi

if [ -e "$KEYSTORE_FILE" ]; then
  echo "Error: $KEYSTORE_FILE already exists." >&2
  echo "Refusing to overwrite — move or rename it if you really want a new one." >&2
  exit 1
fi

mkdir -p "$KEYSTORE_DIR"
chmod 700 "$KEYSTORE_DIR"

# ---- password capture (no echo, no history, no process-listing leak) ------

echo "Generating Android upload keystore."
echo "  Location: $KEYSTORE_FILE"
echo "  Alias:    $ALIAS"
echo "  Subject:  $DNAME"
echo
echo "You'll be asked for a password. Use one from your password manager."
echo "The keystore password and the key password are the same here (modern"
echo "Android practice — KeyStore-level encryption is what protects both)."
echo

read -rsp "Keystore password: " STORE_PW
echo
read -rsp "Confirm password:  " STORE_PW_CONFIRM
echo
if [ "$STORE_PW" != "$STORE_PW_CONFIRM" ]; then
  echo "Error: passwords do not match." >&2
  exit 1
fi
if [ ${#STORE_PW} -lt 12 ]; then
  echo "Error: password is shorter than 12 chars. Pick a stronger one." >&2
  exit 1
fi
unset STORE_PW_CONFIRM

# Pass to keytool via env, scoped to the keytool subprocess only.
# `-storepass:env` reads from the named env var (not from the command line,
# so it won't show up in /proc/<pid>/cmdline or `ps aux`).
export __KEYTOOL_PW="$STORE_PW"

# ---- generate -------------------------------------------------------------

keytool -genkeypair -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 \
  -validity "$VALIDITY_DAYS" \
  -storetype PKCS12 \
  -storepass:env __KEYTOOL_PW \
  -keypass:env  __KEYTOOL_PW \
  -dname "$DNAME"

chmod 600 "$KEYSTORE_FILE"

# Base64 for the GH secret. -w0 = no line wrapping; required for GH secret input.
base64 -w0 "$KEYSTORE_FILE" > "$KEYSTORE_B64"
chmod 600 "$KEYSTORE_B64"

echo
echo "=========================================================="
echo "Keystore generated."
echo "  .keystore: $KEYSTORE_FILE"
echo "  .b64:      $KEYSTORE_B64"
echo
echo "Certificate fingerprint (record this in your release notes / 1Password):"
keytool -list -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$ALIAS" \
  -storepass:env __KEYTOOL_PW 2>/dev/null \
  | grep -E "^\s+SHA(1|256):" || true
echo

# ---- optional: push secrets to GitHub via gh CLI --------------------------

PUSH_TO_GH="no"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo '')"
  if [ -n "$REPO_SLUG" ]; then
    echo "gh CLI is authenticated, current repo: $REPO_SLUG"
    read -rp "Push the four secrets to $REPO_SLUG's Actions secrets now? [y/N] " yn
    case "$yn" in
      [yY]|[yY][eE][sS]) PUSH_TO_GH="yes" ;;
    esac
  fi
fi

if [ "$PUSH_TO_GH" = "yes" ]; then
  echo "Pushing secrets to $REPO_SLUG..."
  gh secret set ANDROID_KEYSTORE_BASE64    --repo "$REPO_SLUG" --body "$(cat "$KEYSTORE_B64")"
  gh secret set ANDROID_KEY_ALIAS          --repo "$REPO_SLUG" --body "$ALIAS"
  gh secret set ANDROID_KEYSTORE_PASSWORD  --repo "$REPO_SLUG" --body "$STORE_PW"
  gh secret set ANDROID_KEY_PASSWORD       --repo "$REPO_SLUG" --body "$STORE_PW"
  echo "Done. Verify in GitHub → Settings → Secrets and variables → Actions."
else
  echo "Skipped pushing to GitHub. Set the four secrets manually:"
  echo "  ANDROID_KEYSTORE_BASE64    = (contents of $KEYSTORE_B64)"
  echo "  ANDROID_KEY_ALIAS          = $ALIAS"
  echo "  ANDROID_KEYSTORE_PASSWORD  = (the password you just chose)"
  echo "  ANDROID_KEY_PASSWORD       = (same as above)"
  echo
  echo "GitHub UI: Settings → Secrets and variables → Actions → New secret."
  echo "Or with the gh CLI (after auth):"
  echo "  gh secret set ANDROID_KEYSTORE_BASE64 < $KEYSTORE_B64"
fi

unset STORE_PW __KEYTOOL_PW

echo
echo "Next: back up $KEYSTORE_FILE to your password manager / encrypted vault."
echo "Then delete $KEYSTORE_B64 — you only need it for the one-time secret push:"
echo "  shred -u $KEYSTORE_B64"
echo "=========================================================="
