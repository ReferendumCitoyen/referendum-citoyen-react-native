import Foundation
import CoreNFC

/// Standalone NFC diagnostic that bypasses NFCPassportReader entirely.
/// Probes tag detection, AID selection, and CardAccess to diagnose
/// why French CNIe is not detected on iOS.
@available(iOS 13.0, *)
class NfcDiagnostic: NSObject, NFCTagReaderSessionDelegate {

    private var session: NFCTagReaderSession?
    private var continuation: CheckedContinuation<[String: Any], Error>?
    private var logs: [String] = []
    private var timeoutSeconds: Double = 30

    private let eMRTD_AID: [UInt8]  = [0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01]
    private let french_AID: [UInt8] = [0xA0, 0x00, 0x00, 0x01, 0x51, 0x00, 0x00]
    private let masterFile: [UInt8] = [0x3F, 0x00]

    // EF.CardAccess file ID = 011C
    private let efCardAccess: [UInt8] = [0x01, 0x1C]

    func run(timeoutSeconds: Double) async throws -> [String: Any] {
        self.timeoutSeconds = timeoutSeconds

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            self.logs = []
            self.log("=== NFC Diagnostic Start ===")
            self.log("Timeout: \(timeoutSeconds)s")

            guard NFCTagReaderSession.readingAvailable else {
                self.log("[ERROR] NFC reading not available on this device")
                let result = self.buildResult(tagDetected: false, tags: [], aidProbes: [], cardAccessProbe: nil)
                continuation.resume(returning: result)
                return
            }

            self.session = NFCTagReaderSession(
                pollingOption: [.iso14443],
                delegate: self,
                queue: DispatchQueue.global(qos: .userInitiated)
            )
            self.session?.alertMessage = "Approchez votre carte d'identite pour le diagnostic NFC..."
            self.session?.begin()
            self.log("Session started, polling .iso14443")

            // Timeout
            DispatchQueue.global().asyncAfter(deadline: .now() + timeoutSeconds) { [weak self] in
                guard let self = self, let cont = self.continuation else { return }
                self.log("[TIMEOUT] No tag detected after \(timeoutSeconds)s")
                self.session?.invalidate(errorMessage: "Timeout: aucun tag detecte")
                self.continuation = nil
                let result = self.buildResult(tagDetected: false, tags: [], aidProbes: [], cardAccessProbe: nil)
                cont.resume(returning: result)
            }
        }
    }

    // MARK: - NFCTagReaderSessionDelegate

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
        log("Session active - waiting for tag...")
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        let nfcError = error as? NFCReaderError
        let code = nfcError?.code ?? .readerSessionInvalidationErrorSystemIsBusy

        if code == .readerSessionInvalidationErrorUserCanceled {
            log("[INFO] User cancelled NFC session")
            if let cont = continuation {
                continuation = nil
                let result = buildResult(tagDetected: false, tags: [], aidProbes: [], cardAccessProbe: nil)
                cont.resume(returning: result)
            }
        } else if code == .readerSessionInvalidationErrorFirstNDEFTagRead ||
                  code == .readerSessionInvalidationErrorSessionTerminatedUnexpectedly {
            log("[ERROR] Session invalidated: \(error.localizedDescription)")
        } else {
            log("[INFO] Session ended: \(error.localizedDescription)")
        }
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        log("=== TAG DETECTED ===")
        log("Number of tags: \(tags.count)")

        var tagInfos: [[String: Any]] = []

        for (idx, tag) in tags.enumerated() {
            var info: [String: Any] = ["index": idx]

            switch tag {
            case .iso7816(let iso7816Tag):
                info["type"] = "iso7816"
                info["identifier"] = iso7816Tag.identifier.map { String(format: "%02X", $0) }.joined()
                info["initialSelectedAID"] = iso7816Tag.initialSelectedAID
                info["historicalBytes"] = iso7816Tag.historicalBytes?.map { String(format: "%02X", $0) }.joined() ?? "nil"
                info["applicationData"] = iso7816Tag.applicationData?.map { String(format: "%02X", $0) }.joined() ?? "nil"
                log("Tag[\(idx)] iso7816 - UID: \(info["identifier"] as! String)")
                log("  initialSelectedAID: \(iso7816Tag.initialSelectedAID)")
                log("  historicalBytes: \(info["historicalBytes"] as! String)")

            case .miFare(let miFareTag):
                info["type"] = "miFare-\(miFareTag.mifareFamily.rawValue)"
                info["identifier"] = miFareTag.identifier.map { String(format: "%02X", $0) }.joined()
                log("Tag[\(idx)] miFare - UID: \(info["identifier"] as! String)")

            case .feliCa(let feliCaTag):
                info["type"] = "feliCa"
                info["identifier"] = feliCaTag.currentIDm.map { String(format: "%02X", $0) }.joined()
                log("Tag[\(idx)] feliCa")

            case .iso15693(let iso15693Tag):
                info["type"] = "iso15693"
                info["identifier"] = iso15693Tag.identifier.map { String(format: "%02X", $0) }.joined()
                log("Tag[\(idx)] iso15693")

            @unknown default:
                info["type"] = "unknown"
                log("Tag[\(idx)] unknown type")
            }

            tagInfos.append(info)
        }

        // Connect to first tag and probe
        guard let firstTag = tags.first else {
            log("[ERROR] No tags in array")
            finishWithResult(tagDetected: true, tags: tagInfos, aidProbes: [], cardAccessProbe: nil)
            return
        }

        session.connect(to: firstTag) { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.log("[ERROR] Connect failed: \(error.localizedDescription)")
                self.finishWithResult(tagDetected: true, tags: tagInfos, aidProbes: [], cardAccessProbe: nil)
                return
            }

            self.log("Connected to tag")

            // Get the ISO7816 tag for APDU probing
            guard case .iso7816(let iso7816Tag) = firstTag else {
                self.log("[WARN] Tag is not ISO7816, cannot probe APDUs")
                self.finishWithResult(tagDetected: true, tags: tagInfos, aidProbes: [], cardAccessProbe: nil)
                return
            }

            Task {
                let aidProbes = await self.probeAIDs(tag: iso7816Tag)
                let cardAccessProbe = await self.probeCardAccess(tag: iso7816Tag)

                self.log("=== Diagnostic Complete ===")
                session.alertMessage = "Diagnostic termine"
                session.invalidate()

                self.finishWithResult(
                    tagDetected: true,
                    tags: tagInfos,
                    aidProbes: aidProbes,
                    cardAccessProbe: cardAccessProbe
                )
            }
        }
    }

    // MARK: - AID Probing

    private func probeAIDs(tag: NFCISO7816Tag) async -> [[String: Any]] {
        let aidsToProbe: [(name: String, aid: [UInt8])] = [
            ("eMRTD (A0000002471001)", eMRTD_AID),
            ("French CNIe (A0000001510000)", french_AID),
            ("Master File (3F00)", masterFile),
        ]

        var results: [[String: Any]] = []

        for (name, aid) in aidsToProbe {
            log("--- Probing AID: \(name) ---")

            // SELECT APPLICATION: CLA=00 INS=A4 P1=04 P2=0C (select by DF name, no response)
            let selectAPDU = NFCISO7816APDU(
                instructionClass: 0x00,
                instructionCode: 0xA4,
                p1Parameter: 0x04,
                p2Parameter: 0x0C,
                data: Data(aid),
                expectedResponseLength: 256
            )

            do {
                let (responseData, sw1, sw2) = try await tag.sendCommand(apdu: selectAPDU)
                let sw = String(format: "%02X%02X", sw1, sw2)
                let success = sw1 == 0x90 && sw2 == 0x00
                let responseHex = responseData.map { String(format: "%02X", $0) }.joined()

                log("  [TX] SELECT \(name)")
                log("  [RX] SW=\(sw) success=\(success) data=\(responseHex.isEmpty ? "(empty)" : responseHex)")

                results.append([
                    "name": name,
                    "sw": sw,
                    "success": success,
                    "responseData": responseHex,
                ])
            } catch {
                log("  [ERROR] \(error.localizedDescription)")
                results.append([
                    "name": name,
                    "sw": "ERROR",
                    "success": false,
                    "error": error.localizedDescription,
                ])
            }
        }

        return results
    }

    // MARK: - CardAccess Probing

    private func probeCardAccess(tag: NFCISO7816Tag) async -> [String: Any] {
        log("--- Probing EF.CardAccess ---")

        // First SELECT MF (3F00)
        let selectMF = NFCISO7816APDU(
            instructionClass: 0x00,
            instructionCode: 0xA4,
            p1Parameter: 0x00,
            p2Parameter: 0x0C,
            data: Data(masterFile),
            expectedResponseLength: 256
        )

        do {
            let (_, sw1, sw2) = try await tag.sendCommand(apdu: selectMF)
            log("  [TX] SELECT MF 3F00")
            log("  [RX] SW=\(String(format: "%02X%02X", sw1, sw2))")
        } catch {
            log("  [ERROR] SELECT MF: \(error.localizedDescription)")
            return ["success": false, "step": "SELECT_MF", "error": error.localizedDescription]
        }

        // SELECT EF.CardAccess (011C) — short EF ID select
        let selectEF = NFCISO7816APDU(
            instructionClass: 0x00,
            instructionCode: 0xA4,
            p1Parameter: 0x02,
            p2Parameter: 0x0C,
            data: Data(efCardAccess),
            expectedResponseLength: 256
        )

        do {
            let (_, sw1, sw2) = try await tag.sendCommand(apdu: selectEF)
            let sw = String(format: "%02X%02X", sw1, sw2)
            log("  [TX] SELECT EF.CardAccess 011C")
            log("  [RX] SW=\(sw)")

            if sw1 != 0x90 || sw2 != 0x00 {
                return ["success": false, "step": "SELECT_EF", "sw": sw]
            }
        } catch {
            log("  [ERROR] SELECT EF.CardAccess: \(error.localizedDescription)")
            return ["success": false, "step": "SELECT_EF", "error": error.localizedDescription]
        }

        // READ BINARY from offset 0, up to 256 bytes
        let readBinary = NFCISO7816APDU(
            instructionClass: 0x00,
            instructionCode: 0xB0,
            p1Parameter: 0x00,
            p2Parameter: 0x00,
            data: Data(),
            expectedResponseLength: 256
        )

        do {
            let (responseData, sw1, sw2) = try await tag.sendCommand(apdu: readBinary)
            let sw = String(format: "%02X%02X", sw1, sw2)
            let responseHex = responseData.map { String(format: "%02X", $0) }.joined()
            log("  [TX] READ BINARY 0000")
            log("  [RX] SW=\(sw) len=\(responseData.count) data=\(responseHex.prefix(80))...")

            return [
                "success": sw1 == 0x90 && sw2 == 0x00,
                "step": "READ_BINARY",
                "sw": sw,
                "dataLength": responseData.count,
                "dataHex": responseHex,
            ]
        } catch {
            log("  [ERROR] READ BINARY: \(error.localizedDescription)")
            return ["success": false, "step": "READ_BINARY", "error": error.localizedDescription]
        }
    }

    // MARK: - Helpers

    private func log(_ message: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        let entry = "[\(ts)] \(message)"
        logs.append(entry)
        print("[NfcDiag] \(message)")
    }

    private func finishWithResult(tagDetected: Bool, tags: [[String: Any]], aidProbes: [[String: Any]], cardAccessProbe: [String: Any]?) {
        guard let cont = continuation else { return }
        continuation = nil
        let result = buildResult(tagDetected: tagDetected, tags: tags, aidProbes: aidProbes, cardAccessProbe: cardAccessProbe)
        cont.resume(returning: result)
    }

    private func buildResult(tagDetected: Bool, tags: [[String: Any]], aidProbes: [[String: Any]], cardAccessProbe: [String: Any]?) -> [String: Any] {
        var result: [String: Any] = [
            "tagDetected": tagDetected,
            "tags": tags,
            "aidProbeResults": aidProbes,
            "logs": logs,
        ]
        if let probe = cardAccessProbe {
            result["cardAccessProbe"] = probe
        }
        return result
    }
}
