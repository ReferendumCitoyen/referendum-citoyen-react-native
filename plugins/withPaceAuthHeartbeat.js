const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Animate the PACE authentication bar on the iOS NFC system sheet.
//
// During the PACE handshake the NFCPassportReader pod reports NO progress
// (TagReader.progress only fires while reading data-group bytes, never during
// the auth APDUs), so it calls our customDisplayMessage exactly once with
// authenticatingWithPassport(0). Result: the system sheet looks frozen for the
// 1–3s the handshake takes ("nothing happens").
//
// Fix: inject a tiny heartbeat Task around doPACE that pushes
// authenticatingWithPassport(pct) every 250ms (pct ramps 10→90%), cancelled the
// instant PACE finishes. That drives EDocumentModule's continuous progress bar
// (see EDocumentModule.swift) so it actually animates instead of sitting at the
// same low value for the whole handshake.
//
// ios/ is gitignored → EAS re-runs `expo prebuild`, so this must be a config
// plugin applied in the Podfile post_install (after the pod is fetched).
//
// Fragility: same as any Podfile source-patch — this gsubs a specific line out
// of the pinned NFCPassportReader fork's PassportReader.swift. If the pinned
// pod commit in app.config.ts is ever bumped, re-verify the ANCHOR line below
// still exists verbatim in the new PassportReader.swift, or this silently
// stops applying (falls through the `if File.exist? ... && src.include?`
// guard rather than erroring).

const MARKER = 'withPaceAuthHeartbeat';

const ANCHOR = 'try await paceHandler.doPACE(mrzKey: mrzKey, can: self.canKey )';

const REPLACEMENT =
  "let paceHeartbeat = Task { [weak self] in var pct = 10; while !Task.isCancelled { self?.updateReaderSessionMessage(alertMessage: NFCViewDisplayMessage.authenticatingWithPassport(pct)); pct = min(90, pct + 7); try? await Task.sleep(nanoseconds: 250_000_000) } }; defer { paceHeartbeat.cancel() }; " +
  ANCHOR;

const PATCH_SNIPPET = `
    # ${MARKER}: animate the PACE auth bar (pod reports no progress during the handshake).
    pace_reader = File.join(installer.sandbox.root, 'NFCPassportReader', 'Sources', 'NFCPassportReader', 'PassportReader.swift')
    if File.exist?(pace_reader)
      src = File.read(pace_reader)
      if src.include?('${ANCHOR}') && !src.include?('paceHeartbeat')
        src = src.sub('${ANCHOR}', '${REPLACEMENT}')
        File.write(pace_reader, src)
        Pod::UI.puts "[${MARKER}] patched PassportReader.swift with PACE auth heartbeat"
      end
    end
`;

const withPaceAuthHeartbeat = (config) =>
  withDangerousMod(config, [
    'ios',
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');

      if (contents.includes(MARKER)) {
        return config; // already patched — idempotent
      }

      const anchor = 'post_install do |installer|';
      if (!contents.includes(anchor)) {
        console.warn('[withPaceAuthHeartbeat] no post_install block found in Podfile — heartbeat NOT applied');
        return config;
      }

      contents = contents.replace(anchor, `${anchor}\n${PATCH_SNIPPET}`);
      fs.writeFileSync(podfile, contents);
      return config;
    },
  ]);

module.exports = withPaceAuthHeartbeat;
