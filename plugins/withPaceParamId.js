const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Send the PACE domain-parameter id (tag 0x84) in MSE:Set AT for CAN scans.
//
// A French CNIe announces TWO PACEInfos in EF.CardAccess (Generic Mapping and
// Integrated Mapping, both parameterId 13 = brainpoolP256r1, AES-256). BSI
// TR-03110-3 B.1 requires MSE:Set AT to name the domain parameters (tag 0x84)
// whenever the card announces several. The pinned NFCPassportReader fork sends
// only the OID (0x80) and the password reference (0x83). JMRTD (our Android
// path) emits 0x84 when handed a parameterId, and the from-scratch Kotlin
// reader that reads a real CNIe by CAN (github.com/megamart14/cnie-can-reader)
// sends it unconditionally.
//
// The MRZ path works in the field without 0x84, so the tag is added ONLY when
// the CAN key reference is in use: existing MRZ / passport scans stay
// byte-identical to before this plugin.
//
// ios/ is gitignored → EAS runs `expo prebuild` on every build, so this must
// be a config plugin: the patch is injected into the Podfile post_install hook
// and applied to the pod source at `pod install` time (after the pod is
// fetched). Same mechanism as withPaceCanFix.js / withPaceAuthHeartbeat.js.
//
// If the pinned pod commit is ever bumped, re-verify the anchors below:
//   node --test plugins/__tests__/withPaceParamId.test.js
// runs this exact Ruby snippet against the local ios/Pods checkout.

const MARKER = "withPaceParamId";

// TagReader.swift — the MSE:Set AT builder gains an optional parameterId.
const TAGREADER_OLD_SIG =
  "func sendMSESetATMutualAuth( oid: String, keyType: UInt8 ) async throws -> ResponseAPDU {";
const TAGREADER_NEW_SIG =
  "func sendMSESetATMutualAuth( oid: String, keyType: UInt8, paramId: UInt8? = nil ) async throws -> ResponseAPDU {";
const TAGREADER_OLD_DATA = "let data = oidBytes + keyTypeBytes";
const TAGREADER_NEW_DATA =
  "let data = oidBytes + keyTypeBytes + (paramId.map { wrapDO( b: 0x84, arr:[$0]) } ?? [])";

// PACEHandler.swift — the single call site; forwards the id only for the CAN.
const PACE_OLD_CALL =
  "_ = try await tagReader.sendMSESetATMutualAuth(oid: paceOID, keyType: paceKeyType)";
const PACE_NEW_CALL =
  "_ = try await tagReader.sendMSESetATMutualAuth(oid: paceOID, keyType: paceKeyType, paramId: paceKeyType == PACEHandler.CAN_PACE_KEY_REFERENCE ? paceInfo.getParameterId().map { UInt8(clamping: $0) } : nil)";

const PATCH_SNIPPET = `
    # ${MARKER}: send the PACE parameterId (tag 0x84) in MSE:Set AT for CAN scans (TR-03110-3 B.1).
    tag_reader = File.join(installer.sandbox.root, 'NFCPassportReader', 'Sources', 'NFCPassportReader', 'TagReader.swift')
    if File.exist?(tag_reader)
      src = File.read(tag_reader)
      if src.include?('${TAGREADER_OLD_SIG}') && src.include?('${TAGREADER_OLD_DATA}') && !src.include?('paramId')
        src = src.sub('${TAGREADER_OLD_SIG}', '${TAGREADER_NEW_SIG}').sub('${TAGREADER_OLD_DATA}', '${TAGREADER_NEW_DATA}')
        File.write(tag_reader, src)
        Pod::UI.puts "[${MARKER}] patched TagReader.swift MSE:Set AT (optional 0x84 parameterId)"
      end
    end
    pace_handler = File.join(installer.sandbox.root, 'NFCPassportReader', 'Sources', 'NFCPassportReader', 'PACEHandler.swift')
    if File.exist?(pace_handler)
      src = File.read(pace_handler)
      if src.include?('${PACE_OLD_CALL}') && !src.include?('paramId:')
        src = src.sub('${PACE_OLD_CALL}', '${PACE_NEW_CALL}')
        File.write(pace_handler, src)
        Pod::UI.puts "[${MARKER}] patched PACEHandler.swift (parameterId forwarded for the CAN key)"
      end
    end
`;

// Pure, testable half: inject the snippet into a Podfile's post_install block.
function patchPodfile(contents) {
  if (contents.includes(MARKER)) return contents; // idempotent
  const anchor = "post_install do |installer|";
  if (!contents.includes(anchor)) {
    console.warn(
      `[${MARKER}] no post_install block found in Podfile — 0x84 parameterId patch NOT applied`
    );
    return contents;
  }
  return contents.replace(anchor, `${anchor}\n${PATCH_SNIPPET}`);
}

const withPaceParamId = (config) =>
  withDangerousMod(config, [
    "ios",
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, "Podfile");
      const contents = fs.readFileSync(podfile, "utf8");
      const patched = patchPodfile(contents);
      if (patched !== contents) fs.writeFileSync(podfile, patched);
      return config;
    },
  ]);

withPaceParamId.patchPodfile = patchPodfile;
withPaceParamId.MARKER = MARKER;
withPaceParamId.PATCH_SNIPPET = PATCH_SNIPPET;

module.exports = withPaceParamId;
