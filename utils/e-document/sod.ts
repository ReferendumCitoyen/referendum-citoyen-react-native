import { SOD } from '@li0ard/tsemrtd'
import { LDSObject } from '@li0ard/tsemrtd/dist/asn1/sod'
import {
  CertificateSet,
  ContentInfo,
  id_signedData,
  SignedData,
  SignerInfos,
} from '@peculiar/asn1-cms'
import { AsnConvert, AsnSerializer } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { fromBER, Set } from 'asn1js'
import { Buffer } from 'buffer'

import { ExtendedCertificate } from './extended-cert'
import { extractRawPubKey } from './helpers/misc'

// TODO: maybe move remove
export const ECDSA_ALGO_PREFIX = '1.2.840.10045'

export class Sod {
  private sodBytes: Uint8Array
  private certSet: CertificateSet

  public ldsObject: LDSObject
  signatures: SignerInfos

  constructor(readonly sod: Uint8Array) {
    this.sodBytes = sod

    const { certificates, ldsObject, signatures } = SOD.load(Buffer.from(sod))

    this.ldsObject = ldsObject
    this.certSet = certificates
    this.signatures = signatures
  }

  get bytes(): Uint8Array {
    return this.sodBytes
  }

  get valueBlockBytes(): Uint8Array {
    const { result } = fromBER(this.sodBytes)

    return new Uint8Array(result.valueBlock.toBER())
  }

  get slaveCertificate(): ExtendedCertificate {
    if (!this.certSet[0].certificate) {
      throw new TypeError('No certificate found in SOD')
    }

    return new ExtendedCertificate(this.certSet[0].certificate)
  }

  /** Works */
  // get slaveCert(): Certificate {
  //   if (!this.certSet[0].certificate) throw new TypeError('No certificate found in SOD')

  //   return this.certSet[0].certificate
  // }

  /** Works */
  // get slaveCertPubKeyOffset() {
  //   const rawTbsCertHex = Buffer.from(AsnConvert.serialize(this.slaveCert.tbsCertificate)).toString(
  //     'hex',
  //   )

  //   if (
  //     this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
  //   ) {
  //     const rsaPub = AsnConvert.parse(
  //       this.slaveCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
  //       RSAPublicKey,
  //     )

  //     return rawTbsCertHex.indexOf(Buffer.from(rsaPub.modulus).toString('hex')) / 2 + 1
  //   }

  //   if (
  //     this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(
  //       ECDSA_ALGO_PREFIX,
  //     )
  //   ) {
  //     if (!this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
  //       throw new TypeError('ECDSA public key does not have parameters')

  //     const ecParameters = AsnConvert.parse(
  //       this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
  //       ECParameters,
  //     )

  //     const [publicKey] = getPublicKeyFromEcParameters(
  //       ecParameters,
  //       new Uint8Array(this.slaveCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
  //     )

  //     if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

  //     return (
  //       rawTbsCertHex.indexOf(
  //         Buffer.from(
  //           new Uint8Array([...toBeArray(publicKey.px), ...toBeArray(publicKey.py)]),
  //         ).toString('hex'),
  //       ) / 2
  //     )
  //   }

  //   throw new TypeError(
  //     `Unsupported public key algorithm: ${this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm}`,
  //   )
  // }

  /** Works */
  // get slaveCertExpOffset(): bigint {
  //   const tbsCertificateHex = Buffer.from(
  //     AsnConvert.serialize(this.slaveCert.tbsCertificate),
  //   ).toString('hex')

  //   if (!this.slaveCert.tbsCertificate.validity.notAfter.utcTime)
  //     throw new TypeError('Expiration time not found in TBS Certificate')

  //   const expirationHex = Buffer.from(
  //     time(this.slaveCert.tbsCertificate.validity.notAfter.utcTime?.toISOString())
  //       .utc()
  //       .format('YYMMDDHHmmss[Z]'),
  //     'utf-8',
  //   ).toString('hex')

  //   const index = tbsCertificateHex.indexOf(expirationHex)

  //   if (index < 0) {
  //     throw new TypeError('Expiration time not found in TBS Certificate')
  //   }

  //   return BigInt(index / 2) // index in bytes, not hex
  // }

  /** Works */
  // getSlaveCertIcaoMemberSignature(masterCert: Certificate): Uint8Array {
  //   if (masterCert.signatureAlgorithm.algorithm.includes(id_pkcs_1)) {
  //     return new Uint8Array(this.slaveCert.signatureValue)
  //   }

  //   if (masterCert.signatureAlgorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
  //     if (!masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
  //       throw new TypeError('ECDSA public key does not have parameters')

  //     const ecParameters = AsnConvert.parse(
  //       masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
  //       ECParameters,
  //     )

  //     const [, namedCurve] = namedCurveFromParameters(
  //       ecParameters,
  //       new Uint8Array(masterCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
  //     )

  //     if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

  //     const { r, s } = AsnConvert.parse(this.slaveCert.signatureValue, ECDSASigValue)

  //     const signature = new namedCurve.Signature(
  //       toBigInt(new Uint8Array(r)),
  //       toBigInt(new Uint8Array(s)),
  //     )

  //     return signature.normalizeS().toCompactRawBytes()
  //   }

  //   throw new TypeError(
  //     `Unsupported public key algorithm: ${this.slaveCert.signatureAlgorithm.algorithm}`,
  //   )
  // }

  /** Works */
  static getSlaveCertIcaoMemberKey(masterCert: Certificate): Uint8Array {
    return extractRawPubKey(masterCert)
  }

  /** Works */
  get encapsulatedContent(): Uint8Array {
    const contentInfo = AsnConvert.parse(this.valueBlockBytes, ContentInfo)

    if (contentInfo.contentType !== id_signedData) {
      throw new TypeError(
        `Invalid ContentType: Expected ${id_signedData} (SignedData), but got ${contentInfo.contentType}`,
      )
    }

    const signedData = AsnConvert.parse(contentInfo.content, SignedData)

    return new Uint8Array(signedData.encapContentInfo.eContent?.single?.buffer || [])
  }

  get signedData(): SignedData {
    const contentInfo = AsnConvert.parse(this.valueBlockBytes, ContentInfo)

    if (contentInfo.contentType !== id_signedData) {
      throw new TypeError(
        `Invalid ContentType: Expected ${id_signedData} (SignedData), but got ${contentInfo.contentType}`,
      )
    }

    const signedData = AsnConvert.parse(contentInfo.content, SignedData)

    if (!signedData.signerInfos || signedData.signerInfos.length === 0) {
      throw new TypeError('No signerInfos found in SignedData')
    }

    return signedData
  }

  /** Works */
  get signedAttributes(): Uint8Array {
    const signerInfo = this.signedData.signerInfos[0]

    if (!signerInfo.signedAttrs?.length) {
      throw new TypeError('No signed attributes found in SignerInfo')
    }

    /* ----- The usual ICAO case: sign over the SET of attributes ----------- */
    // Convert signed attributes to a SET structure using AsnConvert
    const attrsSet = new Set({
      value: signerInfo.signedAttrs.map(a => AsnSerializer.toASN(a)), // ⇐ ASN.1 objects
    })

    return new Uint8Array(attrsSet.toBER(false)) // DER-encoded
  }

  /** TODO: mb remove */
  get signature(): Uint8Array {
    const signerInfo = this.signedData.signerInfos[0]

    if (!signerInfo.signature) {
      throw new TypeError('No signature found in SignerInfo')
    }
    return new Uint8Array(signerInfo.signature.buffer)
  }

  /** Works */
  // async getSlaveMaster(CSCAs: ArrayBuffer[]) {
  //   const master = findMasterCertificate(AsnConvert.serialize(this.slaveCert), CSCAs)

  //   if (!master) throw new TypeError('Master certificate not found for slave certificate')

  //   return AsnConvert.parse(new Uint8Array(master), Certificate)
  // }

  /** Works */
  // get slaveCertificateIndex(): Uint8Array {
  //   if (
  //     this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
  //   ) {
  //     const rsa = AsnConvert.parse(
  //       this.slaveCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
  //       RSAPublicKey,
  //     )
  //     const modulusBytes = new Uint8Array(rsa.modulus)
  //     const unpadded = modulusBytes[0] === 0x00 ? modulusBytes.subarray(1) : modulusBytes

  //     return hashPacked(unpadded)
  //   }

  //   if (
  //     this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(
  //       ECDSA_ALGO_PREFIX,
  //     )
  //   ) {
  //     if (!this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
  //       throw new TypeError('ECDSA public key does not have parameters')

  //     const ecParameters = AsnConvert.parse(
  //       this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
  //       ECParameters,
  //     )

  //     const [publicKey, namedCurve] = getPublicKeyFromEcParameters(
  //       ecParameters,
  //       new Uint8Array(this.slaveCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
  //     )

  //     if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

  //     const rawPoint = new Uint8Array([...toBeArray(publicKey.px), ...toBeArray(publicKey.py)])

  //     const nBitLength = Hex.decodeString(namedCurve.CURVE.n.toString(16)).length * 8

  //     const hashedHex = (() => {
  //       const paddedRaw = zeroPadBytes(rawPoint, 64)

  //       const paddedRawBytes = getBytes(paddedRaw)

  //       if (nBitLength === 512) {
  //         return hash512P512(paddedRawBytes).toString(16)
  //       }

  //       return hash512(paddedRawBytes).toString(16)
  //     })()

  //     return Hex.decodeString(hashedHex)
  //   }

  //   throw new TypeError(
  //     `Unsupported public key algorithm: ${this.slaveCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm}`,
  //   )
  // }
}
