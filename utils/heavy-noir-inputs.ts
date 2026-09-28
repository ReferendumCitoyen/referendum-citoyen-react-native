/**
 * Build the JSON inputs for the heavy Noir register circuits — both of them.
 *
 * This builder is SHAPE-AGNOSTIC on purpose: it passes `dg1Bytes`,
 * `encapsulatedContent` and `signedAttributes` straight through with no
 * slicing, padding or length assertion, so the same code serves both French
 * documents. It is only the compiled bytecode that differs.
 *
 * The two ABIs (read out of the artifacts in assets/circuits/, not guessed) —
 * the three differing rows are FIXED-SIZE Noir arrays, which is exactly why
 * each document type needs its own compiled circuit:
 *
 *                        TD1 / CNIe      TD3 / passport
 *                        registerIdentity_   registerIdentity_
 *                        1_256_1_6_960_248_NA  1_256_3_5_576_248_NA
 *   dg1                  u8[95]          u8[93]      DG1 bytes
 *   ec                   u8[313]         u8[297]     encapsulatedContent from SOD
 *   sa                   u8[152]         u8[104]     signedAttributes from SOD
 *
 * Everything else is identical in both:
 *
 *   dg15               u8[0]       empty (neither document has Active Auth)
 *   pk                 Field[18]   slave-cert RSA modulus, 120-bit limbs LE
 *   reduction_pk       Field[18]   Barrett reduction parameter, 120-bit limbs LE
 *   sig                Field[18]   SOD's RSA signature, 120-bit limbs LE
 *   sk_identity        Field       BJJ private key
 *   icao_root          Field       CertificatesSMT root at registration time
 *   inclusion_branches Field[80]   Merkle siblings proving slave cert is in SMT
 *   -> returns a public tuple of 5 Fields
 *
 * (Both are RSA-2048 / SHA-256 / no AA; both compiled with noir
 * 1.0.0-beta.1+03b58fa2.)
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
import { HEAVY_CIRCUIT_ABI_SHAPES, HEAVY_CIRCUIT_NAMES } from '@/utils/heavy-circuits';
import { docTypeFromDg1 } from '@/utils/passport-key-db';
import {
  bytesToBigIntBE,
  bytesToU8HexList,
  rsaBarrettReductionParam,
  splitBy120Bits,
  toHexField,
} from '@/utils/heavy-noir-inputs-math';

// Re-export so existing call sites that import from this file keep working.
export {
  bytesToBigIntBE,
  bytesToU8HexList,
  rsaBarrettReductionParam,
  smartBNToArray120,
  splitBy120Bits,
  toHexField,
} from '@/utils/heavy-noir-inputs-math';

// `toHexField` and `bytesToU8HexList` live in heavy-noir-inputs-math.ts (and
// are re-exported above) so a caller can reach them without pulling in this
// file's ASN.1 + Poseidon dependencies.

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
 *
 * Exported so that any second circuit over the same slave cert shares this
 * one implementation: a second copy of the leading-zero strip is exactly the
 * kind of thing that drifts silently.
 */
export function extractSlaveCertRsaModulus(eDoc: EPassport): Uint8Array {
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
   * RPC call. `leaf` is `slaveCertSmtLeafKey(passport)` — the sha256-based
   * key the chain uses since 2026-09-05, not the legacy Poseidon index. */
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
  const modulusBits = modulusBytes.length * 8; // 2048 for both French documents
  const pk = splitBy120Bits(modulusBytes).map(toHexField);
  const reductionPk = rsaBarrettReductionParam(modulus, modulusBits).map(toHexField);

  // ---- SOD signature (`sig`) ---------------------------------------------
  const sigBytes = passport.sod.signature;
  const sig = splitBy120Bits(sigBytes).map(toHexField);

  // ---- ABI shape pre-flight ----------------------------------------------
  // The builder serves both document types, so it can't assert one hardcoded
  // set of lengths — but it can look up the expected set from the document
  // itself, using the same DG1 discriminator the circuit was chosen with.
  //
  // Worth doing eagerly: the Noir runtime does catch a mismatch against its
  // fixed-size ABI, but only once the prover is running, which costs ~20 s on
  // device and reports neither the actual nor the expected length. The French
  // CNIe's 313/152 came from the circuit author's own sample chip; a card that
  // disagrees means the circuit needs recompiling, and that's worth learning
  // in a second rather than after a failed proving run.
  const shapeDocType = docTypeFromDg1(passport.dg1Bytes);
  if (shapeDocType) {
    const want = HEAVY_CIRCUIT_ABI_SHAPES[shapeDocType];
    const got = {
      dg1: passport.dg1Bytes.length,
      ec: passport.sod.encapsulatedContent.length,
      sa: passport.sod.signedAttributes.length,
    };
    // Logged on every run, not just on mismatch: "ec was 313 as expected" is
    // itself the result the circuit author is waiting on, and a matching run
    // that printed nothing would leave that unconfirmed. Lengths only — no
    // chip contents.
    if (__DEV__) {
      console.log(
        `[buildHeavyRegisterInputs] ${shapeDocType} ABI shape — ` +
        `dg1=${got.dg1}/${want.dg1} ec=${got.ec}/${want.ec} sa=${got.sa}/${want.sa} ` +
        `(got/expected for ${HEAVY_CIRCUIT_NAMES[shapeDocType]})`,
      );
    }
    if (got.dg1 !== want.dg1 || got.ec !== want.ec || got.sa !== want.sa) {
      throw new Error(
        `[buildHeavyRegisterInputs] this ${shapeDocType} does not match the compiled ` +
        `${HEAVY_CIRCUIT_NAMES[shapeDocType]} ABI — ` +
        `dg1 ${got.dg1}/${want.dg1}, ec ${got.ec}/${want.ec}, sa ${got.sa}/${want.sa} (got/expected). ` +
        'dg1, ec and sa are fixed-size Noir arrays, so this chip cannot be proved with ' +
        'the bundled bytecode. Send these numbers to the circuit author — a differing ec ' +
        'or sa length means the circuit was compiled against a differently-structured SOD.',
      );
    }
  }

  // ---- Encapsulated content + signed attributes (`ec` / `sa`) ------------
  // Passed straight through: the chip's own bytes are already the exact
  // sequences the matching circuit was compiled for (TD3 297/104, TD1
  // 313/152 — see the ABI table at the top of this file). The Sod getters
  // return the raw ASN.1 with no further trimming.
  const ec = bytesToU8HexList(passport.sod.encapsulatedContent);
  const sa = bytesToU8HexList(passport.sod.signedAttributes);

  // ---- DG1 / DG15 --------------------------------------------------------
  // Likewise straight through: 93 bytes for a TD3 passport, 95 for a TD1
  // CNIe. The caller has already picked the circuit that matches — see
  // heavyCircuitNameForDg1 in utils/heavy-circuits.ts.
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
 * Compute the CertificatesSMT leaf key for a passport's slave certificate —
 * the key `CertificatesSMT.getProof(...)` must be called with.
 *
 * Since 2026-09-05 this is `sha256(modulus) >> 8`, matching what Rarimo's
 * redeployed certificate dispatchers insert under. It was Poseidon
 * (`hashPacked`) before that; see `smtKeyFromPublicKeyBytes` in
 * utils/e-document/extended-cert.ts for the derivation, the history, and the
 * script that checks it against the live chain.
 *
 * The register circuits compute this same leaf internally from `pk`, so the
 * siblings fetched under this key are only useful to a circuit built for the
 * same derivation. A circuit still built for Poseidon fails at proving with
 * these siblings — cleanly, at the right step — until it is rebuilt.
 *
 * Returns a 0x-prefixed bytes32 hex string.
 */
export function slaveCertSmtLeafKey(passport: EPassport): string {
  const keyBytes = passport.sod.slaveCertificate.slaveCertificateSmtKey;
  return '0x' + Hex.encodeString(keyBytes).padStart(64, '0');
}
