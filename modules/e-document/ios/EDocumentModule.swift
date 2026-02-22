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

            // Debug log helper
            let debugLog: (String) -> Void = { message in
                self.sendEvent(DocumentScanEvents.debugLog.rawValue, ["message": message])
            }

            debugLog("=== iOS NFC Scan Starting ===")
            debugLog("Document Type: \(documentType)")
            debugLog("Document Number: \(bacKeyParameters.documentNumber)")

            let mrzKey = PassportUtils.getMRZKey(passportNumber: bacKeyParameters.documentNumber, dateOfBirth: bacKeyParameters.dateOfBirth, dateOfExpiry: bacKeyParameters.dateOfExpiry)
            debugLog("MRZ Key generated: \(mrzKey.prefix(10))...")

            let canKey = bacKeyParameters.can
            if let can = canKey {
                debugLog("CAN provided: \(can)")
            }

            // For ID cards, skip DG15 (not present on French CNIe)
            let tagsToRead: [DataGroupId] = documentType == "I"
                ? [.DG1, .DG2, .DG11, .SOD]
                : [.DG1, .DG2, .DG11, .DG15, .SOD]

            do {
                debugLog("Starting PassportReader...")
                let nfcPassport = try await PassportReader()
                    .readPassport(
                        mrzKey: mrzKey,
                        can: canKey,
                        tags: tagsToRead,
                        customDisplayMessage: { displayMessage in
                            // Forked from NFCViewDisplayMessage
                            func drawProgressBar(_ progress: Int) -> String {
                                let itemsCount = (progress / 20)
                                let full = String(repeating: "🟢 ", count: itemsCount)
                                let empty = String(repeating: "⚪️ ", count: 5 - itemsCount)
                                return "\(full)\(empty)"
                            }

                            let message: LocalizedStringResource?
                            switch displayMessage {
                            case .requestPresentPassport:
                                self.sendEvent(DocumentScanEvents.requestPresentPassport.rawValue)
                                message = "Hold your iPhone near an NFC enabled passport.\n";
                            case .authenticatingWithPassport(let progress):
//                                self.sendEvent(DocumentScanEvents.scanStarted.rawValue)
                                self.sendEvent(DocumentScanEvents.authenticatingWithPassport.rawValue)
                                message = "Authenticating with passport...\n\n\(drawProgressBar(progress))"
                            case .activeAuthentication:
                                self.sendEvent(DocumentScanEvents.activeAuthentication.rawValue)
                                message = "Authenticating with passport..."
                            case .readingDataGroupProgress(let dataGroup, let progress):
                                self.sendEvent(DocumentScanEvents.readingDataGroupProgress.rawValue)
                                message = "Reading passport data (\(dataGroup.getName()))...\n\n\(drawProgressBar(progress))"
                            case .error(let tagError):
                                self.sendEvent(DocumentScanEvents.scanError.rawValue)
                                switch tagError {
                                case .TagNotValid: message = "Tag not valid."
                                case .MoreThanOneTagFound: message = "More than 1 tag was found. Please present only 1 tag."
                                case .ConnectionError: message = "Connection error. Please try again."
                                case .InvalidMRZKey: message = "MRZ Key not valid for this document."
                                case .ResponseError(let reason, let sw1, let sw2):
                                    message = "Sorry, there was a problem reading the passport. \(reason). Error codes: [0x\(sw1), 0x\(sw2)]"
                                default: message = "Sorry, there was a problem reading the passport. Please try again"
                                }
                            case .successfulRead:
                                self.sendEvent(DocumentScanEvents.successfulRead.rawValue)
                                message = "Passport read successfully"
                            }

                            return message == nil ? nil : String(localized: message!)
                        }
                    )

                debugLog("=== NFC Read Complete ===")
                let passport = Passport.fromNFCPassportModel(nfcPassport)
                debugLog("DG1 size: \(passport.dg1.count) chars")
                debugLog("DG11 size: \(passport.dg11?.count ?? 0) chars")
                debugLog("DG15 size: \(passport.dg15?.count ?? 0) chars")
                debugLog("SOD size: \(passport.sod.count) chars")
                debugLog("Signature size: \(passport.signature?.count ?? 0) chars")

                let passportJsonBytes = try passport.serialize()
                debugLog("=== iOS NFC Scan SUCCESS ===")

                return String(data: passportJsonBytes, encoding: .utf8)!
            } catch {
                debugLog("[ERROR] \(error.localizedDescription)")
                self.sendEvent(DocumentScanEvents.scanError.rawValue)
                throw DocumentScannerError(error.localizedDescription)
            }
        }

        AsyncFunction("disableScan") {
            // TODO: implement
            sendEvent(DocumentScanEvents.scanStopped.rawValue)
            throw DocumentScannerError("Not implemented")
        }

        AsyncFunction("testNfcDetection") { (timeoutSeconds: Double) -> String in
            let debugLog: (String) -> Void = { message in
                self.sendEvent(DocumentScanEvents.debugLog.rawValue, ["message": "[DIAG] \(message)"])
            }

            debugLog("Starting NFC diagnostic (timeout: \(timeoutSeconds)s)")

            let diagnostic = NfcDiagnostic()
            let result = try await diagnostic.run(timeoutSeconds: timeoutSeconds)

            // Forward diagnostic logs via DEBUG_LOG events
            if let logs = result["logs"] as? [String] {
                for logLine in logs {
                    debugLog(logLine)
                }
            }

            let jsonData = try JSONSerialization.data(withJSONObject: result, options: [.fragmentsAllowed])
            return String(data: jsonData, encoding: .utf8) ?? "{}"
        }
    }
}
