import { ECDSASigValue, ECParameters } from '@peculiar/asn1-ecc'
import { id_pkcs_1, RSAPublicKey } from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { SubjectPublicKeyInfo } from '@peculiar/asn1-x509'
import { fromBER } from 'asn1js'
import { decodeBase64, getBytes, keccak256, toBigInt } from 'ethers'
import forge from 'node-forge'
import superjson from 'superjson'

import { ExtendedCertificate } from './extended-cert'
import { namedCurveFromParameters } from './helpers/crypto'
import { figureOutRSAAAHashAlgorithm } from './helpers/misc'
import { ECDSA_ALGO_PREFIX, Sod } from './sod'

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

export enum DocType {
  ID = 'ID',
  PASSPORT = 'PASSPORT',
}

export interface EDocument {
  docCode: string

  // constructor(params: { docCode: string }) {
  //   this.docCode = params.docCode
  // }

  get personDetails(): PersonDetails

  serialize(): string
}

type EPassportSerialized = {
  docCode: string
  personDetails: PersonDetails
  sodBytes: string
  dg1Bytes: string
  dg15Bytes?: string
  dg11Bytes?: string
}

export class EPassport implements EDocument {
  static ECMaxSizeInBits = 2688 // Represents the maximum size in bits for an encapsulated content

  docCode: string
  _personDetails: PersonDetails
  sodBytes: Uint8Array
  dg1Bytes: Uint8Array
  dg15Bytes?: Uint8Array
  dg11Bytes?: Uint8Array
  aaSignature?: Uint8Array // TODO: make optional and remove from persistence

  constructor(params: {
    docCode: string
    personDetails: PersonDetails
    sodBytes: Uint8Array
    dg1Bytes: Uint8Array
    dg15Bytes?: Uint8Array
    dg11Bytes?: Uint8Array
    aaSignature?: Uint8Array
  }) {
    this.docCode = params.docCode
    this.docCode = params.docCode
    this._personDetails = params.personDetails
    this.sodBytes = params.sodBytes
    this.dg1Bytes = params.dg1Bytes
    this.dg15Bytes = params.dg15Bytes
    this.dg11Bytes = params.dg11Bytes
    this.aaSignature = params.aaSignature
  }

  get sod(): Sod {
    return new Sod(this.sodBytes)
  }

  get docType(): 'ID' | 'PASSPORT' {
    if (this.docCode.includes('I')) {
      return DocType.ID
    }

    if (this.docCode.includes('P')) {
      return DocType.PASSPORT
    }

    throw new TypeError('Unsupported document type')
  }

  get personDetails(): PersonDetails {
    return this._personDetails
  }

  serialize(): string {
    const target: EPassportSerialized = {
      docCode: this.docCode,
      personDetails: this.personDetails,
      sodBytes: Buffer.from(this.sodBytes).toString('base64'),
      dg1Bytes: Buffer.from(this.dg1Bytes).toString('base64'),
      dg15Bytes: this.dg15Bytes ? Buffer.from(this.dg15Bytes).toString('base64') : undefined,
      dg11Bytes: this.dg11Bytes ? Buffer.from(this.dg11Bytes).toString('base64') : undefined,
    }
    const serialized = superjson.stringify(target)

    return serialized
  }

  static deserialize(serialized: string): EPassport {
    try {
      const parsed = superjson.parse<EPassportSerialized>(serialized)

      const res = new EPassport({
        docCode: parsed.docCode,
        personDetails: parsed.personDetails,
        sodBytes: decodeBase64(parsed.sodBytes),
        dg1Bytes: decodeBase64(parsed.dg1Bytes),
        dg15Bytes: parsed.dg15Bytes ? decodeBase64(parsed.dg15Bytes) : undefined,
        dg11Bytes: parsed.dg11Bytes ? decodeBase64(parsed.dg11Bytes) : undefined,
      })

      return res
    } catch (error) {
      console.error('Error during deserialization:', error)
      throw new Error('Failed to deserialize NewEDocument')
    }
  }

  get dg15PubKey() {
    if (!this.dg15Bytes) return undefined

    const { result } = fromBER(this.dg15Bytes)

    if (!result) {
      throw new Error('BER-decode failed - DG15 file corrupted?')
    }

    const subjectPublicKeyInfo = AsnConvert.parse(
      result.valueBlock.toBER(false),
      SubjectPublicKeyInfo,
    )

    return subjectPublicKeyInfo
  }

  getAADataType(ecSizeInBits: number) {
    if (!this.dg15PubKey) {
      return getBytes(keccak256(Buffer.from('P_NO_AA', 'utf-8')))
    }

    if (this.dg15PubKey?.algorithm.algorithm.includes(id_pkcs_1)) {
      const rsaPubKey = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, RSAPublicKey)

      if (!this.aaSignature) throw new TypeError('AA signature is not defined')

      const hashAlg = figureOutRSAAAHashAlgorithm(rsaPubKey, this.aaSignature)

      if (!hashAlg) {
        return getBytes(keccak256(Buffer.from('P_NO_AA', 'utf-8')))
      }

      const exponentHex = Buffer.from(rsaPubKey.publicExponent).toString('hex')

      const e = new forge.jsbn.BigInteger(exponentHex, 16)

      const dispatcherName = `P_RSA_${hashAlg}_${EPassport.ECMaxSizeInBits > ecSizeInBits ? EPassport.ECMaxSizeInBits : ecSizeInBits}`
      if (e.intValue() === 3) {
        dispatcherName.concat('_3')
      }

      return getBytes(keccak256(Buffer.from(dispatcherName, 'utf-8')))
    }

    if (this.dg15PubKey?.algorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      const dispatcherName = `P_ECDSA_SHA1_${ecSizeInBits}`

      return getBytes(keccak256(Buffer.from(dispatcherName, 'utf-8')))
    }

    throw new TypeError('Unsupported DG15 public key algorithm')
  }

  getAASignature() {
    if (!this.dg15PubKey) throw new TypeError('DG15 public key is not defined')

    if (this.dg15PubKey?.algorithm.algorithm.includes(id_pkcs_1)) {
      return this.aaSignature
    }

    if (this.dg15PubKey?.algorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      const ecParameters = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, ECParameters)

      const [, namedCurve] = namedCurveFromParameters(
        ecParameters,
        new Uint8Array(this.dg15PubKey.subjectPublicKey),
      )

      if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

      if (!this.aaSignature) throw new TypeError('AA signature is not defined')

      const { r, s } = AsnConvert.parse(this.aaSignature, ECDSASigValue)

      const signature = new namedCurve.Signature(
        toBigInt(new Uint8Array(r)),
        toBigInt(new Uint8Array(s)),
      )

      return signature.normalizeS().toCompactRawBytes()
    }

    throw new TypeError('Unsupported DG15 public key algorithm for AA signature extraction')
  }

  getAAPublicKey() {
    if (!this.dg15PubKey) throw new TypeError('DG15 public key is not defined')

    if (this.dg15PubKey?.algorithm.algorithm.includes(id_pkcs_1)) {
      const rsaPubKey = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, RSAPublicKey)

      if (!this.aaSignature) throw new TypeError('AA signature is not defined')

      const hashAlg = figureOutRSAAAHashAlgorithm(rsaPubKey, this.aaSignature)

      if (!hashAlg) {
        return null
      }

      return new Uint8Array(rsaPubKey.modulus)
    }

    // TODO: not tested yet
    if (this.dg15PubKey?.algorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      const ecParameters = AsnConvert.parse(this.dg15PubKey.subjectPublicKey, ECParameters)
      if (!ecParameters?.specifiedCurve?.base?.buffer) {
        throw new TypeError(
          'ECDSA public key does not have a ecParameters?.specifiedCurve?.base?.buffer',
        )
      }

      return new Uint8Array(this.dg15PubKey.subjectPublicKey)
    }

    throw new TypeError('Unsupported DG15 public key algorithm for AA public key extraction')
  }
}

export class EID implements EDocument {
  docCode = 'EID'

  constructor(
    public sigCertificate: ExtendedCertificate,
    public authCertificate: ExtendedCertificate,
  ) {}

  get AADataType() {
    return keccak256(Buffer.from('P_NO_AA', 'utf-8'))
  }

  static fromBytes(sigBytes: Uint8Array, authBytes: Uint8Array): EID {
    const sigCert = AsnConvert.parse(sigBytes, Certificate)
    const authCert = AsnConvert.parse(authBytes, Certificate)

    return new EID(new ExtendedCertificate(sigCert), new ExtendedCertificate(authCert))
  }

  get personDetails(): PersonDetails {
    const certData = this.sigCertificate.certificate.tbsCertificate
    return {
      firstName: certData.subject[2][0].value.toString(),
      lastName: certData.subject[3][0].value.toString(),
      expiryDate: certData.validity.notAfter.getTime().toString(),
      nationality: certData.subject[0][0].value.toString(),
      issuingAuthority: certData.issuer[3][0].value.toString(),
    } as PersonDetails
  }

  serialize(): string {
    return superjson.stringify({
      sigCertificate: AsnConvert.serialize(this.sigCertificate.certificate),
      authCertificate: AsnConvert.serialize(this.authCertificate.certificate),
    })
  }

  static deserialize(serialized: string): EID {
    try {
      const parsed = superjson.parse<{
        sigCertificate: ArrayBuffer
        authCertificate: ArrayBuffer
      }>(serialized)

      const sigCert = AsnConvert.parse(parsed.sigCertificate, Certificate)
      const authCert = AsnConvert.parse(parsed.authCertificate, Certificate)

      return new EID(new ExtendedCertificate(sigCert), new ExtendedCertificate(authCert))
    } catch (error) {
      console.error('Error during deserialization:', error)
      throw new Error('Failed to deserialize EID')
    }
  }
}
