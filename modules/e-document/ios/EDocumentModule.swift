import ExpoModulesCore
import NFCPassportReader

enum DocumentScanEvents: String {
    case scanStarted = "SCAN_STARTED"

    case requestPresentPassport = "REQUEST_PRESENT_PASSPORT"
    case authenticatingWithPassport = "AUTHENTICATING_WITH_PASSPORT"
    case readingDataGroupProgress = "READING_DATA_GROUP_PROGRESS"
    case activeAuthentication = "ACTIVE_AUTHENTICATION"
    case successfulRead = "SUCCESSFUL_READ"
    case scanError = "SCAN_ERROR"
    case debugLog = "DEBUG_LOG"

    case scanStopped = "SCAN_STOPPED"
}

public class EDocumentModule: Module {

    // The PassportReader instance backing the in-flight scanDocument call, if
    // any. Stored so disableScan has something to cancel — scanDocument used
    // to construct PassportReader() inline with no reference kept anywhere
    // reachable from outside that closure. AsyncFunction closures may run on
    // different threads, so guard access with a plain lock (this file doesn't
    // use actor isolation anywhere else).
    private var activeReader: PassportReader?
    private let readerLock = NSLock()

    // Each module class must implement the definition function. The definition consists of components
    // that describes the module's functionality and behavior.
    // See https://docs.expo.dev/modules/module-api for more details about available components.
    public func definition() -> ModuleDefinition {
        Events(
            DocumentScanEvents.scanStarted.rawValue,

            DocumentScanEvents.requestPresentPassport.rawValue,
            DocumentScanEvents.authenticatingWithPassport.rawValue,
            DocumentScanEvents.readingDataGroupProgress.rawValue,
            DocumentScanEvents.activeAuthentication.rawValue,
            DocumentScanEvents.successfulRead.rawValue,
            DocumentScanEvents.scanError.rawValue,
            DocumentScanEvents.debugLog.rawValue,

            DocumentScanEvents.scanStopped.rawValue
        )

        // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
        // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
        // The module will be accessible from `requireNativeModule('EDocument')` in JavaScript.
        Name("EDocument")

        // Defines a JavaScript function that always returns a Promise and whose native code
        // is by default dispatched on the different thread than the JavaScript runtime runs on.
        AsyncFunction("scanDocument") { (documentType: String, bacKeyParametersJson: String, challenge: Data) in
            // Note: documentType parameter added for consistency with Android
            // iOS NFCPassportReader currently only supports passports, not ID cards
            // For ID cards ('I'), we'll attempt to read but may encounter limitations

            let bacKeyParameters = try JSONDecoder().decode(BacKeyParameters.self, from: bacKeyParametersJson.data(using: .utf8)!)

            // Debug log helper. Forwards scan diagnostics to JS, where they
            // can reach the in-memory log buffer and a user-mailed error
            // report — so only emit in DEBUG builds, never in a release /
            // App Store build (DPIA R5). In release this is a no-op.
            let debugLog: (String) -> Void = { message in
                #if DEBUG
                self.sendEvent(DocumentScanEvents.debugLog.rawValue, ["message": message])
                #endif
            }

            debugLog("=== iOS NFC Scan Starting ===")
            debugLog("Document Type: \(documentType)")

            let mrzKey = PassportUtils.getMRZKey(passportNumber: bacKeyParameters.documentNumber, dateOfBirth: bacKeyParameters.dateOfBirth, dateOfExpiry: bacKeyParameters.dateOfExpiry)
            // PII: never log mrzKey content — its first 10 chars ARE the
            // document number + check digit (BAC seed = docNo + DOB + expiry).
            debugLog("MRZ Key generated")

            let canKey = bacKeyParameters.can

            // DG2 (facial image) is intentionally NOT read — it serves no
            // purpose in the eligibility flow (proof uses DG1 only); skipping
            // it is data minimisation (DPIA R5 #5). PersonDetails carries no
            // facial-image field either, so there is nowhere for a face image
            // to land even if DG2 were requested by mistake — and DG2 has no
            // entry in friendlyDG below for the same reason.
            // For ID cards, skip DG15 (not present on French CNIe).
            // For passports, also read DG12 (issuing authority, date of issue) and DG14 (chip auth info).
            let tagsToRead: [DataGroupId] = documentType == "I"
                ? [.DG1, .DG11, .SOD]
                : [.DG1, .DG11, .DG12, .DG14, .DG15, .SOD]

            do {
                debugLog("Starting PassportReader...")

                let reader = PassportReader()
                self.readerLock.lock()
                self.activeReader = reader
                self.readerLock.unlock()
                defer {
                    self.readerLock.lock()
                    // Only clear activeReader if it's still identically the
                    // reader this call started — guards against a stale
                    // cleanup clobbering a newer attempt's state (mirrors the
                    // scanGeneration identity check on the Android side).
                    if self.activeReader === reader {
                        self.activeReader = nil
                    }
                    self.readerLock.unlock()
                }

                // --- iOS NFC system-sheet progress UI (ONE unified loading bar) ---
                // The only surface visible during an iOS scan is Core NFC's system
                // sheet, whose text we set via customDisplayMessage. The reader
                // reports progress per phase (PACE auth, then every data group
                // restarting at 0%), which reads as several bars. Compile them into
                // a single monotonic 0→100% bar: auth fills 0→35%, the data-group
                // reads fill 35→100%.
                let barCells = 10
                var lastPct = 0
                var seenGroups: [String] = []

                func bar(_ pct: Int) -> String {
                    let p = max(0, min(100, pct))
                    let filled = Int((Double(p) / 100.0 * Double(barCells)).rounded())
                    return String(repeating: "🟩", count: filled)
                        + String(repeating: "⬜️", count: barCells - filled)
                }
                // Progress only ever moves forward, so the bar never jumps backwards.
                func advance(_ pct: Int) -> Int {
                    lastPct = max(lastPct, max(0, min(100, pct)))
                    return lastPct
                }
                func friendlyDG(_ name: String) -> String {
                    switch name {
                    case "DG1": return "identité"
                    case "DG11": return "détails"
                    case "DG12": return "émission"
                    case "DG14", "DG15": return "sécurité"
                    case "SOD": return "signature"
                    case "COM": return "index"
                    default: return name
                    }
                }

                let nfcPassport = try await reader
                    .readPassport(
                        mrzKey: mrzKey,
                        can: canKey,
                        tags: tagsToRead,
                        skipPACE: documentType == "P",
                        customDisplayMessage: { displayMessage in
                            let docName = documentType == "I" ? "carte d'identité" : "passeport"

                            let message: String?
                            switch displayMessage {
                            case .requestPresentPassport:
                                self.sendEvent(DocumentScanEvents.requestPresentPassport.rawValue)
                                message = "📲 Approchez votre \(docName)\ncontre le téléphone"
                            case .authenticatingWithPassport(let progress):
                                self.sendEvent(DocumentScanEvents.authenticatingWithPassport.rawValue)
                                // The native heartbeat (withPaceAuthHeartbeat) drives this
                                // 10→90% during the PACE handshake; map it into the first
                                // 35% of the single overall bar.
                                let p = advance(Int(Double(max(progress, 10)) * 0.35))
                                message = "Authentification sécurisée…\n\(bar(p)) \(p)%"
                            case .activeAuthentication:
                                self.sendEvent(DocumentScanEvents.activeAuthentication.rawValue)
                                let p = advance(35)
                                message = "Authentification sécurisée…\n\(bar(p)) \(p)%"
                            case .readingDataGroupProgress(let dataGroup, let progress):
                                self.sendEvent(DocumentScanEvents.readingDataGroupProgress.rawValue)
                                // Each group restarts at 0%, so fold group index + its own
                                // progress into the remaining 35→100% of the overall bar.
                                let name = dataGroup.getName()
                                if !seenGroups.contains(name) { seenGroups.append(name) }
                                let idx = seenGroups.firstIndex(of: name) ?? 0
                                let total = max(tagsToRead.count, seenGroups.count)
                                let frac = (Double(idx) + Double(max(0, min(100, progress))) / 100.0) / Double(total)
                                let p = advance(35 + Int(frac * 65.0))
                                message = "Lecture — \(friendlyDG(name))\n\(bar(p)) \(p)%"
                            case .error(let tagError):
                                self.sendEvent(DocumentScanEvents.scanError.rawValue)
                                switch tagError {
                                case .TagNotValid: message = "⚠️ Tag invalide."
                                case .MoreThanOneTagFound: message = "⚠️ Plusieurs tags détectés. Présentez un seul document."
                                case .ConnectionError: message = "⚠️ Erreur de connexion. Réessayez."
                                case .InvalidMRZKey: message = "⚠️ Données MRZ invalides pour ce document."
                                case .ResponseError(let reason, let sw1, let sw2):
                                    message = "⚠️ Erreur : \(reason) [0x\(sw1), 0x\(sw2)]"
                                default: message = "⚠️ Erreur de lecture. Réessayez."
                                }
                            case .successfulRead:
                                self.sendEvent(DocumentScanEvents.successfulRead.rawValue)
                                let p = advance(100)
                                message = "✅ Lecture réussie !\n\(bar(p)) \(p)%"
                            }

                            return message
                        }
                    )

                debugLog("=== NFC Read Complete ===")
                let passport = Passport.fromNFCPassportModel(nfcPassport)
                debugLog("DG1 size: \(passport.dg1.count) chars")
                debugLog("DG11 size: \(passport.dg11?.count ?? 0) chars")
                debugLog("DG12 size: \(passport.dg12?.count ?? 0) chars")
                debugLog("DG14 size: \(passport.dg14?.count ?? 0) chars")
                debugLog("DG15 size: \(passport.dg15?.count ?? 0) chars")
                debugLog("SOD size: \(passport.sod.count) chars")
                debugLog("Signature size: \(passport.signature?.count ?? 0) chars")

                let passportJsonBytes = try passport.serialize()
                debugLog("=== iOS NFC Scan SUCCESS ===")

                return String(data: passportJsonBytes, encoding: .utf8)!
            } catch {
                let errorMsg = "\(type(of: error)): \(error.localizedDescription)"
                debugLog("[ERROR] \(errorMsg)")
                self.sendEvent(DocumentScanEvents.scanError.rawValue)
                throw DocumentScannerError(errorMsg)
            }
        }

        AsyncFunction("disableScan") {
            self.readerLock.lock()
            let reader = self.activeReader
            self.readerLock.unlock()

            // Safe no-op if nil — nothing in flight to cancel.
            reader?.cancelReading()

            self.sendEvent(DocumentScanEvents.scanStopped.rawValue)
        }

        AsyncFunction("testNfcDetection") { (timeoutSeconds: Double) -> String in
            let debugLog: (String) -> Void = { message in
                #if DEBUG
                self.sendEvent(DocumentScanEvents.debugLog.rawValue, ["message": "[DIAG] \(message)"])
                #endif
            }

            debugLog("Starting NFC diagnostic (timeout: \(timeoutSeconds)s)")

            let diagnostic = NfcDiagnostic()
            let result = try await diagnostic.run(timeoutSeconds: timeoutSeconds, pacePolling: true)

            if let logs = result["logs"] as? [String] {
                for logLine in logs { debugLog(logLine) }
            }

            let jsonData = try JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed])
            return String(data: jsonData, encoding: .utf8) ?? "{}"
        }

        AsyncFunction("testPassportDetection") { (timeoutSeconds: Double) -> String in
            let debugLog: (String) -> Void = { message in
                #if DEBUG
                self.sendEvent(DocumentScanEvents.debugLog.rawValue, ["message": "[DIAG-P] \(message)"])
                #endif
            }

            debugLog("Starting passport NFC diagnostic (timeout: \(timeoutSeconds)s, iso14443 only)")

            let diagnostic = NfcDiagnostic()
            let result = try await diagnostic.run(timeoutSeconds: timeoutSeconds, pacePolling: false)

            if let logs = result["logs"] as? [String] {
                for logLine in logs { debugLog(logLine) }
            }

            let jsonData = try JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed])
            return String(data: jsonData, encoding: .utf8) ?? "{}"
        }
    }
}
