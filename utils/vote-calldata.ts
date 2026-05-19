/**
 * Build calldata for Mainnet `BioPassportVoting.vote(...)` and POST it to
 * Rarimo's `/integrations/proof-verification-relayer/v2/vote` endpoint.
 *
 * Why this file
 * -------------
 * The SDK's FreedomTool wraps a Noir-based vote flow that doesn't match
 * Mainnet's deployed contract — the live BioPassportVoting at
 * `0x8Dea8065888A14F66ba9Fb944353d898663863cf` exposes a Groth16 `vote(...)`
 * taking a VerifierHelper.ProofPoints tuple, not the Noir `executeNoir(...)`
 * that the SDK targets. This file builds the Groth16 calldata directly,
 * using the proof produced by utils/groth16-vote.ts.
 *
 * The function signature decoded from BlockScout
 * (https://evmscan.l2.rarimo.com/api?…&address=0x22556A82923eAeeC6960FA7881Ad5439651d1171):
 *
 *   vote(
 *     bytes32 registrationRoot_,
 *     uint256 currentDate_,
 *     uint256 proposalId_,
 *     uint256[] vote_,
 *     UserData userData_  { uint256 nullifier, uint256 citizenship,
 *                           uint256 identityCreationTimestamp },
 *     VerifierHelper.ProofPoints zkPoints_ { uint256[2] a,
 *                                            uint256[2][2] b,
 *                                            uint256[2] c }
 *   )
 *
 * Tail end (post-proof) of the Mainnet vote flow — utils/groth16-vote.ts
 * produces the proof, this file ABI-encodes the call + ships it to the
 * relayer, and the relayer broadcasts the tx to L2. No on-device wallet
 * signing.
 */

import { ethers } from 'ethers';
import type { Network } from '@/constants/rarime-config';
import { FREEDOM_TOOL_MAINNET_CONFIG } from '@/constants/rarime-config';
import type { Groth16Proof } from '@/utils/groth16-vote';

/** Deployed Mainnet BioPassportVoting (the proposal's `votingWhitelist[0]`).
 * Verified live as of 2026-05-19 against proposal #47. */
export const MAINNET_BIO_PASSPORT_VOTING_ADDRESS =
  '0x8Dea8065888A14F66ba9Fb944353d898663863cf';

/** Minimal ABI fragment for the deployed BioPassportVoting `vote(...)`.
 *
 * Source of truth: rarime-mobile-identity-sdk master `calldata.go`
 * `VotingMetaData.ABI` — the relayer 400s "invalid transaction data format"
 * if the selector doesn't match a whitelisted entry. The Solidity source in
 * passport-voting-contracts is stale w.r.t. the deployed implementation,
 * which exposes this `vote(...)` wrapper on top of AQueryProofExecutor's
 * internal `execute`.
 *
 * CRITICAL: `ProofPoints` uses STATIC ARRAYS `uint256[2]`, NOT tuples
 * `(uint256,uint256)`. Both encode 2 inline uint256s on the wire, BUT they
 * produce DIFFERENT function selectors. An earlier `(uint256,uint256)` form
 * caused the on-chain call to revert at "failed to estimate gas" because
 * the selector landed in the proxy fallback. */
const VOTE_ABI = [
  'function vote(' +
    'bytes32 registrationRoot_,' +
    'uint256 currentDate_,' +
    'uint256 proposalId_,' +
    'uint256[] vote_,' +
    '(uint256 nullifier, uint256 citizenship, uint256 identityCreationTimestamp) userData_,' +
    '(uint256[2] a, uint256[2][2] b, uint256[2] c) zkPoints_' +
    ')',
];

/**
 * Public-signal layout of the query_identity Groth16 circuit. Indices map
 * to what the on-chain verifier reads back. Source of truth: rarime-android-app's
 * VotingManager.kt + the cpp witnesscalc_queryIdentity.h header.
 *
 * The first three are user-derived (nullifier, citizenship reveal,
 * timestamp), the next ~ten are bounded check artefacts (current date,
 * registration root, …), and the rest depend on the selector mask.
 *
 * For our vote calldata we only need:
 *   [0]  nullifier
 *   [11] registrationRoot
 *   [13] currentDate  (TD3 layout — TD1 would be [14])
 *
 * Citizenship is provided externally (we pass it from the user's MRZ).
 */
const PUB_SIGNAL_NULLIFIER = 0;
const PUB_SIGNAL_REGISTRATION_ROOT_TD3 = 11;
const PUB_SIGNAL_CURRENT_DATE_TD3 = 13;

export interface BuildVoteCalldataArgs {
  /** The proof object from generateQueryGroth16Proof(). */
  proof: Groth16Proof;
  /** The proposal id the user is voting on (e.g., 47 from the rarime-app
   * QR code that resolves via api.freedomtool.org/i/qr/<uuid>). */
  proposalId: number | bigint;
  /** The vote option indices, one per question. For a binary proposal:
   * `[0]` (= "Yes" if Yes is index 0). The contract packs these as
   * `1 << index` so multi-choice proposals can OR multiple bits. We
   * apply that shift here. */
  voteIndices: number[];
  /** Three-letter MRZ nationality code (e.g. "FRA"). The contract reads
   * citizenship as `uint256(uint24(nationality_ascii_bytes))`. */
  citizenship: string;
  /** Whether the user re-registered after the proposal started. Forces a
   * different `identityCreationTimestamp` source in the proof — read off
   * the relevant pub_signal index. False for our standard case
   * (registered before the proposal). */
  isRegisteredAfterVoting?: boolean;
}

/** Pack vote indices into the `vote_` array the contract expects: each
 * element is `1 << index`. Multi-choice proposals would OR multiple bits
 * into a single element, but for our binary-vote use case there's one
 * element per question. */
function packVoteIndices(indices: number[]): bigint[] {
  return indices.map((i) => 1n << BigInt(i));
}

/** Decode 3-letter ASCII nationality (e.g. "FRA") to uint256 big-endian
 * byte concat. "FRA" → 0x465241 → 4607553. Matches what the Android
 * VotingManager does in `Numeric.hexStringToByteArray(0x0)` fallback or
 * `passport.personDetails.nationality.encodeToByteArray()` path. */
function citizenshipToUint256(citizenship: string): bigint {
  if (citizenship.length === 0) return 0n;
  // ASCII bytes, big-endian. So "FRA" → 0x46 << 16 | 0x52 << 8 | 0x41.
  let acc = 0n;
  for (const ch of citizenship) {
    acc = (acc << 8n) | BigInt(ch.charCodeAt(0));
  }
  return acc;
}

/** Convert a hex-or-decimal pub-signal string from the prover output into
 * a bigint. Rapidsnark emits decimal strings; some variants emit 0x-hex. */
function pubSignalToBigInt(s: string): bigint {
  if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
  return BigInt(s);
}

export interface VoteCalldataResult {
  /** ABI-encoded `vote(...)` calldata, 0x-prefixed. Hand directly to the
   * relayer's `tx_data` field. */
  calldata: string;
  /** The contract address to send to — pre-set from
   * MAINNET_BIO_PASSPORT_VOTING_ADDRESS. Use this as the relayer's
   * `destination` field. */
  destination: string;
  /** Decoded pub-signal values that went into the call, exposed for
   * logging / verification. */
  decoded: {
    registrationRoot: string; // bytes32 hex
    currentDate: bigint;
    nullifier: bigint;
    citizenship: bigint;
  };
}

/**
 * ABI-encode the vote() call. Pure function — no network I/O. The
 * `destination` field is also returned so the caller can pass both into the
 * relayer in one call.
 */
export function buildVoteCalldata(args: BuildVoteCalldataArgs): VoteCalldataResult {
  const { proof, proposalId, voteIndices, citizenship, isRegisteredAfterVoting } = args;

  // ---- Pub-signal extraction ---------------------------------------------
  const ps = proof.pub_signals;
  if (ps.length < 14) {
    throw new Error(
      `[buildVoteCalldata] expected ≥ 14 pub_signals (TD3 query layout), got ${ps.length}. ` +
      'Check that the proof came from the query_identity circuit, not a register circuit.',
    );
  }
  const nullifier = pubSignalToBigInt(ps[PUB_SIGNAL_NULLIFIER]);
  const registrationRootBig = pubSignalToBigInt(ps[PUB_SIGNAL_REGISTRATION_ROOT_TD3]);
  const registrationRoot = ethers.zeroPadValue(ethers.toBeHex(registrationRootBig), 32);
  const currentDate = pubSignalToBigInt(ps[PUB_SIGNAL_CURRENT_DATE_TD3]);

  // ---- Proof tuple → ProofPoints (a, b, c) -------------------------------
  // rapidsnark emits points with a trailing "1" for the z coordinate. The
  // contract's VerifierHelper.ProofPoints uses 2-element a and c, and a 2x2
  // b matrix. Strip the trailing 1 from pi_a/pi_c; for pi_b drop the third
  // (z) row entirely. The b row order is also swapped — Solidity expects
  // [[b[0][1], b[0][0]], [b[1][1], b[1][0]]] for BN254 pairing alignment
  // (Ethereum's precompile uses (b.imag, b.real) ordering); we mirror what
  // rarime-android-app's calldata.go::BuildVoteCalldata does.
  const a: [bigint, bigint] = [
    pubSignalToBigInt(proof.proof.pi_a[0]),
    pubSignalToBigInt(proof.proof.pi_a[1]),
  ];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [
      pubSignalToBigInt(proof.proof.pi_b[0][1]),
      pubSignalToBigInt(proof.proof.pi_b[0][0]),
    ],
    [
      pubSignalToBigInt(proof.proof.pi_b[1][1]),
      pubSignalToBigInt(proof.proof.pi_b[1][0]),
    ],
  ];
  const c: [bigint, bigint] = [
    pubSignalToBigInt(proof.proof.pi_c[0]),
    pubSignalToBigInt(proof.proof.pi_c[1]),
  ];

  // identityCreationTimestamp: 0 for the standard "registered before
  // proposal start" case. The contract's _buildPublicSignals branches on
  // > 0 to swap which bound is enforced — see BioPassportVoting.sol.
  // The 15th pub_signal carries the actual issue timestamp when the
  // user re-registered after voting started.
  //
  // The selector mask controls how many pub_signals the circuit emits —
  // when the timestamp-lowerbound bit isn't set, the array stops at index
  // 14. Guard before reading ps[15] so an unguarded access doesn't crash
  // with `Cannot convert undefined to a BigInt` (the message would be
  // useless in production).
  let identityCreationTimestamp: bigint;
  if (isRegisteredAfterVoting) {
    if (ps.length < 16) {
      throw new Error(
        `[buildVoteCalldata] isRegisteredAfterVoting=true but proof only has ${ps.length} pub_signals — ` +
        'the selector mask must include the identityCreationTimestamp bit so ps[15] is emitted. ' +
        'Check the selector passed to generateQueryGroth16Proof().',
      );
    }
    identityCreationTimestamp = pubSignalToBigInt(ps[15]);
  } else {
    identityCreationTimestamp = 0n;
  }

  const userData = {
    nullifier,
    citizenship: citizenshipToUint256(citizenship),
    identityCreationTimestamp,
  };

  const iface = new ethers.Interface(VOTE_ABI);
  const calldata = iface.encodeFunctionData('vote', [
    registrationRoot,
    currentDate,
    BigInt(proposalId),
    packVoteIndices(voteIndices),
    userData,
    { a, b, c },
  ]);

  return {
    calldata,
    destination: MAINNET_BIO_PASSPORT_VOTING_ADDRESS,
    decoded: {
      registrationRoot,
      currentDate,
      nullifier,
      citizenship: userData.citizenship,
    },
  };
}

// ---------------------------------------------------------------------------
// Relayer POST
// ---------------------------------------------------------------------------

const VOTE_RELAYER_PATH = '/integrations/proof-verification-relayer/v2/vote';

export interface SubmitVoteResult {
  /** Tx id returned by the relayer. Caller can poll
   * `https://scan.rarimo.com/tx/<id>` to confirm. */
  txId: string;
}

/** POST the encoded calldata to Rarimo's voteV2 endpoint. Same body shape
 * the Android app uses (rarime-android-app/VotingApi.kt::voteV2 +
 * SendTransactionRequest model). */
export async function submitVote(
  network: Network,
  calldata: string,
  destination: string,
): Promise<SubmitVoteResult> {
  if (network !== 'mainnet') {
    throw new Error(
      '[submitVote] only Mainnet vote relayer is wired. Switch network in Settings.',
    );
  }

  const url = FREEDOM_TOOL_MAINNET_CONFIG.api.votingRelayerUrl + VOTE_RELAYER_PATH;
  // JSON:API envelope — the relayer 400s with "cannot be blank: data/tx_data"
  // if `tx_data` is at the top of `data` rather than inside `attributes`.
  // Source of truth: rarime-android-app VoteV2Request.kt + VotingApiManager.kt::voteV2.
  const body = {
    data: {
      type: 'send_transaction',
      attributes: {
        tx_data: calldata,
        destination,
      },
    },
  };
  console.log(`[submitVote] POST ${url} (destination=${destination}, calldataLen=${calldata.length})`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `[submitVote] relayer ${response.status} ${response.statusText}: ${errBody}`,
    );
  }
  const parsed = await response.json();
  const txId: string | undefined = parsed?.data?.id ?? parsed?.data?.attributes?.tx_hash;
  if (!txId) {
    throw new Error(`[submitVote] relayer response missing tx id: ${JSON.stringify(parsed)}`);
  }
  console.log(`[submitVote] relayer accepted: txId=${txId}`);
  return { txId };
}
