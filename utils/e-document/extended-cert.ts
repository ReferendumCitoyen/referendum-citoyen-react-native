import { time } from '@distributedlab/tools'
import i18n from 'i18next'
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

/** Zero-pad a bigint EC coordinate to the curve's field byte size. ethers'
 * `toBeArray` strips leading zero bytes, but ASN.1-encoded EC points keep
 * X and Y at exactly fieldBytes long — without this pad, ≈0.4% of ECDSA
 * keys produce a 1-byte-short needle that misses the literal cert bytes. */
function padCoordinate(value: bigint, fieldBytes: number): Uint8Array {
  const arr = toBeArray(value)
  if (arr.length === fieldBytes) return arr
  if (arr.length > fieldBytes) {
    throw new TypeError(
      `EC coordinate exceeds field size (${arr.length} > ${fieldBytes})`,
    )
  }
  const out = new Uint8Array(fieldBytes)
  out.set(arr, fieldBytes - arr.length)
  return out
}

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

      const [publicKey, namedCurve] = getPublicKeyFromEcParameters(
        ecParameters,
        new Uint8Array(this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
      )

      if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

      // The TBS encodes the EC point as `04 || X-padded || Y-padded` inside
      // the BIT STRING — X and Y are *always* exactly fieldBytes long, with
      // leading zeros preserved. `toBeArray` on a bigint strips those leading
      // zeros (≈0.4% of ECDSA keys hit this), so a raw `[px ++ py]` search
      // misses the literal bytes and `indexOf` returns -1 → -1/2 = -0.5 →
      // ethers ABI encode "underflow" downstream. Pad each coordinate to
      // fieldBytes before concatenating so the needle matches the cert
      // bytes exactly.
      const fieldBytes = namedCurve.CURVE.Fp.BYTES
      const needle = new Uint8Array([
        ...padCoordinate(publicKey.x, fieldBytes),
        ...padCoordinate(publicKey.y, fieldBytes),
      ])
      const idx = rawTbsCertHex.indexOf(Buffer.from(needle).toString('hex'))
      if (idx < 0) {
        // The cert may use compressed point encoding (`02/03 || X-padded`)
        // — @noble's `Point.fromBytes` accepts it and decompresses Y on the
        // fly, so `publicKey.y` is valid but its bytes are NOT in the TBS.
        // The on-chain verifier slices out `[X || Y]` from signedAttributes
        // at keyOffset, so a compressed cert can't be registered through
        // the current Registration2 contract. Surface as VOTE_INELIGIBLE so
        // Step 7's catch marks this fatal and the user gets a clear stop
        // instead of a downstream "not registered" error at vote time.
        const spki = new Uint8Array(
          this.certificate.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        )
        const spkiHead = spki[0]?.toString(16).padStart(2, '0') ?? '??'
        const isCompressed = spki.length === 1 + fieldBytes && (spki[0] === 0x02 || spki[0] === 0x03)
        if (isCompressed) {
          const parityKey = spkiHead === '02' ? 'voting.errors.parityEven' : 'voting.errors.parityOdd'
          throw new Error(
            '[VOTE_INELIGIBLE] ' +
              i18n.t('voting.errors.compressedPubKey', {
                bits: namedCurve.CURVE.Fp.BYTES * 8,
                parity: i18n.t(parityKey, { defaultValue: spkiHead === '02' ? 'paire' : 'impaire' }),
                defaultValue: `Ce passeport utilise une clé publique compressée (${namedCurve.CURVE.Fp.BYTES * 8}-bit Y ${spkiHead === '02' ? 'paire' : 'impaire'}) que le contrat d'enregistrement on-chain ne supporte pas encore. Notre équipe travaille à ajouter cette compatibilité.`,
              }),
          )
        }
        // Non-compressed but still not found — a diagnostic path. Keep the
        // technical tag in the message (in brackets) so we can still grep it
        // from error reports, then append the localised user-facing summary.
        const userMsg = i18n.t('voting.errors.unexpectedCertEncoding', {
          spkiLen: spki.length,
          spkiHead,
          curveBits: namedCurve.CURVE.Fp.BYTES * 8,
          defaultValue: `Le certificat de votre passeport utilise un encodage inattendu (SPKI : ${spki.length} octets, tête=0x${spkiHead}, courbe ${namedCurve.CURVE.Fp.BYTES * 8} bits). Merci de partager le JSON du passeport pour diagnostic.`,
        })
        throw new Error(
          `[slaveCertPubKeyOffset] padded EC point (${needle.length} bytes) not found inside TBS certificate. ${userMsg}`,
        )
      }
      return idx / 2
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

      const rawPoint = new Uint8Array([...toBeArray(publicKey.x), ...toBeArray(publicKey.y)])

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

      // `hash512` / `hash512P512` return a Poseidon BN254 field element
      // (≤256-bit bigint) — the "512" in the name refers to the input key
      // size (64 bytes = 512 bits), not the output. Pad to 64 hex chars
      // (32 bytes) so the result is a stable bytes32 leaf key and
      // `Hex.decodeString` never rejects an odd-length input. Same pad
      // pattern as `hashPacked` in helpers/crypto.ts:50.
      return Hex.decodeString(hashedHex.padStart(64, '0'))
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
