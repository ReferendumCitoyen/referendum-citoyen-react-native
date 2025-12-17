import { Hex, poseidon } from '@iden3/js-crypto'
import { CurveFnWithCreate } from '@noble/curves/_shortw_utils'
import { ProjPointType } from '@noble/curves/abstract/weierstrass'
import { ECParameters } from '@peculiar/asn1-ecc'
import { toBigInt } from 'ethers'

import { namedCurveFromOID, namedCurveFromParams } from '@/utils/curves'

/**
 * HashPacked computes the Poseidon hash of 5 elements.
 * This is a TypeScript implementation matching the Go function provided.
 */
export function hashPacked(x509Key: Uint8Array): Uint8Array {
  if (x509Key.length < 5 * 24) {
    throw new TypeError('x509Key is too short')
  }

  const decomposed: bigint[] = new Array(5)
  let position = x509Key.length

  for (let i = 0; i < 5; i++) {
    if (position < 24) {
      throw new TypeError('x509Key is too short')
    }

    // Extract 24 bytes chunk (3 x 64-bit values = 24 bytes)
    const chunkBytes = x509Key.slice(position - 24, position)
    position -= 24

    const element = BigInt('0x' + Buffer.from(chunkBytes).toString('hex'))

    // Reverse byte order in 64-bit chunks
    let reversed = 0n
    for (let j = 0; j < 3; j++) {
      // Extract 64 bits chunk
      const extracted = (element >> BigInt(j * 64)) & 0xffffffffffffffffn
      // Build reversed value
      reversed = (reversed << 64n) | extracted
    }

    decomposed[i] = reversed
  }

  try {
    const hash = poseidon.hash(decomposed)
    return Hex.decodeString(hash.toString(16))
  } catch (error) {
    throw new TypeError(`Failed to compute Poseidon hash: ${error}`)
  }
}

export function hash512P512(key: Uint8Array): bigint {
  if (key.length !== 128) {
    throw new Error(`key is not 128 bytes long, got ${key.length}`)
  }

  const modulus = 2n ** 248n

  // Convert byte arrays to bigint (big-endian)
  const X = toBigInt(key.slice(0, 64))
  const Y = toBigInt(key.slice(64, 128))

  const lowerX = X % modulus
  const upperX = (X >> 256n) % modulus

  const lowerY = Y % modulus
  const upperY = (Y >> 256n) % modulus

  const decomposed = [lowerX, upperX, lowerY, upperY]

  // Note: You'll need to implement or import a Poseidon hash function
  const keyHash = poseidon.hash(decomposed)

  return keyHash
}

export function hash512(key: Uint8Array): bigint {
  if (key.length !== 64) {
    throw new Error('key is not 64 bytes long')
  }

  const modulus = 2n ** 248n
  const decomposed: bigint[] = []

  for (let i = 0; i < 2; i++) {
    const element = toBigInt(key.slice(i * 32, (i + 1) * 32))
    decomposed[i] = element % modulus
  }

  // Note: You'll need to implement or import a Poseidon hash function
  const keyHash = poseidon.hash(decomposed)

  return keyHash
}

export function namedCurveFromParameters(parameters: ECParameters, subjectPublicKey: Uint8Array) {
  const res = (() => {
    if (parameters.namedCurve) {
      return namedCurveFromOID(parameters.namedCurve)
    }

    if (!parameters.specifiedCurve?.fieldID.fieldType) {
      throw new TypeError(
        'namedCurveFromParameters: ECDSA public key does not have a specified curve fieldID',
      )
    }

    return namedCurveFromOID(parameters.namedCurve ?? parameters.specifiedCurve?.fieldID.fieldType)
  })()

  if (!res) {
    return namedCurveFromParams(subjectPublicKey, parameters)
  }

  return res
}

export function getPublicKeyFromEcParameters(
  parameters: ECParameters,
  subjectPublicKey: Uint8Array,
): [ProjPointType<bigint>, CurveFnWithCreate, string] {
  const [name, curve] = namedCurveFromParameters(parameters, subjectPublicKey)

  if (!curve) throw new TypeError('Named curve not found in ECParameters')

  const publicKey = curve.Point.fromBytes(rightAlign(subjectPublicKey, subjectPublicKey.length * 8))

  if (!publicKey) throw new TypeError('Public key not found in TBS Certificate')

  return [publicKey, curve, name]
}

/**
 * RightAlign returns a slice where the padding bits are at the beginning.
 */
function rightAlign(bytes: Uint8Array, bitLength: number): Uint8Array {
  const shift = 8 - (bitLength % 8)
  if (shift === 8 || bytes.length === 0) {
    return bytes
  }

  const a = new Uint8Array(bytes.length)
  a[0] = bytes[0] >> shift
  for (let i = 1; i < bytes.length; i++) {
    a[i] = (bytes[i - 1] << (8 - shift)) & 0xff
    a[i] |= bytes[i] >> shift
  }

  return a
}
