// Shared Groth16 proof shapes for the witnesscalculator module.
//
// The Groth16 *register/auth* circuit registry that previously lived here
// (`supportedCircomCircuits`, `LocalCircomCircuitParams`,
// `ExternalCircomCircuitParams`, and the `calcWtnsAuth` /
// `calcWtnsRegisterIdentityUniversalRSA2048|4096` wrappers) was removed:
//   - Registration now runs through the Rarime SDK's Noir module, so that
//     whole path was dead code (never imported anywhere in the app).
//   - It was backed by RmoCalcs.aar, whose four arm64 prebuilts were
//     4 KB-aligned and blocked Android 15+ 16 KB page-size compatibility.
//
// The live Mainnet vote flow drives the query_identity witness calculator
// directly via `WitnesscalculatorModule.calcWtnsQueryIdentity` in
// utils/groth16-vote.ts — it does not use this barrel.

export type CircomZKProof = {
  proof: ProofData
  pub_signals: string[]
}

export type ProofData = {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
  protocol: string
}
