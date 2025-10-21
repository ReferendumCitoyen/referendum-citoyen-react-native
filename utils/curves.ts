import { secp256k1 } from '@noble/curves/secp256k1'
import { secp256r1 as p256 } from '@noble/curves/p256'
import { secp384r1 as p384 } from '@noble/curves/p384'
import { secp521r1 as p521 } from '@noble/curves/p521'
import { secp256k1 as brainpoolP256r1 } from '@noble/curves/secp256k1' // fallback
import { secp384r1 as brainpoolP384r1 } from '@noble/curves/p384' // fallback
import { secp521r1 as brainpoolP512r1 } from '@noble/curves/p521' // fallback
import { CurveFnWithCreate } from '@noble/curves/_shortw_utils'
import { ECParameters } from '@peculiar/asn1-ecc'

// Mapping of OIDs to curve implementations
const CURVE_OID_MAP: Record<string, [string, CurveFnWithCreate]> = {
  // ANSI X9.62 named elliptic curves
  '1.2.840.10045.3.1.7': ['secp256r1', p256], // P-256 / prime256v1
  '1.3.132.0.34': ['secp384r1', p384], // P-384
  '1.3.132.0.35': ['secp521r1', p521], // P-521
  '1.3.132.0.10': ['secp256k1', secp256k1],

  // Brainpool curves (using fallbacks for now)
  '1.3.36.3.3.2.8.1.1.7': ['brainpoolP256r1', brainpoolP256r1],
  '1.3.36.3.3.2.8.1.1.11': ['brainpoolP384r1', brainpoolP384r1],
  '1.3.36.3.3.2.8.1.1.13': ['brainpoolP512r1', brainpoolP512r1],
}

// Mapping of field types to curves
const FIELD_TYPE_MAP: Record<string, [string, CurveFnWithCreate]> = {
  'prime-field': ['secp256r1', p256], // default to P-256 for prime fields
}

/**
 * Get a named curve from an OID string
 * @param oid The OID string (e.g., '1.2.840.10045.3.1.7')
 * @returns A tuple of [curve name, curve implementation] or null if not found
 */
export function namedCurveFromOID(oid: string): [string, CurveFnWithCreate] | null {
  return CURVE_OID_MAP[oid] || null
}

/**
 * Derive a named curve from EC parameters
 * This is a fallback when OID-based lookup fails
 * @param publicKey The public key bytes
 * @param parameters The EC parameters
 * @returns A tuple of [curve name, curve implementation]
 */
export function namedCurveFromParams(
  publicKey: Uint8Array,
  parameters: ECParameters,
): [string, CurveFnWithCreate] {
  // Try to determine curve from public key length
  // Uncompressed EC public keys are: 0x04 || X || Y
  // So length = 1 + 2 * field_size_bytes

  const keyLength = publicKey.length

  if (keyLength === 65) {
    // 256-bit curve (1 + 32 + 32)
    return ['secp256r1', p256]
  } else if (keyLength === 97) {
    // 384-bit curve (1 + 48 + 48)
    return ['secp384r1', p384]
  } else if (keyLength === 133) {
    // 521-bit curve (1 + 66 + 66)
    return ['secp521r1', p521]
  }

  // Default to P-256
  console.warn(`Unknown curve parameters, defaulting to secp256r1. Key length: ${keyLength}`)
  return ['secp256r1', p256]
}
