const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Fix PACE-CAN authentication for French CNIe on iOS.
//
// The pinned NFCPassportReader fork derives the PACE key by ALWAYS running the
// password through SHA-1 (PACEHandler.createPaceKey → calcSHA1Hash(buf)). That
// is correct for the MRZ key (encoded password = SHA-1(MRZ information)) but
// WRONG for the CAN: per ICAO 9303-11 §9.7.2 the CAN octets are used directly,
// they are NOT hashed. JMRTD (our Android path) does the correct thing:
//   PACEKeySpec(can.toByteArray(US_ASCII), 0x02)
//
// Symptom: scanning a CNIe works when the CAN field is left EMPTY (MRZ-PACE
// path, correctly SHA-1'd) but fails the moment a CAN is entered — even the
// right CAN — because the derived key is KDF(SHA-1(CAN)) instead of KDF(CAN).
//
// This patches the one line to skip the SHA-1 for the CAN key reference.
//
// ios/ is gitignored → EAS runs `expo prebuild` on every build, so this must be
// a config plugin: the patch is injected into the Podfile post_install hook and
// applied to the pod source at `pod install` time (after the pod is fetched).

const MARKER = "withPaceCanFix";

const OLD_LINE = "let hash = calcSHA1Hash(buf)";
const NEW_LINE =
  "let hash = paceKeyType == PACEHandler.CAN_PACE_KEY_REFERENCE ? buf : calcSHA1Hash(buf)";

const PATCH_SNIPPET = `
    # ${MARKER}: CAN password must NOT be SHA-1'd (ICAO 9303-11 §9.7.2).
    pace_handler = File.join(installer.sandbox.root, 'NFCPassportReader', 'Sources', 'NFCPassportReader', 'PACEHandler.swift')
    if File.exist?(pace_handler)
      src = File.read(pace_handler)
      if src.include?('${OLD_LINE}') && !src.include?('${NEW_LINE}')
        src = src.sub('${OLD_LINE}', '${NEW_LINE}')
        File.write(pace_handler, src)
        Pod::UI.puts "[${MARKER}] patched PACEHandler.swift CAN key derivation"
      end
    end
`;

const withPaceCanFix = (config) =>
  withDangerousMod(config, [
    "ios",
    (config) => {
      const podfile = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let contents = fs.readFileSync(podfile, "utf8");

      if (contents.includes(MARKER)) {
        return config; // already patched — idempotent
      }

      const anchor = "post_install do |installer|";
      if (!contents.includes(anchor)) {
        console.warn(
          "[withPaceCanFix] no post_install block found in Podfile — CAN fix NOT applied"
        );
        return config;
      }

      contents = contents.replace(anchor, `${anchor}\n${PATCH_SNIPPET}`);
      fs.writeFileSync(podfile, contents);
      return config;
    },
  ]);

module.exports = withPaceCanFix;
