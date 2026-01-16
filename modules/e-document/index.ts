// Import the native module. On web, it will be resolved to EDocument.web.ts
// and on native platforms to EDocument.ts

import type { EventSubscription } from 'expo-modules-core'
import { EventEmitter } from 'expo-modules-core'
import { Platform } from 'react-native'
import { Buffer } from 'buffer'

import EDocumentModule from './src/EDocumentModule'
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
  passportImageRaw: string | null
}

export interface PassportData {
  docCode: string
  personDetails: PersonDetails
  sodBytes: Uint8Array
  dg1Bytes: Uint8Array
  dg15Bytes?: Uint8Array
  dg11Bytes?: Uint8Array
  aaSignature?: Uint8Array
}

export async function scanDocument(
  documentType: 'P' | 'I',  // 'P' = Passport, 'I' = ID card
  bacKeyParameters: {
    dateOfBirth: string
    dateOfExpiry: string
    documentNumber: string
    can?: string
  },
  challenge: Uint8Array,
): Promise<PassportData> {
  try {
    const eDocumentString = await EDocumentModule.scanDocument(
      documentType,
      JSON.stringify(bacKeyParameters),
      new Uint8Array(challenge),
    )

    const eDocumentJson = JSON.parse(eDocumentString)

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
        passportImageRaw: get(eDocumentJson, 'personDetails.passportImageRaw', null),
      },
      sodBytes: Buffer.from(get(eDocumentJson, 'sod', ''), 'base64'),
      dg1Bytes: Buffer.from(get(eDocumentJson, 'dg1', ''), 'base64'),
      dg15Bytes: Buffer.from(get(eDocumentJson, 'dg15', ''), 'base64'),
      dg11Bytes: Buffer.from(get(eDocumentJson, 'dg11', ''), 'base64'),
      aaSignature: Buffer.from(get(eDocumentJson, 'signature', ''), 'base64'),
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
          passportImageRaw: get(eDocumentJson, 'personDetails.passportImageRaw', null),
        },
        sodBytes: Buffer.from(get(eDocumentJson, 'sod', ''), 'base64'),
        dg1Bytes: Buffer.from(get(eDocumentJson, 'dg1', ''), 'base64'),
        dg15Bytes: Buffer.from(get(eDocumentJson, 'dg15', ''), 'base64'),
        dg11Bytes: Buffer.from(get(eDocumentJson, 'dg11', ''), 'base64'),
        aaSignature: Buffer.from(get(eDocumentJson, 'signature', ''), 'base64'),
      }
    }

    throw new TypeError('Unsupported platform')
  } catch (error: any) {
    // Enhanced error messages for French users
    let errorMessage = error.message || 'Unknown error during document scan'

    // Check for common error patterns and provide French translations
    if (errorMessage.includes('6982') || errorMessage.includes('SECURITY STATUS')) {
      if (documentType === 'I') {
        errorMessage =
          "❌ Erreur d'authentification de la carte d'identité\n\n" +
          "Les cartes d'identité françaises nécessitent le numéro CAN (6 chiffres) " +
          "pour l'authentification PACE.\n\n" +
          "📍 Trouvez le CAN en bas à droite au dos de votre carte.\n\n" +
          "Vérifiez également que :\n" +
          "• Le CAN est correct (6 chiffres)\n" +
          "• La date de naissance est au format JJ/MM/AA\n" +
          "• La date d'expiration est au format JJ/MM/AA\n" +
          "• Le numéro de document est correct"
      } else {
        errorMessage =
          "❌ Erreur d'authentification du passeport\n\n" +
          "Vérifiez que :\n" +
          "• La date de naissance est au format JJ/MM/AA\n" +
          "• La date d'expiration est au format JJ/MM/AA\n" +
          "• Le numéro de passeport est correct\n\n" +
          "Pour les passeports récents, essayez d'ajouter le numéro CAN si disponible."
      }
    } else if (errorMessage.toLowerCase().includes('can') && errorMessage.toLowerCase().includes('required')) {
      errorMessage =
        "❌ CAN obligatoire\n\n" +
        "Les cartes d'identité françaises nécessitent le CAN (6 chiffres) " +
        "pour l'authentification PACE.\n\n" +
        "📍 Trouvez le CAN en bas à droite au dos de votre carte."
    } else if (errorMessage.includes('NFC')) {
      errorMessage =
        "❌ Erreur NFC\n\n" +
        "Assurez-vous que :\n" +
        "• Le NFC est activé sur votre téléphone\n" +
        "• Vous maintenez le document contre le téléphone pendant toute la lecture\n" +
        "• Le document est bien positionné sur le lecteur NFC"
    }

    throw new Error(errorMessage)
  }
}

const EDocumentModuleEmitter = new EventEmitter(EDocumentModule)

export function EDocumentModuleListener(
  eventName: EDocumentModuleEvents,
  listener: (payload: unknown) => void,
): EventSubscription {
  // FIXME: add event types for module
  /* eslint-disable-next-line */
  // @ts-ignore
  return EDocumentModuleEmitter.addListener(eventName, listener)
}

export function EDocumentModuleRemoveAllListeners(eventName: EDocumentModuleEvents): void {
  // FIXME: add event types for module
  /* eslint-disable-next-line */
  // @ts-ignore
  EDocumentModuleEmitter.removeAllListeners(eventName)
}

export * from './src/enums'
