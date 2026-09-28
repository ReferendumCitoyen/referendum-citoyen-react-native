/**
 * Pure-math helpers for the heavy Noir register circuit's input encoding.
 *
 * Kept in its own file (no `@iden3/js-crypto`, no `@peculiar/*`, no runtime
 * polyfills) so Jest can load + unit-test it directly. The orchestrator in
 * `utils/heavy-noir-inputs.ts` re-exports these and adds ASN.1 + Poseidon
 * dependencies on top.
 *
 * Source of truth: rarime-android-app `CircuitUtill.kt` — `splitBy120Bits`,
 * `smartBNToArray120`, `rsaBarrettReductionParam`. The 120-bit limb size is
 * baked into the on-chain RSA verifier circuit; do not change.
 */

import { Buffer } from 'buffer';

/**
 * How many 120-bit limbs the compiled circuits' `pk`, `reduction_pk` and `sig`
 * arrays hold: `Field[18]` = ceil(2048 / 120). That is RSA-2048, the only key
 * size any of the four bundled artifacts was compiled for.
 *
 * Worth checking against explicitly, because `splitBy120Bits` sizes itself from
 * the input — hand it an RSA-4096 modulus and it happily returns 35 limbs,
 * which the ABI-shape pre-flight (dg1/ec/sa only) does not look at. The
 * mismatch then surfaces ~20 s later inside the prover, in an error naming
 * neither the actual nor the expected value.
 */
export const RSA_2048_LIMBS = 18;

/**
 * Hex string ("0x…", left-zero-padded to the natural byte length of v).
 * Noir's input parser accepts arbitrary-length hex; we don't need to pad
 * to a fixed Field width.
 *
 * The empty-input case returns "0x0" so the parser still sees a valid hex
 * literal (Noir treats "0x" as a syntax error).
 */
export function toHexField(v: bigint): string {
  if (v === 0n) return '0x0';
  return '0x' + v.toString(16);
}

/**
 * Each byte → "0x..", two hex chars. Matches Numeric.toHexString(byte[]) in
 * Kotlin where byte[]=single byte. The Noir runtime expects `u8` array
 * elements as hex strings, not decimal.
 */
export function bytesToU8HexList(bytes: Uint8Array): string[] {
  const out: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = '0x' + bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Little-endian limb chunker. Splits `x` into `k` limbs of `n` bits each,
 * where limb[0] is the LEAST significant 2^n window.
 *
 * High bits beyond k*n are silently truncated — caller is responsible for
 * sizing k large enough to cover the source value.
 */
export function smartBNToArray120(n: number, k: number, x: bigint): bigint[] {
  const mod = 1n << BigInt(n);
  const out: bigint[] = new Array(k);
  let cur = x;
  for (let i = 0; i < k; i++) {
    out[i] = cur % mod;
    cur = cur / mod;
  }
  return out;
}

/**
 * Treat `data` as an unsigned big-endian integer and split into 120-bit
 * little-endian limbs. Used for the RSA modulus (`pk`) and the SOD
 * signature (`sig`).
 *
 * For RSA-2048: 2048 / 120 = 17.07 → 18 limbs.
 */
export function splitBy120Bits(data: Uint8Array): bigint[] {
  const bitLength = data.length * 8;
  const chunkNumber = Math.ceil(bitLength / 120);
  const x = bytesToBigIntBE(data);
  return smartBNToArray120(120, chunkNumber, x);
}

/**
 * Compute the Barrett reduction parameter `μ = floor(2^((nBits+2)*2) / n)`
 * and split it into 120-bit limbs. Used as `reduction_pk` so the in-circuit
 * RSA verification can avoid expensive bignum divisions — μ lets the
 * verifier reduce mod n with only multiplications and shifts.
 *
 * For RSA-2048: exp = (2048+2)*2 = 4100, base = 2^4100, μ = floor(base / n),
 * then 18 limbs of 120 bits.
 */
export function rsaBarrettReductionParam(n: bigint, nBits: number): bigint[] {
  const chunkNumber = Math.ceil(nBits / 120);
  const exp = BigInt((nBits + 2) * 2);
  const base = 1n << exp;
  const reduction = base / n; // floor division
  return smartBNToArray120(120, chunkNumber, reduction);
}

/** Big-endian bytes → bigint. Returns 0n for empty input. */
export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}
