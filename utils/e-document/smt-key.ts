/**
 * The CertificatesSMT key for a certificate, as Rarimo's certificate
 * dispatchers have derived it since 2026-09-05: `sha256(publicKey) >> 8` —
 * the SHA-256 digest of the raw public-key bytes with its last byte dropped
 * and a zero byte prepended, so it fits in 248 bits.
 *
 * Why this is its own module
 * --------------------------
 * `extended-cert.ts`, where the certificate parsing lives, cannot be loaded
 * under Jest (`@iden3/js-crypto` does not resolve there), which is why the one
 * existing test of the leaf key mocks it rather than calling it. A value that
 * has to equal what a contract computes deserves a real test, so the
 * derivation lives here with `ethers` as its only import, and the tests pin
 * it to the value the live dispatcher returned for a real passport.
 *
 * Why it is exactly this, and how it was recovered
 * -----------------------------------------------
 * Until 2026-09-05 04:04 UTC the key was `hashPacked` (a Poseidon over the
 * modulus, in helpers/crypto.ts). That morning Rarimo redeployed every
 * certificate dispatcher on Registration2 (0x11BB4B14…) and re-keyed the
 * tree, without notice. The app kept computing the Poseidon key, looked up
 * registered certificates under it, found nothing, tried to re-register them,
 * and the contract answered "SparseMerkleTree: the key already exists" — which
 * the relayer wraps as an opaque 500 and the app showed as "service
 * temporarily unavailable". Every registration attempt on 2026-09-08 failed
 * this way.
 *
 * The derivation was recovered by calling the live dispatcher's
 * `getCertificateKey(getCertificatePublicKey(sa, keyOffset))` for a captured
 * passport and matching the result against candidate hashes of the same
 * bytes: `sha256(pk) >> 8` is the only one that matches.
 * `scripts/simulate-csca-bootstrap.ts` re-runs that comparison against the
 * chain and is the regression check for this function — if Rarimo changes it
 * again, that script says so before a tester does.
 *
 * `publicKey` must be the bytes the dispatcher hashes: for RSA, the modulus
 * with its DER sign-pad byte stripped (256 B for RSA-2048). Nothing else.
 */

import { getBytes, sha256 } from 'ethers'

export function smtKeyFromPublicKeyBytes(publicKey: Uint8Array): Uint8Array {
  const digest = getBytes(sha256(publicKey))
  const key = new Uint8Array(32)
  key.set(digest.subarray(0, 31), 1) // key[0] stays 0x00 — that is the >> 8
  return key
}
