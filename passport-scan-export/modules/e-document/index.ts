// Import the native module. On web, it will be resolved to EDocument.web.ts
// and on native platforms to EDocument.ts

import type { EventSubscription } from 'expo-modules-core'
import { EventEmitter } from 'expo-modules-core'
import { Platform } from 'react-native'

import EDocumentModule from './src/EDocumentModule'
import type { EDocumentModuleEvents } from './src/enums'
import get from 'lodash/get'
import { EDocument, EPassport } from '@/utils/e-document/e-document'

export async function scanDocument(
  documentCode: string,
  bacKeyParameters: {
    dateOfBirth: string
    dateOfExpiry: string
    documentNumber: string
  },
  challenge: Uint8Array,
): Promise<EDocument> {
  const eDocumentString = await EDocumentModule.scanDocument(
    JSON.stringify(bacKeyParameters),
    new Uint8Array(challenge),
  )

  const eDocumentJson = JSON.parse(eDocumentString)

  if (Platform.OS === 'ios') {
    return new EPassport({
      docCode: documentCode,
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
    })
  } else if (Platform.OS === 'android') {
    return new EPassport({
      docCode: documentCode,
      personDetails: {
        firstName: get(eDocumentJson, 'personDetails.primaryIdentifier', null),
        lastName: get(eDocumentJson, 'personDetails.secondaryIdentifier', null),
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
    })
  }

  throw new TypeError('Unsupported platform')
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
