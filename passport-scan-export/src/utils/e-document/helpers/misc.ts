import { ProjPointType } from '@noble/curves/abstract/weierstrass'
import { CertificateSet, ContentInfo, SignedData } from '@peculiar/asn1-cms'
import { ECParameters } from '@peculiar/asn1-ecc'
import { id_pkcs_1, RSAPublicKey } from '@peculiar/asn1-rsa'
import { AsnConvert } from '@peculiar/asn1-schema'
import {
  AuthorityKeyIdentifier,
  Certificate,
  id_ce_authorityKeyIdentifier,
  id_ce_subjectKeyIdentifier,
  SubjectKeyIdentifier,
  SubjectPublicKeyInfo,
} from '@peculiar/asn1-x509'
import { X509Certificate } from '@peculiar/x509'
import { toBeArray } from 'ethers'
import forge from 'node-forge'

import { ECDSA_ALGO_PREFIX } from '../sod'
import { getPublicKeyFromEcParameters } from './crypto'

export function toPem(buf: ArrayBuffer, header: string): string {
  const body = Buffer.from(buf)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${header}-----\n${body}\n-----END ${header}-----\n`
}

/**
 * Decrypts the AA signature using RSA public key and returns the inferred hash algorithm.
 * @param aaPubKey - RSAPublicKey object with modulus and publicExponent.
 * @param aaSignature - Signature to be decrypted (Uint8Array or Buffer).
 * @returns Hash algorithm name string (e.g., 'SHA256') or throws if invalid.
 */
export function figureOutRSAAAHashAlgorithm(
  aaPubKey: RSAPublicKey,
  aaSignature: Uint8Array,
): string | null {
  // Convert RSA modulus and exponent to BigIntegers
  const modulusHex = Buffer.from(aaPubKey.modulus).toString('hex')
  const exponentHex = Buffer.from(aaPubKey.publicExponent).toString('hex')

  const n = new forge.jsbn.BigInteger(modulusHex, 16)
  const e = new forge.jsbn.BigInteger(exponentHex, 16)

  // Convert signature to BigInteger
  const sigBigInt = new forge.jsbn.BigInteger(Buffer.from(aaSignature).toString('hex'), 16)

  // Decrypt: m = sig^e mod n
  let decryptedBytes = Buffer.from(sigBigInt.modPow(e, n).toByteArray())

  // Remove leading 0x00 if present
  if (decryptedBytes[0] === 0x00) {
    decryptedBytes = decryptedBytes.subarray(1)
  }

  if (decryptedBytes.length < 2) {
    return null
  }

  // Get trailing flag byte
  let flagByte = decryptedBytes[decryptedBytes.length - 1]
  if (flagByte === 0xcc) {
    flagByte = decryptedBytes[decryptedBytes.length - 2]
  }

  switch (flagByte) {
    case 0x33:
    case 0xbc:
      return 'SHA1'
    case 0x34:
      return 'SHA256'
    case 0x35:
      return 'SHA512'
    case 0x36:
      return 'SHA384'
    case 0x38:
      return 'SHA224'
    default:
      return 'SHA256' // fallback/default
  }
}

export function extractPubKey(spki: SubjectPublicKeyInfo): RSAPublicKey | ProjPointType<bigint> {
  const certPubKeyAlgo = spki.algorithm.algorithm

  if (certPubKeyAlgo.includes(id_pkcs_1)) {
    return AsnConvert.parse(spki.subjectPublicKey, RSAPublicKey)
  }

  if (certPubKeyAlgo.includes(ECDSA_ALGO_PREFIX)) {
    if (!spki.algorithm.parameters) throw new TypeError('ECDSA public key does not have parameters')

    const ecParameters = AsnConvert.parse(spki.algorithm.parameters, ECParameters)

    const [publicKey] = getPublicKeyFromEcParameters(
      ecParameters,
      new Uint8Array(spki.subjectPublicKey),
    )

    return publicKey
  }

  throw new TypeError(`Unsupported public key algorithm: ${certPubKeyAlgo}`)
}

export function extractRawPubKey(certificate: Certificate): Uint8Array {
  const pubKey = extractPubKey(certificate.tbsCertificate.subjectPublicKeyInfo)

  if (pubKey instanceof RSAPublicKey) {
    const certPubKey = new Uint8Array(pubKey.modulus)

    return certPubKey[0] === 0x00 ? certPubKey.slice(1) : certPubKey
  }

  // ECDSA public key is a point on the curve
  const certPubKey = new Uint8Array([...toBeArray(pubKey.px), ...toBeArray(pubKey.py)])

  return certPubKey[0] === 0x00 ? certPubKey.slice(1) : certPubKey
}

/**
 * Fallback: parser for ICAO PKD LDIF files.
 * @param icaoLdif
 * @returns
 */
export const icaoPkdStringToCerts = (icaoLdif: string): Certificate[] => {
  const regex = /pkdMasterListContent:: (.*?)\n\n/gs
  const matches = icaoLdif.matchAll(regex)

  const newLinePattern = /\n /g

  const certs: Certificate[][] = Array.from(matches, match => {
    // Remove newline + space patterns
    const dataB64 = match[1].replace(newLinePattern, '')

    // Decode base64
    const decoded = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0))

    const ci = AsnConvert.parse(decoded, ContentInfo)
    const signedData = AsnConvert.parse(ci.content, SignedData)

    if (!signedData.encapContentInfo.eContent?.single?.buffer) {
      throw new Error('eContent is missing in SignedData')
    }

    const asn1ContentInfo = forge.asn1.fromDer(
      forge.util.createBuffer(signedData.encapContentInfo.eContent?.single?.buffer),
    )

    const content = asn1ContentInfo.value[1] as forge.asn1.Asn1

    const CSCACerts = AsnConvert.parse(
      Buffer.from(forge.asn1.toDer(content).toHex(), 'hex'),
      CertificateSet,
    )

    return CSCACerts.reduce((acc, cert) => {
      if (cert.certificate) {
        acc.push(cert.certificate)
      }

      return acc
    }, [] as Certificate[])
  })

  return certs.flat()
}

/**
 * Fallback: Converts ICAO PEM bytes to an array of Certificate objects.
 * @param icaoBytes
 * @returns
 */
export const icaoPemToCerts = async (icaoBytes: Uint8Array) => {
  const pemObjects = forge.pem.decode(Buffer.from(icaoBytes.buffer).toString('utf-8'))

  const pems = pemObjects.map(el => forge.pem.encode(el))

  return pems.map(el => {
    const der = forge.pki.pemToDer(el)
    return AsnConvert.parse(Buffer.from(der.toHex(), 'hex'), Certificate)
  })
}

/**
 * Fallback: Finds the master certificate for a slave certificate.
 * @param slaveCert
 * @param CSCAs
 * @returns
 */
export const getSlaveMaster = async (slaveCert: X509Certificate, CSCAs: Certificate[]) => {
  const slaveAuthorityKeyIdentifierExtension = slaveCert.extensions?.find(
    el => el.type === id_ce_authorityKeyIdentifier,
  )

  if (!slaveAuthorityKeyIdentifierExtension) {
    throw new TypeError('Slave certificate does not have AuthorityKeyIdentifier extension')
  }

  const parsedSlaveAuthorityKeyIdentifierExtension = AsnConvert.parse(
    slaveAuthorityKeyIdentifierExtension.value,
    AuthorityKeyIdentifier,
  )

  const parsedSlaveAuthorityKeyIdentifierExtensionHex = Buffer.from(
    parsedSlaveAuthorityKeyIdentifierExtension.keyIdentifier!.buffer,
  ).toString('hex')

  const candidates = CSCAs.reduce((acc, curr) => {
    try {
      const x509Cert = new X509Certificate(AsnConvert.serialize(curr))

      if (slaveCert.issuer === x509Cert.subject) {
        acc.push(x509Cert)
      }
    } catch (error) {
      /* empty */
    }
    return acc
  }, [] as X509Certificate[]).filter(cert => {
    const subjectKeyIdentifierExtension = cert.extensions?.find(
      el => el.type === id_ce_subjectKeyIdentifier,
    )

    if (!subjectKeyIdentifierExtension) {
      throw new TypeError('CSCA does not have SubjectKeyIdentifier extension')
    }

    const parsedSubjectKeyIdentifierExtension = AsnConvert.parse(
      subjectKeyIdentifierExtension.value,
      SubjectKeyIdentifier,
    )

    return (
      Buffer.from(parsedSubjectKeyIdentifierExtension.buffer).toString('hex') ===
      parsedSlaveAuthorityKeyIdentifierExtensionHex
    )
  })

  return candidates[0]
}
