#!/usr/bin/env node
/**
 * One-time keypair generator for the proposal-index signature.
 *
 * Generates a fresh Ed25519 keypair:
 *   - Prints the public key (hex) → paste into
 *     constants/proposal-index-signing.ts as PROPOSAL_INDEX_PUBLIC_KEY_HEX.
 *   - Prints the private key (hex) → add it as a GitHub Actions secret
 *     named PROPOSAL_INDEX_SIGNING_KEY in repo Settings → Secrets and
 *     variables → Actions.
 *
 * After this:
 *   - Editing public-data/proposals.json + pushing triggers the workflow,
 *     which signs the JSON with the secret and publishes both files.
 *   - The app fetches both and verifies the .sig against the pinned
 *     public key before trusting the list.
 *
 * Rotation: re-run this script. Update the constant + the secret. Old
 * installs will fail signature verification on the new list — they fall
 * back to the cached previous list (or the bundled fallback inside
 * utils/proposal-index.ts). Affected users vote on whichever proposals
 * the previous signed list named until they update the app.
 *
 * Usage:
 *   node scripts/generate-proposal-signing-key.mjs
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

// PKCS#8 DER for Ed25519 ends with the 32-byte raw seed; SPKI DER for
// Ed25519 ends with the 32-byte raw public key. Slice off the fixed-size
// ASN.1 prefix to get the raw 32-byte values that @noble/curves/ed25519
// (the in-app verifier) and Node's crypto.sign (the workflow signer)
// both accept.
const skDer = privateKey.export({ format: 'der', type: 'pkcs8' });
const pkDer = publicKey.export({ format: 'der', type: 'spki' });
const skHex = skDer.subarray(skDer.length - 32).toString('hex');
const pkHex = pkDer.subarray(pkDer.length - 32).toString('hex');

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  Proposal-index signing keypair (Ed25519)');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();
console.log('  Public key — commit into the app (overwrites placeholder):');
console.log('    File:  constants/proposal-index-signing.ts');
console.log('    Field: PROPOSAL_INDEX_PUBLIC_KEY_HEX');
console.log('    Value:');
console.log(`      ${pkHex}`);
console.log();
console.log('  Private key — add to GitHub Actions secrets:');
console.log('    Settings → Secrets and variables → Actions → New repository secret');
console.log('    Name:  PROPOSAL_INDEX_SIGNING_KEY');
console.log('    Value:');
console.log(`      ${skHex}`);
console.log();
console.log('  Treat the private key like a password — paste, then close the');
console.log('  terminal. The keypair is not written to disk by this script.');
console.log('═══════════════════════════════════════════════════════════════════');
