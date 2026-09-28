const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Expose a way to cancel an in-flight NFC read from outside PassportReader.
//
// PassportReader keeps its NFCTagReaderSession in a private property
// (`private var readerSession: NFCTagReaderSession?`) with no public
// cancel/invalidate method, so EDocumentModule's disableScan has nothing to
// call to release a stuck session (e.g. after Step6's scan timeout fires).
// The class already does the invalidate-and-clear dance internally, in its
// own tagReaderSession(_:didInvalidateWithError:) delegate method
// (`self.readerSession?.invalidate(); self.readerSession = nil`) — this
// just exposes that same pattern as a public method EDocumentModule can call.
//
// ios/ is gitignored → EAS re-runs `expo prebuild`, so this must be a config
// plugin applied in the Podfile post_install (after the pod is fetched).
//
// Fragility: same as any Podfile source-patch — this subs a specific line
// out of the pinned NFCPassportReader fork's PassportReader.swift. If the
// pinned pod commit in app.config.ts is ever bumped, re-verify the ANCHOR
// line below still exists verbatim in the new PassportReader.swift, or this
// silently stops applying (falls through the `if File.exist? ... &&
// src.include?` guard rather than erroring).

const MARKER = 'withCancelReading';

const ANCHOR =
  '    func invalidateSession(errorMessage: NFCViewDisplayMessage, error: NFCPassportReaderError) {';

const REPLACEMENT =
  '    public func cancelReading() {\n' +
  '        self.readerSession?.invalidate()\n' +
  '        self.readerSession = nil\n' +
  '    }\n\n' +
  ANCHOR;

const PATCH_SNIPPET = `
    # ${MARKER}: expose a public cancelReading() so EDocumentModule can release an in-flight NFC session (e.g. on scan timeout).
    cancel_reader = File.join(installer.sandbox.root, 'NFCPassportReader', 'Sources', 'NFCPassportReader', 'PassportReader.swift')
    if File.exist?(cancel_reader)
      src = File.read(cancel_reader)
      if src.include?('${ANCHOR}') && !src.include?('cancelReading')
        src = src.sub('${ANCHOR}', '${REPLACEMENT}')
        File.write(cancel_reader, src)
        Pod::UI.puts "[${MARKER}] patched PassportReader.swift with public cancelReading()"
      end
    end
`;

const withCancelReading = (config) =>
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
        console.warn('[withCancelReading] no post_install block found in Podfile — cancelReading NOT applied');
        return config;
      }

      contents = contents.replace(anchor, `${anchor}\n${PATCH_SNIPPET}`);
      fs.writeFileSync(podfile, contents);
      return config;
    },
  ]);

module.exports = withCancelReading;
