/**
 * Provenance of every Noir circuit in `assets/circuits/`.
 *
 * Why this exists: on 2026-09-05 Rarimo changed the certificate-tree leaf
 * (sha256 of the whole RSA modulus, high 248 bits, instead of Poseidon over
 * its low 960 bits) and redeployed every register verifier. A circuit built
 * before that proves the old leaf and fails at the prover with a constraint
 * error that names nothing; a circuit built after it fails against an old
 * verifier. Which build is in the app is therefore the first question about
 * any registration failure, and this is where the answer lives — logged by
 * generateHeavyNoirProof, and pinned by bundled-circuits.test.ts to the
 * artifact actually on disk (its Noir `hash`), so the two cannot drift.
 *
 * Plain strings on purpose: this file is imported by the prover path and must
 * never pull the circuit JSON, the SDK, or anything the tests cannot load.
 */

/** Which certificate-tree leaf the circuit commits to. */
export type CertificateLeaf =
  /** Rarimo v0.2.7+: sha256(modulus) high 248 bits. What Mainnet uses since 2026-09-05. */
  | 'sha256-high-248'
  /** Pre-2026-09-05: Poseidon over the low 960 bits of the modulus. */
  | 'poseidon-low-960'
  /** Built by the circuit author outside Rarimo's release train; not yet confirmed. */
  | 'unconfirmed';

export interface BundledCircuitInfo {
  /** Where the artifact came from, precisely enough to fetch it again. */
  source: string;
  /** The day it was copied into assets/circuits/. */
  bundledOn: string;
  /**
   * The `hash` field of the compiled artifact, as the exact decimal string in
   * the file. It exceeds 2^53, so it must never go through JSON.parse or
   * Number — compare text against text.
   */
  noirHash: string;
  leaf: CertificateLeaf;
  /** Free text: what was verified about it, and when. */
  note: string;
}

export const BUNDLED_CIRCUITS: Record<string, BundledCircuitInfo> = {
  registerIdentity_1_256_3_5_576_248_NA: {
    source: 'rarimo/passport-zk-circuits-noir release v0.2.7 (published 2026-09-07)',
    bundledOn: '2026-09-09',
    noirHash: '9768353999766654159',
    leaf: 'sha256-high-248',
    note:
      'ABI byte-identical to the previous build (only error strings changed). ' +
      'scripts/verify-register-verifier.ts: every verification-key constant of the ' +
      'release .sol is in the verifier Mainnet dispatches to (0xeC9D9e7e…), and ' +
      'the pre-2026-09-05 verifier shared only the generic ones. Replaces the ' +
      'build bundled 2026-08-18, which proved the old leaf.',
  },
  registerIdentity_1_256_1_6_960_248_NA: {
    source: 'the circuit author (Rarimo), supplied directly 2026-09-10; not in a Rarimo release',
    bundledOn: '2026-09-10',
    noirHash: '15047853520347881651',
    leaf: 'sha256-high-248',
    note:
      'Rebuilt after the 2026-09-05 leaf change. Compiled Noir artifacts embed their ' +
      'source (file_map): the noir_dl library in this one (not_passports_zk_circuits.nr, ' +
      'smt.nr) is byte-identical to the one inside Rarimo v0.2.7 TD3 above, which ' +
      'registers passports on Mainnet; main.nr and the ABI are identical to the ' +
      '2026-08-24 build, so the input builder is unchanged. Same Noir version. ' +
      'NOT YET USABLE ON CHAIN as of 2026-09-10: Registration2.passportVerifiers for ' +
      'this zkType still resolves to the 2026-08-28 verifier (0xEda16D0a…), whose ' +
      'verification key belongs to the 2026-08-24 build. Until a verifier for THIS ' +
      'build is deployed and registered, the proof generates and the dry run ' +
      'reports [REGISTRATION_REVERT]. Replaces the 2026-08-24 build, which failed at ' +
      'prove() on every card (old leaf, build 21).',
  },
};

/** One line for a log or a report. Never throws: an unknown name says so. */
export function describeBundledCircuit(name: string): string {
  const info = BUNDLED_CIRCUITS[name];
  if (!info) return `${name}: not in constants/bundled-circuits.ts`;
  return `${info.source}; leaf ${info.leaf}; noir hash ${info.noirHash}; bundled ${info.bundledOn}`;
}
