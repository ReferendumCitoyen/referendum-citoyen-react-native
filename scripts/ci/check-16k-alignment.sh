#!/usr/bin/env bash
#
# Audit every native .so in a built APK for 16 KB page-size alignment.
# Required for Android 15+ devices with 16 KB pages (Pixel 8+ developer
# option, GrapheneOS). Misaligned libs crash at System.loadLibrary().
#
# Usage:
#   ./scripts/ci/check-16k-alignment.sh [path/to/app.apk]
#
# Default APK: dist/referendum-citoyen-v<version>-local.apk
# Exit code: 0 if all libs aligned (or only in the documented allowlist of
# upstream-blocked libs), 1 if a new misalignment slipped in.
#
# Reference: https://developer.android.com/guide/practices/page-sizes

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

APK="${1:-}"
if [ -z "$APK" ]; then
  APK=$(ls -1t dist/referendum-citoyen-v*-local.apk 2>/dev/null | head -1)
fi
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "Error: no APK found. Pass a path or build via scripts/ci/build-signed-apk-local.sh." >&2
  exit 1
fi
echo "Auditing $APK"

# .so files known to be misaligned upstream. Tracked separately so a new
# misalignment from OUR builds fails CI even while these upstream blockers
# remain. Remove an entry once upstream ships a 16 KB-aligned version.
declare -a EXPECTED_MISALIGNED=(
  # @rarimo/rarime-rn-sdk 0.3.1 — bundled noir.aar. No newer SDK published.
  "lib/arm64-v8a/libnoir_java.so"
  # rarimo/rarime-android-app prebuilt witnesscalc binaries (RmoCalcs.aar +
  # raw jniLibs). No 16 KB-aligned upstream release yet.
  "lib/arm64-v8a/libRmoCalcs.so"
  "lib/arm64-v8a/libwitnesscalc_auth.so"
  "lib/arm64-v8a/libwitnesscalc_queryIdentity.so"
  "lib/arm64-v8a/libwitnesscalc_registerIdentityUniversalRSA2048.so"
  "lib/arm64-v8a/libwitnesscalc_registerIdentityUniversalRSA4096.so"
)

is_allowlisted() {
  local name="$1"
  for entry in "${EXPECTED_MISALIGNED[@]}"; do
    if [ "$entry" = "$name" ]; then return 0; fi
  done
  return 1
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q "$APK" 'lib/arm64-v8a/*' -d "$TMP"

unexpected_misaligned=()
allowlisted_misaligned=()
aligned_count=0

for so in "$TMP"/lib/arm64-v8a/*.so; do
  rel="lib/arm64-v8a/$(basename "$so")"
  # Each LOAD segment's Align column must be ≥ 0x4000 (16384) for the kernel
  # to map it on a 16 KB-paged system.
  worst=$(readelf -lW "$so" 2>/dev/null | awk '/LOAD/ {print $NF}' | sort -u | awk 'BEGIN{m=999999} {v=strtonum($1); if (v<m) m=v} END{print m}')
  if [ "$worst" -ge 16384 ]; then
    aligned_count=$((aligned_count+1))
    continue
  fi
  if is_allowlisted "$rel"; then
    allowlisted_misaligned+=("$rel (align=$(printf '0x%x' "$worst"))")
  else
    unexpected_misaligned+=("$rel (align=$(printf '0x%x' "$worst"))")
  fi
done

echo
echo "=========================================================="
echo "16 KB alignment audit"
echo "  Aligned (LOAD ≥ 0x4000):       $aligned_count"
echo "  Misaligned (allowlisted):      ${#allowlisted_misaligned[@]}"
echo "  Misaligned (UNEXPECTED):       ${#unexpected_misaligned[@]}"
echo

if [ ${#allowlisted_misaligned[@]} -gt 0 ]; then
  echo "Allowlisted upstream-blocked libs:"
  for e in "${allowlisted_misaligned[@]}"; do echo "  - $e"; done
  echo
fi

if [ ${#unexpected_misaligned[@]} -gt 0 ]; then
  echo "NEW misalignments — investigate (likely a flag was dropped or a"
  echo "dep was downgraded):"
  for e in "${unexpected_misaligned[@]}"; do echo "  - $e"; done
  echo "=========================================================="
  exit 1
fi

echo "OK — no new misalignments introduced."
echo "=========================================================="
