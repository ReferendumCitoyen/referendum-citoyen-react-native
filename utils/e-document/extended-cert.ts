import { time } from '@distributedlab/tools'
import { Hex } from '@iden3/js-crypto'
// `findMasterCertificate` used to live in @lukachi/rn-csca. The Rust crate's
// uniffi JNI binding crashes on RN 0.81 (NoSuchFieldError mHybridData →
// SIGABRT) the first time the JS module is required, so we cannot import
// from it. The only consumer was getSlaveMaster() below, which has been
// removed because the heavy-register flow doesn't actually need it
// (slaveCertificateIndex is computed from the slave cert's own modulus
// via hashPacked — no master-list traversal involved).
import { ECDSASigValue, ECParameters } from '@peculiar/asn1-ecc'
import { id_pkcs_1, RSAPublicKey } from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { getBytes, toBeArray, toBigInt, zeroPadBytes } from 'ethers'

import {
  getPublicKeyFromEcParameters,
  hash512,
  hash512P512,
  hashPacked,
  namedCurveFromParameters,
} from './helpers/crypto'
import { extractPubKey } from './helpers/misc'
import { ECDSA_ALGO_PREFIX } from './sod'

export class ExtendedCertificate {
  constructor(public certificate: Certificate) {}

  static fromBytes(certBytes: Uint8Array) {
    return new ExtendedCertificate(AsnConvert.parse(certBytes, Certificate))
  }

  get slaveCertPubKeyOffset() {
    const rawTbsCertHex = Buffer.from(
      AsnConvert.serialize(this.certificate.tbsCertificate),
    ).toString('hex')

    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
    ) {
      const rsaPub = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        RSAPublicKey,
      )

      return rawTbsCertHex.indexOf(Buffer.from(rsaPub.modulus).toString('hex')) / 2 + 1
    }

    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(
        ECDSA_ALGO_PREFIX,
      )
    ) {
      if (!this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
        throw new TypeError('ECDSA public key does not have parameters')

      const ecParameters = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [publicKey] = getPublicKeyFromEcParameters(
        ecParameters,
        new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

      return (
        rawTbsCertHex.indexOf(
          Buffer.from(
            new Uint8Array([...toBeArray(publicKey.px), ...toBeArray(publicKey.py)]),
          ).toString('hex'),
        ) / 2
      )
    }

    throw new TypeError(
      `Unsupported public key algorithm: ${this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm}`,
    )
  }

  /** Works */
  get slaveCertExpOffset(): bigint {
    const tbsCertificateHex = Buffer.from(
      AsnConvert.serialize(this.certificate.tbsCertificate),
    ).toString('hex')

    if (!this.certificate.tbsCertificate.validity.notAfter.utcTime)
      throw new TypeError('Expiration time not found in TBS Certificate')

    const expirationHex = Buffer.from(
      time(this.certificate.tbsCertificate.validity.notAfter.utcTime?.toISOString())
        .utc()
        .format('YYMMDDHHmmss[Z]'),
      'utf-8',
    ).toString('hex')

    const index = tbsCertificateHex.indexOf(expirationHex)

    if (index < 0) {
      throw new TypeError('Expiration time not found in TBS Certificate')
    }

    return BigInt(index / 2) // index in bytes, not hex
  }

  /** Works */
  getSlaveCertIcaoMemberSignature(masterCert: Certificate): Uint8Array {
    if (masterCert.signatureAlgorithm.algorithm.includes(id_pkcs_1)) {
      return new Uint8Array(this.certificate.signatureValue)
    }

    if (masterCert.signatureAlgorithm.algorithm.includes(ECDSA_ALGO_PREFIX)) {
      if (!masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
        throw new TypeError('ECDSA public key does not have parameters')

      const ecParameters = AsnConvert.parse(
        masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [, namedCurve] = namedCurveFromParameters(
        ecParameters,
        new Uint8Array(masterCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

      const { r, s } = AsnConvert.parse(this.certificate.signatureValue, ECDSASigValue)

      const signature = new namedCurve.Signature(
        toBigInt(new Uint8Array(r)),
        toBigInt(new Uint8Array(s)),
      )

      return signature.normalizeS().toCompactRawBytes()
    }

    throw new TypeError(
      `Unsupported public key algorithm: ${this.certificate.signatureAlgorithm.algorithm}`,
    )
  }

  /** Works */
  get slaveCertificateIndex(): Uint8Array {
    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(id_pkcs_1)
    ) {
      const rsa = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        RSAPublicKey,
      )
      const modulusBytes = new Uint8Array(rsa.modulus)
      const unpadded = modulusBytes[0] === 0x00 ? modulusBytes.subarray(1) : modulusBytes

      return hashPacked(unpadded)
    }

    if (
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm.includes(
        ECDSA_ALGO_PREFIX,
      )
    ) {
      if (!this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters)
        throw new TypeError('ECDSA public key does not have parameters')

      const ecParameters = AsnConvert.parse(
        this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      )

      const [publicKey, namedCurve] = getPublicKeyFromEcParameters(
        ecParameters,
        new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

      const rawPoint = new Uint8Array([...toBeArray(publicKey.px), ...toBeArray(publicKey.py)])

      // BigInt → hex is variable-length: the leading nibble drops when the
      // high byte's top 4 bits are zero. `Hex.decodeString` rejects odd-length
      // input ("Invalid hex string"). The curve order `n` only hits this for
      // 521-bit curves (P-521 → 131 hex chars), but pad defensively so any
      // future curve choice round-trips cleanly.
      const nHex = namedCurve.CURVE.n.toString(16)
      const nBitLength =
        Hex.decodeString(nHex.length % 2 ? '0' + nHex : nHex).length * 8

      const hashedHex = (() => {
        const paddedRaw = zeroPadBytes(rawPoint, 64)

        const paddedRawBytes = getBytes(paddedRaw)

        if (nBitLength === 512) {
          return hash512P512(paddedRawBytes).toString(16)
        }

        return hash512(paddedRawBytes).toString(16)
      })()

      // hash512 / hash512P512 return a 512-bit value; the hex form is up to
      // 128 chars but ~50% of the time the high nibble is zero and the string
      // comes out odd-length. Pad to 128 hex chars (64 bytes) so the result
      // is a stable 64-byte Uint8Array and `Hex.decodeString` never rejects
      // an odd-length input. See the matching pad in helpers/crypto.ts:50.
      return Hex.decodeString(hashedHex.padStart(128, '0'))
    }

    throw new TypeError(
      `Unsupported public key algorithm: ${this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm}`,
    )
  }

  get keySize() {
    const pubKey = extractPubKey(this.certificate.tbsCertificate.subjectPublicKeyInfo)

    if (pubKey instanceof RSAPublicKey) {
      return (
        new Uint8Array(pubKey.modulus[0] === 0x00 ? pubKey.modulus.slice(1) : pubKey.modulus)
          .length * 8
      )
    }

    if (!this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
      throw new TypeError('ECDSA public key does not have parameters')
    }

    const ecParameters = AsnConvert.parse(
      this.certificate.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
      ECParameters,
    )

    const [, namedCurve] = namedCurveFromParameters(
      ecParameters,
      new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
    )

    if (!namedCurve) throw new TypeError('Named curve not found in TBS Certificate')

    return toBeArray(namedCurve.CURVE.n).length * 8
  }
}
