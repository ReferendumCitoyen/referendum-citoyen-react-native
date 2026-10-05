/**
 * Is the register verifier deployed on Mainnet the one built for the circuit
 * we bundle?
 *
 * Rarimo replaced every register verifier on 2026-09-05 when the certificate
 * tree moved to a sha256 leaf, without a word: the circuits we shipped kept
 * proving the old leaf and every registration failed at the verifier. Their
 * release notes are explicit — "mixing old verifiers with new circuits (or the
 * reverse) makes registrations fail" — and this is the check that would have
 * said so on the day.
 *
 * A bb Solidity verifier hard-codes its verification key as 32-byte
 * constants, and the deployed bytecode carries them as PUSH32 immediates. So:
 * read `Registration2.passportVerifiers(keccak(zkType))`, fetch that
 * contract's code, and count how many of the release .sol's constants appear
 * in it. All of them → same key → the circuit in `assets/circuits/` is the one
 * the chain verifies against. Optionally repeat at an earlier block to show
 * the previous verifier did NOT match, i.e. that the check discriminates.
 *
 *   npx tsx scripts/verify-register-verifier.ts <circuitName> <verifier.sol> [<olderBlock>]
 *   e.g. npx tsx scripts/verify-register-verifier.ts registerIdentity_1_256_3_5_576_248_NA \
 *          /path/to/v0.2.7/registerIdentity_1_256_3_5_576_248_NA.sol 70000
 *
 * Read-only: nothing is sent.
 */
import fs from 'node:fs';
import { ethers } from 'ethers';
import {
  RARIME_MAINNET_CONFIG,
  MAINNET_REGISTRATION_CONTRACT_ADDRESS,
} from '@/constants/rarime-config';

const ZK_TYPE_PREFIX = 'Z_NOIR_PASSPORT';
const REGISTRATION2_ABI = ['function passportVerifiers(bytes32) view returns (address)'];

/** The 32-byte constants of a bb verifier: the verification key, plus a few
 *  that every verifier shares (the field modulus, generator points). Values
 *  that are all or nearly all zero are dropped — solc emits them as a short
 *  PUSH, and a 1–3 byte value is found in any bytecode, so they prove nothing. */
function vkConstants(sol: string): { constants: string[]; skipped: number } {
  const all = sol.match(/0x[0-9a-fA-F]{64}/g) ?? [];
  const distinct = Array.from(new Set(all.map((h) => h.slice(2).toLowerCase())));
  const constants = distinct.filter((c) => c.replace(/^(00)+/, '').length >= 8);
  return { constants, skipped: distinct.length - constants.length };
}

async function matchAt(
  contract: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  zkType: string,
  constants: string[],
  blockTag: number | 'latest',
): Promise<{ verifier: string; matched: number; missing: string[] }> {
  const verifier: string = await contract.passportVerifiers(zkType, { blockTag });
  if (verifier === ethers.ZeroAddress) return { verifier, matched: 0, missing: constants };
  const code = (await provider.getCode(verifier, blockTag)).toLowerCase();
  // solc shortens a PUSH32 whose value has leading zero bytes to the smallest
  // PUSHn that fits, so a constant like 0x0012… is in the bytecode without its
  // leading zeros. Search for the shortened form — but only when enough bytes
  // remain to mean anything; a 1–3 byte value is found in any bytecode.
  const present = (c: string): boolean => {
    if (code.includes(c)) return true;
    const short = c.replace(/^(00)+/, '');
    return short.length >= 8 && short.length < c.length && code.includes(short);
  };
  const missing = constants.filter((c) => !present(c));
  return { verifier, matched: constants.length - missing.length, missing };
}

async function main() {
  const [circuitName, solPath, olderBlockArg] = process.argv.slice(2);
  if (!circuitName || !solPath) {
    console.error('usage: verify-register-verifier.ts <circuitName> <verifier.sol> [<olderBlock>]');
    process.exit(2);
  }
  const suffix = circuitName.replace(/^registerIdentity/, '');
  const zkTypeName = `${ZK_TYPE_PREFIX}${suffix}`;
  const zkType = ethers.id(zkTypeName);
  const { constants, skipped } = vkConstants(fs.readFileSync(solPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl);
  const contract = new ethers.Contract(MAINNET_REGISTRATION_CONTRACT_ADDRESS, REGISTRATION2_ABI, provider);
  const latest = await provider.getBlockNumber();

  console.log(`circuit   ${circuitName}`);
  console.log(`zkType    ${zkTypeName} = ${zkType}`);
  console.log(`constants ${constants.length} discriminating 32-byte values in ${solPath} (${skipped} near-zero skipped)`);

  const now = await matchAt(contract, provider, zkType, constants, 'latest');
  console.log(`\n@${latest} (latest): verifier ${now.verifier} — ${now.matched}/${constants.length} constants present`);
  if (now.missing.length) console.log(`  missing: ${now.missing.map((m) => '0x' + m.slice(0, 12) + '…').join(', ')}`);

  if (olderBlockArg) {
    const older = Number(olderBlockArg);
    const then = await matchAt(contract, provider, zkType, constants, older);
    console.log(`@${older}: verifier ${then.verifier} — ${then.matched}/${constants.length} constants present`);
  }

  const verdict = now.missing.length === 0 ? 'MATCH — the deployed verifier was built for this circuit'
    : now.matched > constants.length / 2 ? 'PARTIAL — shared constants only; look at what is missing'
    : 'MISMATCH — the deployed verifier is for a different circuit';
  console.log(`\n${verdict}`);
  process.exit(now.missing.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
