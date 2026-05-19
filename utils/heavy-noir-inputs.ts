/**
 * Build the JSON inputs for the heavy Noir register circuit
 * `registerIdentity_1_256_3_5_576_248_NA` (French passport: RSA-2048,
 * SHA-256, TD3, no AA).
 *
 * The circuit ABI (extracted from the bundled bytecode JSON) is:
 *
 *   dg1                u8[93]      DG1 bytes
 *   dg15               u8[0]       empty (passport has no Active Auth)
 *   ec                 u8[297]     encapsulatedContent from SOD
 *   sa                 u8[104]     signedAttributes from SOD
 *   pk                 Field[18]   slave-cert RSA modulus, 120-bit limbs LE
 *   reduction_pk       Field[18]   Barrett reduction parameter, 120-bit limbs LE
 *   sig                Field[18]   SOD's RSA signature, 120-bit limbs LE
 *   sk_identity        Field       BJJ private key
 *   icao_root          Field       CertificatesSMT root at registration time
 *   inclusion_branches Field[80]   Merkle siblings proving slave cert is in SMT
 *
 * The format the Noir runtime expects is JSON — each value as a `0x`-prefixed
 * hex string (a `Field` is a single hex string; `u8[N]` is an array of
 * single-byte hex strings; `Field[N]` is an array of hex strings).
 *
 * Source of truth: rarime-android-app `ProofGenerationManager.kt::
 * buildPlonkRegistrationInputs` (lines 630-735), and the underlying math
 * helpers in `CircuitUtill.kt`.
 */

import { Hex } from '@iden3/js-crypto';
import { AsnConvert } from '@peculiar/asn1-schema';
import { RSAPublicKey } from '@peculiar/asn1-rsa';
import { EPassport } from '@/utils/e-document/e-document';
import {
  bytesToBigIntBE,
  rsaBarrettReductionParam,
  splitBy120Bits,
} from '@/utils/heavy-noir-inputs-math';

// Re-export so existing call sites that import from this file keep working.
export {
  bytesToBigIntBE,
  rsaBarrettReductionParam,
  smartBNToArray120,
  splitBy120Bits,
} from '@/utils/heavy-noir-inputs-math';

/**
 * Hex string ("0x…", left-zero-padded to the natural byte length of v).
 * Noir's input parser accepts arbitrary-length hex; we don't need to pad
 * to a fixed Field width.
 *
 * The empty-input case returns "0x0" so the parser still sees a valid hex
 * literal (Noir treats "0x" as a syntax error).
 */
function toHexField(v: bigint): string {
  if (v === 0n) return '0x0';
  return '0x' + v.toString(16);
}

/** Each byte → "0x..", two hex chars. Matches Numeric.toHexString(byte[]) in
 * Kotlin where byte[]=single byte. The Noir runtime expects `u8` array
 * elements as hex strings, not decimal. */
function bytesToU8HexList(bytes: Uint8Array): string[] {
  const out: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = '0x' + bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slave-cert RSA modulus extraction
// ---------------------------------------------------------------------------

/**
 * Extract the RSA modulus bytes from the slave certificate inside the SOD.
 * The ASN.1 leading 0x00 (sign byte for positive INTEGER) is stripped so
 * the result is exactly `keySize / 8` bytes — for RSA-2048 that's 256 bytes.
 *
 * Caller is responsible for asserting the algorithm is RSA — the helper
 * throws on EC keys rather than silently misinterpreting them as RSA.
 */
function extractSlaveCertRsaModulus(eDoc: EPassport): Uint8Array {
  const slaveCert = eDoc.sod.slaveCertificate.certificate;
  const spki = slaveCert.tbsCertificate.subjectPublicKeyInfo;
  // RSA OID = 1.2.840.113549.1.1.1 — the slave cert's SPKI carries this
  // when the slave was signed under an RSA CSCA (French HSM_DS_1 case).
  // For ECDSA slaves we'd need a different extractor + a different heavy
  // circuit; we keep the throw loud so misuse is obvious.
  const rsa = AsnConvert.parse(spki.subjectPublicKey, RSAPublicKey);
  const modulusBytes = new Uint8Array(rsa.modulus);
  return modulusBytes[0] === 0x00 ? modulusBytes.subarray(1) : modulusBytes;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface SmtInclusionProof {
  /** SMT root at the moment of the read. Bytes32 hex from
   * CertificatesSMT.getProof(). */
  root: string;
  /** SMT siblings — 80 entries for Rarimo's depth-80 Poseidon tree. Each
   * is a 32-byte hex string. */
  siblings: string[];
}

export interface BuildHeavyInputsArgs {
  /** EPassport built from the NFC scan. Provides DG1/DG15/SOD bytes and
   * the slave certificate. */
  passport: EPassport;
  /** BJJ private key as a hex string ("0x…" or bare hex). */
  skIdentityHex: string;
  /** Inclusion proof from the on-chain `CertificatesSMT.getProof(leaf)`
   * RPC call. `leaf` is `passport.sod.slaveCertificate.slaveCertificateIndex`. */
  smtProof: SmtInclusionProof;
}

/**
 * Assemble the Noir-format input JSON object for the heavy register
 * circuit. The returned shape matches the circuit's ABI exactly; pass
 * it through JSON.stringify before handing to NoirCircuitParams.prove().
 *
 * No I/O — purely deterministic. The SMT proof must be fetched by the
 * caller (the circuit can't read chain state, so we treat it as input).
 */
export function buildHeavyRegisterInputs(args: BuildHeavyInputsArgs): Record<string, unknown> {
  const { passport, skIdentityHex, smtProof } = args;

  // ---- RSA modulus + Barrett reduction (`pk` / `reduction_pk`) -----------
  const modulusBytes = extractSlaveCertRsaModulus(passport);
  const modulus = bytesToBigIntBE(modulusBytes);
  const modulusBits = modulusBytes.length * 8; // 2048 for our French passport
  const pk = splitBy120Bits(modulusBytes).map(toHexField);
  const reductionPk = rsaBarrettReductionParam(modulus, modulusBits).map(toHexField);

  // ---- SOD signature (`sig`) ---------------------------------------------
  const sigBytes = passport.sod.signature;
  const sig = splitBy120Bits(sigBytes).map(toHexField);

  // ---- Encapsulated content + signed attributes (`ec` / `sa`) ------------
  // These are already the exact byte sequences the circuit was compiled for
  // (297 / 104 bytes respectively for our French passport). The Sod
  // getters return the raw ASN.1 with no further trimming.
  const ec = bytesToU8HexList(passport.sod.encapsulatedContent);
  const sa = bytesToU8HexList(passport.sod.signedAttributes);

  // ---- DG1 / DG15 --------------------------------------------------------
  const dg1 = bytesToU8HexList(passport.dg1Bytes);
  // dg15 is u8[0] in the circuit ABI — an empty array. We still emit `[]`
  // explicitly so the JSON shape is unambiguous.
  const dg15 = passport.dg15Bytes && passport.dg15Bytes.length > 0
    ? bytesToU8HexList(passport.dg15Bytes)
    : [];

  // ---- sk_identity -------------------------------------------------------
  // Accept "0x"-prefixed or bare hex; canonicalise to a clean "0x…" Field.
  const skClean = skIdentityHex.startsWith('0x') ? skIdentityHex : '0x' + skIdentityHex;

  // ---- icao_root + inclusion_branches ------------------------------------
  // These come straight off the chain — the SMT read returns hex strings,
  // which is what Noir expects. We just pass them through.
  const icaoRoot = smtProof.root.startsWith('0x') ? smtProof.root : '0x' + smtProof.root;
  if (smtProof.siblings.length !== 80) {
    throw new Error(
      `[buildHeavyRegisterInputs] expected 80 SMT siblings, got ${smtProof.siblings.length}. ` +
      'Rarimo deploys Poseidon SMTs at depth 80; mismatch suggests the read hit the wrong contract.',
    );
  }
  const inclusionBranches = smtProof.siblings.map((s) =>
    s.startsWith('0x') ? s : '0x' + s,
  );

  return {
    dg1,
    dg15,
    sa,
    ec,
    pk,
    reduction_pk: reductionPk,
    sig,
    sk_identity: skClean,
    icao_root: icaoRoot,
    inclusion_branches: inclusionBranches,
  };
}

// ---------------------------------------------------------------------------
// SMT leaf-key helper — re-exported from the e-document utils so callers
// don't have to reach into deeply nested module paths.
// ---------------------------------------------------------------------------

/**
 * Compute the CertificatesSMT leaf key for a passport's slave certificate.
 * For RSA slaves this is `Poseidon(packed last 120 bytes of modulus)`;
 * see utils/e-document/helpers/crypto.ts::hashPacked for the exact
 * unpacking algorithm.
 *
 * Returns a 0x-prefixed bytes32 hex string ready to pass to
 * `CertificatesSMT.getProof(...)`.
 */
export function slaveCertSmtLeafKey(passport: EPassport): string {
  const indexBytes = passport.sod.slaveCertificate.slaveCertificateIndex;
  return '0x' + Hex.encodeString(indexBytes).padStart(64, '0');
}
