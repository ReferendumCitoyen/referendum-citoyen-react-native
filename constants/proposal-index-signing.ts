/**
 * Pinned Ed25519 public key used to verify the GitHub-Pages-hosted
 * `proposals.json`. The matching private key lives ONLY as the
 * `PROPOSAL_INDEX_SIGNING_KEY` GitHub Actions secret — the publish
 * workflow signs the JSON at deploy time and uploads both
 * `proposals.json` and `proposals.json.sig` to Pages.
 *
 * Setup (one-time): run `node scripts/generate-proposal-signing-key.mjs`,
 * paste the public key here, paste the private key into repo secrets.
 *
 * Trust model: this key gates which proposals appear in the list. It does
 * NOT gate the proposal contents — those still come from the on-chain
 * ProposalsState contract via `getProposalInfo(id)`. An attacker who
 * forged a signature could only insert a proposal ID into the displayed
 * list; the user would then call `getProposalInfo` on it and see whatever
 * the on-chain contract says (real proposal data, real voting target).
 * So a forgery surface is "phishing-like" — show a misleading list —
 * never "rewrite the ballot".
 *
 * Rotation: regenerate the keypair, replace this constant + the GH
 * secret, ship a new app build. Old installs reject the new list and
 * fall back to their cached previous list (or the bundled defaults in
 * utils/proposal-index.ts) until they update.
 */

// The key the list has been signed with since June 2026: its private half
// is the PROPOSAL_INDEX_SIGNING_KEY secret of the repository whose Pages
// serve proposals.json (the publish workflow signs on push), and nowhere
// else. 1.2.x carried this same value as a "placeholder" and did not
// enforce it; from 2.0 it is enforced. Rotate with
// `node scripts/generate-proposal-signing-key.mjs` (see its header) — the
// constant and the secret must change together, with an app release.
export const PROPOSAL_INDEX_PUBLIC_KEY_HEX =
  '2a022e4c0ad1a6edcaf9569e112c8408c843482ac6de0105075df84f0efd8130'; // nosec: public key, signs the published index since June 2026

/**
 * Verification is mandatory: an unsigned or badly signed list is refused and
 * the app keeps its last good copy (or the bundled one). Until 2.0 the key
 * above was treated as a placeholder and checking was soft-disabled; the
 * switch is gone — a future rotation replaces the constant, it never turns
 * checking off.
 */
export const PROPOSAL_INDEX_VERIFICATION_REQUIRED = true;
