// Import the native module. On web, it will be resolved to EDocument.web.ts
// and on native platforms to EDocument.ts

import type { EventSubscription } from 'expo-modules-core'
import { EventEmitter } from 'expo-modules-core'
import { Platform } from 'react-native'
import { Buffer } from 'buffer'

import EDocumentModule from './src/EDocumentModule'
import { qaNativeScanOverride } from '../../utils/qa-overrides'
import { describeNativeError, nfcErrorCode, type NfcErrorCode } from '../../utils/e-document/scan-error'
import type { EDocumentModuleEvents } from './src/enums'
import get from 'lodash/get'

// Helper to clean MRZ name fields (remove < filler characters)
const cleanMRZName = (name: string | null): string | null => {
  if (!name) return null;
  return name.replace(/<+/g, ' ').trim();
};

// Simplified interface without crypto dependencies
export type PersonDetails = {
  firstName: string | null
  lastName: string | null
  gender: string | null
  birthDate: string | null
  expiryDate: string | null
  documentNumber: string | null
  nationality: string | null
  issuingAuthority: string | null
}

export interface PassportData {
  docCode: string
  personDetails: PersonDetails
  sodBytes: Uint8Array
  dg1Bytes: Uint8Array
  dg15Bytes?: Uint8Array
  dg11Bytes?: Uint8Array
  dg12Bytes?: Uint8Array
  dg14Bytes?: Uint8Array
  aaSignature?: Uint8Array
}

export async function scanDocument(
  documentType: 'P' | 'I',  // 'P' = Passport, 'I' = ID card
  bacKeyParameters: {
    dateOfBirth?: string
    dateOfExpiry?: string
    documentNumber?: string
    can?: string
  },
  challenge: Uint8Array,
): Promise<PassportData> {
  try {
    const params = {
      documentNumber: bacKeyParameters.documentNumber || '000000000',
      dateOfBirth: bacKeyParameters.dateOfBirth || '000000',
      dateOfExpiry: bacKeyParameters.dateOfExpiry || '000000',
      can: bacKeyParameters.can,
    }

    // QA gallery only (dev and beta builds, utils/qa-overrides.ts): a stand-in
    // for the native call, so everything below runs on a simulated read.
    const qaScan = qaNativeScanOverride()
    const eDocumentString = qaScan
      ? await qaScan(documentType)
      : await EDocumentModule.scanDocument(
          documentType,
          JSON.stringify(params),
          new Uint8Array(challenge),
        )

    const eDocumentJson = JSON.parse(eDocumentString)

    // Helper: safely decode base64 field, returning undefined if absent/null
    const decodeBase64 = (path: string): Uint8Array | undefined => {
      const val = get(eDocumentJson, path, null)
      if (!val) return undefined
      return Buffer.from(val, 'base64')
    }

    if (Platform.OS === 'ios') {
      return {
        docCode: documentType,
      personDetails: {
        firstName: get(eDocumentJson, 'personDetails.firstName', null),
        lastName: get(eDocumentJson, 'personDetails.lastName', null),
        gender: get(eDocumentJson, 'personDetails.gender', null),
        birthDate: get(eDocumentJson, 'personDetails.dateOfBirth', null),
        expiryDate: get(eDocumentJson, 'personDetails.documentExpiryDate', null),
        documentNumber: get(eDocumentJson, 'personDetails.documentNumber', null),
        nationality: get(eDocumentJson, 'personDetails.nationality', null),
        issuingAuthority: get(eDocumentJson, 'personDetails.issuingAuthority', null),
      },
      sodBytes: Buffer.from(get(eDocumentJson, 'sod', '') || '', 'base64'),
      dg1Bytes: Buffer.from(get(eDocumentJson, 'dg1', '') || '', 'base64'),
      dg15Bytes: decodeBase64('dg15'),
      dg11Bytes: decodeBase64('dg11'),
      dg12Bytes: decodeBase64('dg12'),
      dg14Bytes: decodeBase64('dg14'),
      aaSignature: decodeBase64('signature'),
    }
  } else if (Platform.OS === 'android') {
      return {
        docCode: documentType,
        personDetails: {
          // primaryIdentifier = surname (lastName), secondaryIdentifier = given names (firstName)
          firstName: cleanMRZName(get(eDocumentJson, 'personDetails.secondaryIdentifier', null)),
          lastName: cleanMRZName(get(eDocumentJson, 'personDetails.primaryIdentifier', null)),
          gender: get(eDocumentJson, 'personDetails.gender', null),
          birthDate: get(eDocumentJson, 'personDetails.dateOfBirth', null),
          expiryDate: get(eDocumentJson, 'personDetails.dateOfExpiry', null),
          documentNumber: get(eDocumentJson, 'personDetails.documentNumber', null),
          nationality: get(eDocumentJson, 'personDetails.nationality', null),
          issuingAuthority: get(eDocumentJson, 'personDetails.issuingState', null),
        },
        sodBytes: Buffer.from(get(eDocumentJson, 'sod', '') || '', 'base64'),
        dg1Bytes: Buffer.from(get(eDocumentJson, 'dg1', '') || '', 'base64'),
        dg15Bytes: decodeBase64('dg15'),
        dg11Bytes: decodeBase64('dg11'),
        dg12Bytes: decodeBase64('dg12'),
        dg14Bytes: decodeBase64('dg14'),
        aaSignature: decodeBase64('signature'),
      }
    }

    throw new TypeError('Unsupported platform')
  } catch (error: any) {
    // Enhanced error messages for French users
    let errorMessage = error.message || 'Unknown error during document scan'
    // True when the rewrite below names a specific cause. The catch-all
    // "Erreur NFC" text does not: Step 6 replaces it with its own message.
    let hasSpecificMessage = true
    const lower = errorMessage.toLowerCase()

    // Check for common error patterns and provide French translations.
    // Case-insensitive: iOS says "Security status not satisfied", and the old
    // upper-case test sent a wrong CAN to the "NFC disabled" text (2.0.2, 11 D).
    if (lower.includes('6982') || lower.includes('security status')) {
      if (documentType === 'I') {
        errorMessage =
          "❌ La puce a refusé le numéro CAN, ou la carte a bougé pendant l'authentification. " +
          'Vérifiez les 6 chiffres au recto, en bas à droite, puis réessayez sans bouger.'
      } else {
        errorMessage =
          "❌ Erreur d'authentification du passeport\n\n" +
          "Vérifiez que :\n" +
          "• La date de naissance est au format JJ/MM/AA\n" +
          "• La date d'expiration est au format JJ/MM/AA\n" +
          "• Le numéro de passeport est correct\n\n" +
          "Pour les passeports récents, essayez d'ajouter le numéro CAN si disponible."
      }
    } else if (
      documentType === 'I' &&
      errorMessage.toLowerCase().includes('can') &&
      errorMessage.toLowerCase().includes('required')
    ) {
      // Gated on documentType: this text is about the CAN printed on a French
      // ID card, and was previously shown verbatim during passport scans too.
      errorMessage =
        "❌ CAN obligatoire\n\n" +
        "Les cartes d'identité françaises nécessitent le CAN (6 chiffres) " +
        "pour l'authentification PACE.\n\n" +
        "📍 Trouvez le CAN en bas à droite au recto de votre carte."
    } else if (errorMessage.includes('IM not yet implemented') || errorMessage.includes('Step2IM')) {
      errorMessage =
        "❌ Méthode PACE non supportée\n\n" +
        "Cette carte utilise le mode PACE-IM (Integrated Mapping) " +
        "qui n'est pas encore implémenté dans le lecteur NFC.\n\n" +
        "Il s'agit d'un problème connu avec certaines cartes d'identité européennes. " +
        "Une mise à jour sera nécessaire pour supporter cette carte."
    } else if (errorMessage.includes('NFC')) {
      // No "Détail: <native text>" line any more: it put English on screen
      // (rule R10). The native text stays in nativeMessage for the log.
      hasSpecificMessage = false
      errorMessage =
        "❌ Erreur NFC\n\n" +
        "Assurez-vous que :\n" +
        "• Le NFC est activé sur votre téléphone\n" +
        "• Vous maintenez le document contre le téléphone pendant toute la lecture\n" +
        "• Le document est bien positionné sur le lecteur NFC"
    } else {
      hasSpecificMessage = false
    }

    // Keep the untranslated native message alongside the French one. The
    // rewrites above consume exactly the tokens that identify which document
    // the chip actually is — "6982", "Step2IM", "SECURITY STATUS" — and some
    // of the replacements introduce misleading ones ("PACE non supportée"
    // reads as passport evidence, "cartes d'identité françaises" as ID-card
    // evidence). Classifying on the French text therefore produces confident,
    // wrong verdicts; utils/e-document/wrong-document.ts must see this instead.
    const translated = new Error(errorMessage) as Error & {
      nativeMessage?: string
      hasSpecificMessage?: boolean
      nfcCode?: NfcErrorCode
    }
    translated.nativeMessage = error.message
    translated.hasSpecificMessage = hasSpecificMessage
    // Closed code for logs (plan D14, rule R8): the native text stays on the
    // error for classification and is never written to the log from here.
    translated.nfcCode = nfcErrorCode({
      raw: error?.message ?? '',
      code: error?.code,
      hasSpecificMessage,
      flow: documentType === 'I' ? 'idCard' : 'passport',
    })
    console.warn(`[e-document] native scan failed ${describeNativeError(error, translated.nfcCode)}`)
    throw translated
  }
}

// Best-effort release of an in-flight native scan without starting a new
// one. Both platforms implement this for real, under different native names:
// Android's AsyncFunction("cancelScan") (EDocumentModule.kt) shares the same
// self-cancel logic scanDocument uses internally; iOS's AsyncFunction("disableScan")
// (EDocumentModule.swift) invalidates the active PassportReader's
// NFCTagReaderSession, if any. Unify at this JS boundary, which is the name
// every caller (e.g. Step6.tsx) already calls this by.
export async function cancelScan(): Promise<void> {
  if (Platform.OS === 'ios') {
    await EDocumentModule.disableScan()
  } else {
    await EDocumentModule.cancelScan()
  }
}

// --- NFC Diagnostic (iOS only) ---

export interface NfcDiagnosticTag {
  index: number
  type: string
  identifier?: string
  initialSelectedAID?: string
  historicalBytes?: string
  applicationData?: string
}

export interface NfcDiagnosticAidProbe {
  name: string
  sw: string
  success: boolean
  responseData?: string
  error?: string
}

export interface NfcDiagnosticCardAccessProbe {
  success: boolean
  step: string
  sw?: string
  dataLength?: number
  dataHex?: string
  error?: string
}

// Native (iOS NfcDiagnostic.swift) returns cardAccessProbe as a nested
// object keyed by which path reached EF.CardAccess, not a single flat
// probe — see components/diagnostics/NfcDiagnosticCard.tsx's
// `result.cardAccessProbe[key]` lookup for 'mfPath'/'cnIeAidPath'.
export interface NfcDiagnosticCardAccessPaths {
  mfPath?: NfcDiagnosticCardAccessProbe
  cnIeAidPath?: NfcDiagnosticCardAccessProbe
}

export interface NfcDiagnosticResult {
  tagDetected: boolean
  tags: NfcDiagnosticTag[]
  aidProbeResults: NfcDiagnosticAidProbe[]
  cardAccessProbe?: NfcDiagnosticCardAccessPaths
  logs: string[]
}

export async function testNfcDetection(timeoutSeconds: number = 30): Promise<NfcDiagnosticResult> {
  if (Platform.OS !== 'ios') {
    throw new Error('testNfcDetection is only available on iOS')
  }
  const resultJson = await EDocumentModule.testNfcDetection(timeoutSeconds)
  return JSON.parse(resultJson) as NfcDiagnosticResult
}

export async function testPassportDetection(timeoutSeconds: number = 30): Promise<NfcDiagnosticResult> {
  if (Platform.OS !== 'ios') {
    throw new Error('testPassportDetection is only available on iOS')
  }
  const resultJson = await EDocumentModule.testPassportDetection(timeoutSeconds)
  return JSON.parse(resultJson) as NfcDiagnosticResult
}

const EDocumentModuleEmitter = new EventEmitter(EDocumentModule)

export function EDocumentModuleListener(
  eventName: EDocumentModuleEvents,
  listener: (payload: unknown) => void,
): EventSubscription {
  // FIXME: add event types for module
   
  // @ts-ignore
  return EDocumentModuleEmitter.addListener(eventName, listener)
}

export function EDocumentModuleRemoveAllListeners(eventName: EDocumentModuleEvents): void {
  // FIXME: add event types for module
   
  // @ts-ignore
  EDocumentModuleEmitter.removeAllListeners(eventName)
}

export * from './src/enums'
