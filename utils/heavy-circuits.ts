/**
 * Which heavy Noir *register* circuit belongs to which document type.
 *
 * Why this module exists
 * ----------------------
 * The circuit name is load-bearing in three unrelated places, and nothing
 * cross-checks them at runtime:
 *
 *   1. `app/voting-flow.tsx` — the key under which the bytecode is handed to
 *      `Rarime.registerBundledCircuit(name, json)`.
 *   2. `utils/register-via-noir.ts::generateHeavyNoirProof` — the key looked
 *      up again via `Rarime.getBundledCircuit(name)` and
 *      `NoirCircuitParams.fromName(name)` to select the bytecode to prove.
 *   3. `utils/register-via-noir.ts::buildRegisterViaNoirCalldata` — the string
 *      the on-chain zkType is derived from:
 *      `keccak("Z_NOIR_PASSPORT_" + <name after the first underscore>)`.
 *
 * (1) and (2) fail loudly on a mismatch (`getBundledCircuit` returns null and
 * we throw; `fromName` throws "Noir Circuit with name … not found"). (3) does
 * NOT: `prove()` takes the bytecode as an explicit argument, so registering
 * TD1 bytecode under the TD3 *name* would prove TD1 and then declare the TD3
 * zkType on-chain with no error anywhere. One map, imported everywhere, is the
 * cheapest way to make that class of drift impossible.
 *
 * Why the name can't be derived from the document at proof time
 * -------------------------------------------------------------
 * The circuit author (Rarimo) asked us to pin the bundled TD1 file rather than
 * resolve a circuit dynamically from document parameters / Rarimo's CDN:
 * "For now instead of loading by type just hardcode this circuit." This map is
 * that pinning — a static lookup over the two circuits we physically ship in
 * `assets/circuits/`. It is deliberately NOT `EPassport.extractCircuitSuite()`
 * (the CDN-derived resolver probed at Step7's Phase A.1 log), which would go
 * looking for a published `registerIdentity_<suite>.json` on
 * storage.googleapis.com.
 */

import { docTypeFromDg1, type DocType } from '@/utils/passport-key-db';

/**
 * Compiled heavy register circuits bundled in `assets/circuits/`, keyed by the
 * document type their ABI was compiled for.
 *
 * TD1 and TD3 are genuinely different circuits, not one circuit with a runtime
 * switch: `dg1`, `ec` and `sa` are FIXED-SIZE Noir arrays, so the compiled
 * bytecode encodes the lengths. Read straight out of the two artifacts' ABIs:
 *
 *                       dg1        ec         sa
 *   TD1 (CNIe)          u8[95]     u8[313]    u8[152]
 *   TD3 (passport)      u8[93]     u8[297]    u8[104]
 *
 * Everything else matches (dg15 u8[0], pk/reduction_pk/sig Field[18],
 * sk_identity, icao_root, inclusion_branches Field[80], and a public 5-Field
 * return — hence `pub_signals_count = 5` for both entries in the SDK's
 * `supportedNoirCircuits` registry, see
 * `patches/@rarimo+rarime-rn-sdk+0.3.1.patch`).
 */
export const HEAVY_CIRCUIT_NAMES: Record<DocType, string> = {
  /**
   * French national ID card (CNIe). Supplied by the circuit author (Rarimo)
   * 2026-08-24, and NOT published on Rarimo's CDN — which is why the bundled
   * asset is pinned rather than resolved (see the section above). Its on-chain
   * Aztec verifier is live: Rarimo deployed it and registered it against this
   * circuit's zkType, verified on Mainnet 2026-08-31 and declared final by the
   * author the same day. Provenance and the exact addresses are in
   * `utils/register-via-noir.ts` (zkType derivation + assertOnChainConstants).
   */
  idCard: 'registerIdentity_1_256_1_6_960_248_NA',
  /** French passport (RSA-2048, SHA-256, no AA). Proven on Mainnet at block 2330. */
  passport: 'registerIdentity_1_256_3_5_576_248_NA',
};

/**
 * The three variable-length inputs each circuit was compiled for, in bytes.
 *
 * Read straight out of the two artifacts' ABIs (the table above). Kept next to
 * the names so the pair can't drift: swapping a recompiled circuit in means
 * updating one object, not hunting for a length assertion somewhere else.
 *
 * Used by `buildHeavyRegisterInputs` to fail fast. Without it, a chip whose
 * SOD doesn't match the compiled shape gets caught by the Noir runtime — but
 * only after the prover has spun up, which is ~20 s of nothing on the device
 * and an error that names neither the actual length nor the expected one.
 */
export const HEAVY_CIRCUIT_ABI_SHAPES: Record<
  DocType,
  { dg1: number; ec: number; sa: number }
> = {
  idCard: { dg1: 95, ec: 313, sa: 152 },
  passport: { dg1: 93, ec: 297, sa: 104 },
};

/**
 * Pick the heavy register circuit for a document, using its own DG1 length as
 * the discriminator (95 = TD1 ID card, 93 = TD3 passport — see
 * `docTypeFromDg1`, the single source of truth for that split).
 *
 * Returns `undefined` for any other DG1 length rather than guessing. Callers
 * treat that as "no heavy circuit for this document" and fall back to the
 * light registrator, which is the safe direction: a wrong-length DG1 handed to
 * a fixed-size Noir circuit fails inside the prover after ~20 s, whereas the
 * light path just gets rejected by the registrator in a second.
 */
export function heavyCircuitNameForDg1(dg1: Uint8Array): string | undefined {
  const docType = docTypeFromDg1(dg1);
  return docType ? HEAVY_CIRCUIT_NAMES[docType] : undefined;
}
