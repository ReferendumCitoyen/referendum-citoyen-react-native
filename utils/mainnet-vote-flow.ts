/**
 * Mainnet vote orchestrator. Each on-chain read here is a 1-to-1 mirror of
 * what rarime-android-app's `manager/VotingManager.kt::vote(...)` does on
 * Rarimo Mainnet — same contracts, same selectors, same arg shapes. The
 * goal is to keep our calldata identical to a successful rarime-app vote
 * (so e.g. a relayer that whitelists certain payloads doesn't reject us
 * for a cosmetic difference).
 *
 * Sequence (with Android references):
 *
 *   1. compute passportInfoKey = passport.getPassportHash()
 *      ↳ Android: passportManager.getPassportInfoKey(eDoc, regProof)
 *        which returns regProof.getPassportHash() for no-AA passports.
 *
 *   2. compute proofIndex = Poseidon([passportInfoKey, profileKey])
 *      ↳ Android: passportManager.getProofIndex(passportInfoKey)
 *        → Identity.calculateProofIndex(passportInfoKey, identityKey)
 *        which is the same Poseidon2 hash. profileKey == identityKey for
 *        the SDK's BJJ derivation (verified by getDocumentStatus
 *        returning REGISTERED_WITH_THIS_PK earlier in this session).
 *
 *   3. RegistrationSmt.getProof(proofIndex)
 *      ↳ Android: registrationSmtContract.getProof(proofIndex).send()
 *      Returns SparseMerkleTree.Proof — we keep root + siblings.
 *
 *   4. StateKeeper.getPassportInfo(passportInfoKeyBytes32)
 *      ↳ Android: stateKeeperContract.getPassportInfo(...).send()
 *      Returns (PassportInfo, IdentityInfo) — we need
 *      identityInfo.issueTimestamp + passportInfo.identityReissueCounter.
 *
 *   5. ProposalsState.getProposalConfig(proposalId)
 *      ↳ Android: stored locally in the Poll model, originally fetched the
 *        same way. We decode ProposalRules from votingWhitelistData[0]
 *        because the deployed BioPassportVoting's getProposalRules()
 *        view reverts ("no data present" — function not in the live
 *        implementation, see [[mainnet-voting-groth16]]).
 *
 *   6. ProposalsState.getProposalEventId(proposalId)
 *      ↳ Android: poll.eventId (cached locally). Same value.
 *
 *   7. RegistrationSmt.ROOT_VALIDITY()
 *      ↳ Android: testnetContractManager.getPoseidonSMT(...).ROOT_VALIDITY()
 *        (Yes — Android calls it "testnetContractManager" even on Mainnet;
 *        the rename never propagated.)
 *
 *   8. profile.calculateVotingEventData(pollResultJson)
 *      ↳ Android: same call. eventData = keccak248(abi.encode(vote_)).
 *      We replicate this off-line — pure computation, no chain.
 *
 *   9. buildQueryIdentityInputs(...) → JSON
 *      ↳ Android: profile.buildQueryIdentityInputs(...)
 *      (utils/query-identity-inputs.ts in this repo)
 *
 *  10. generateQueryGroth16Proof(inputs) — witnesscalc + rapidsnark
 *      ↳ Android: ZKPUseCase.generateZKP("circuit_query_zkey.zkey",
 *                                         R.raw.query_identity_dat, ...)
 *      (utils/groth16-vote.ts in this repo)
 *
 *  11. buildVoteCalldata(...) → ABI-encoded vote()
 *      ↳ Android: CallDataBuilder.buildVoteCalldata(...) — the Go side
 *      packs the same tuple. We verified the deployed ABI from BlockScout
 *      so the encoding matches.
 *
 *  12. POST to /integrations/proof-verification-relayer/v2/vote
 *      ↳ Android: votingApiManager.voteV2(callData, destination).
 *
 * Any deviation from this list is a bug.
 */

import { ethers, keccak256 } from 'ethers';
import { Poseidon as IdenPoseidon } from '@iden3/js-crypto';
import {
  RARIME_MAINNET_CONFIG,
  MAINNET_REGISTRATION_CONTRACT_ADDRESS,
} from '@/constants/rarime-config';
import {
  buildQueryIdentityInputs,
  type RegistrationSmtProof,
} from '@/utils/query-identity-inputs';
import {
  generateQueryGroth16Proof,
  type Groth16Proof,
  type ZkeyDownloadProgress,
} from '@/utils/groth16-vote';
import {
  buildVoteCalldata,
  submitVote,
  MAINNET_BIO_PASSPORT_VOTING_ADDRESS,
} from '@/utils/vote-calldata';
// Single source of truth for the MRZ 2-digit-year cutoff. Birth dates use
// the `>35` rule (people born 1936-2035), expiry dates use the legacy `>=50`
// cutoff. Do NOT reintroduce a local `yy >= 70` (or any other) rule here —
// that was the bug that turned a YY=65 fixture into "naissance le 2065-…"
// in the diagnostic error message.
import { expandMrzBirthYear, expandMrzExpiryYear } from '@/utils/mrzDate';

// ---------------------------------------------------------------------------
// Contract ABIs (the minimal slices we need). Decoded from BlockScout
// against the deployed Mainnet implementations:
//   StateKeeper      0x61aa5b68D811884dA4FEC2De4a7AA0464df166E1
//   RegistrationSMT  0x479F84502Db545FA8d2275372E0582425204A879
//   ProposalsState   0x9C4b84a940C9D3140a1F40859b3d4367DC8d099a
// All three were probed live during the 2026-05-19 session; the ABI
// fragments here are the exact shapes those calls return.
// ---------------------------------------------------------------------------

const STATE_KEEPER_ABI = [
  // Returns (PassportInfo, IdentityInfo) tuple. We only consume two fields:
  //   identityInfo.issueTimestamp        → for the "registered before
  //                                         proposal start" check
  //   passportInfo.identityReissueCounter → identityCounter circuit input
  'function getPassportInfo(bytes32 passportKey_) view returns (' +
    '(bytes32 activeIdentity, uint64 identityReissueCounter) passportInfo,' +
    '(bytes32 activePassport, uint64 issueTimestamp) identityInfo' +
    ')',
];

const REGISTRATION_SMT_ABI = [
  'function getProof(bytes32 key_) view returns (tuple(bytes32 root, bytes32[] siblings, bool existence, bytes32 key, bytes32 value, bool auxExistence, bytes32 auxKey, bytes32 auxValue))',
  'function ROOT_VALIDITY() view returns (uint256)',
];

const PROPOSALS_STATE_ABI = [
  'function getProposalConfig(uint256) view returns (tuple(uint64 startTimestamp, uint64 duration, uint256 multichoice, uint256[] acceptedOptions, string description, address[] votingWhitelist, bytes[] votingWhitelistData) config)',
  'function getProposalEventId(uint256) view returns (uint256)',
  // Per-proposal info — we only need the proposalSMT field, which is the
  // SparseMerkleTree that records used vote-nullifiers. Used for the
  // already-voted pre-flight check so the user gets a friendly error before
  // a full proof generation + relayer submission.
  'function getProposalInfo(uint256) view returns (tuple(address proposalSMT, uint8 status, tuple(uint64 startTimestamp, uint64 duration, uint256 multichoice, uint256[] acceptedOptions, string description, address[] votingWhitelist, bytes[] votingWhitelistData) config, uint256[8][] votingResults))',
];

const MAINNET_STATE_KEEPER_ADDRESS = RARIME_MAINNET_CONFIG.contractsConfiguration.stateKeeperAddress;
const MAINNET_REGISTRATION_SMT_ADDRESS = RARIME_MAINNET_CONFIG.contractsConfiguration.poseidonSmtAddress;
const MAINNET_PROPOSALS_STATE_ADDRESS = '0x9C4b84a940C9D3140a1F40859b3d4367DC8d099a';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poseidon([a, b]) → decimal string. Matches the on-chain
 * `PoseidonUnit2L.poseidon([uint256, uint256])` used in `StateKeeper.addBond`
 * to compute the RegistrationSMT leaf index. */
function poseidon2(a: bigint, b: bigint): bigint {
  return IdenPoseidon.hash([a, b]);
}

/** Pad a bigint to 32-byte hex with 0x prefix. */
function toBytes32(v: bigint | string): string {
  const big = typeof v === 'bigint' ? v : BigInt(v);
  return ethers.zeroPadValue(ethers.toBeHex(big), 32);
}

/** keccak248 of abi.encode(uint256[]).
 *
 * The on-chain vote contract uses
 *   uint256(uint248(uint256(keccak256(abi.encode(vote_)))))
 * to commit to the vote array in the proof's `event_data`. Truncating
 * keccak256 to 248 bits keeps it inside the BN254 field. We reproduce that
 * here for the proof inputs. */
function computeVotingEventData(voteIndicesAsBits: bigint[]): bigint {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [voteIndicesAsBits]);
  const hash = BigInt(keccak256(encoded));
  // Truncate to 248 bits (drop the top 8 bits).
  const MASK_248 = (1n << 248n) - 1n;
  return hash & MASK_248;
}

// ---------------------------------------------------------------------------
// On-chain reads — each one mirrors a specific Android call.
// ---------------------------------------------------------------------------

interface OnChainContext {
  passportInfoKey: bigint;        // the SMT/lookup key (= passportHash for no-AA)
  identityKey: bigint;            // = profileKey (Poseidon BJJ derivation)
  proofIndex: bigint;             // = Poseidon([passportInfoKey, identityKey])
  smtProof: RegistrationSmtProof;
  issueTimestamp: bigint;
  identityReissueCounter: bigint;
  proposalRules: ProposalRules;
  proposalEventId: bigint;
  rootValidity: bigint;
}

interface ProposalRules {
  selector: bigint;
  citizenshipWhitelist: bigint[];
  identityCreationTimestampUpperBound: bigint;
  identityCounterUpperBound: bigint;
  sex: bigint;
  birthDateLowerbound: bigint;
  birthDateUpperbound: bigint;
  expirationDateLowerBound: bigint;
}

/** Decode `votingWhitelistData[thisId]` as `BaseVoting.ProposalRules`. The
 * deployed BioPassportVoting has no public `getProposalRules` view (the
 * source repo's version isn't in the live implementation — confirmed by
 * `getProposalRules()` reverting with "no data present" against
 * `0x22556A82923eAeeC6960FA7881Ad5439651d1171`). Caller decodes the bytes
 * blob themselves, matching what the on-chain contract does internally. */
function decodeProposalRules(rulesBytes: string): ProposalRules {
  const types = [
    'tuple(uint256 selector, uint256[] citizenshipWhitelist, uint256 identityCreationTimestampUpperBound, uint256 identityCounterUpperBound, uint256 sex, uint256 birthDateLowerbound, uint256 birthDateUpperbound, uint256 expirationDateLowerBound)',
  ];
  const [decoded] = ethers.AbiCoder.defaultAbiCoder().decode(types, rulesBytes) as any;
  return {
    selector: decoded.selector,
    citizenshipWhitelist: Array.from(decoded.citizenshipWhitelist as readonly bigint[]),
    identityCreationTimestampUpperBound: decoded.identityCreationTimestampUpperBound,
    identityCounterUpperBound: decoded.identityCounterUpperBound,
    sex: decoded.sex,
    birthDateLowerbound: decoded.birthDateLowerbound,
    birthDateUpperbound: decoded.birthDateUpperbound,
    expirationDateLowerBound: decoded.expirationDateLowerBound,
  };
}

async function readOnChainContext(args: {
  provider: ethers.JsonRpcProvider;
  passportInfoKey: bigint;
  identityKey: bigint;
  proposalId: bigint;
  bioPassportVotingAddress: string;
}): Promise<OnChainContext> {
  const { provider, passportInfoKey, identityKey, proposalId, bioPassportVotingAddress } = args;

  const stateKeeper = new ethers.Contract(MAINNET_STATE_KEEPER_ADDRESS, STATE_KEEPER_ABI, provider);
  const regSmt = new ethers.Contract(MAINNET_REGISTRATION_SMT_ADDRESS, REGISTRATION_SMT_ABI, provider);
  const proposalsState = new ethers.Contract(MAINNET_PROPOSALS_STATE_ADDRESS, PROPOSALS_STATE_ABI, provider);

  const proofIndex = poseidon2(passportInfoKey, identityKey);
  // SECURITY: the proofIndex is a stable per-(passport, identity) hash —
  // logging it in release would let logcat readers correlate the same
  // user across proposals. Keep it for dev diagnostics only.
  if (__DEV__) {
    console.log(`[mainnet-vote] proofIndex (SMT leaf) = ${toBytes32(proofIndex)}`);
  }

  // Fire the 4 reads in parallel — they're independent.
  const [smtProofRaw, passportInfoTuple, proposalConfig, proposalEventId, rootValidity] = await Promise.all([
    regSmt.getProof(toBytes32(proofIndex)),
    stateKeeper.getPassportInfo(toBytes32(passportInfoKey)),
    proposalsState.getProposalConfig(proposalId),
    proposalsState.getProposalEventId(proposalId),
    regSmt.ROOT_VALIDITY(),
  ]);

  if (!smtProofRaw.existence) {
    throw new Error(
      `[mainnet-vote] RegistrationSMT.getProof(${toBytes32(proofIndex)}) returned existence=false. ` +
      'The identity is not yet registered on Mainnet for this passport+BJJ pair. ' +
      'Restore the original key via Settings or register the passport first.',
    );
  }
  console.log(`[mainnet-vote] SMT proof OK: root=${smtProofRaw.root}, siblings=${smtProofRaw.siblings.length}`);

  // Find this voting contract's slot in the whitelist (the rules are
  // per-voting-contract, indexed by position).
  const whitelist: string[] = Array.from(proposalConfig.votingWhitelist as readonly string[]).map((s) => s.toLowerCase());
  const thisId = whitelist.indexOf(bioPassportVotingAddress.toLowerCase());
  if (thisId === -1) {
    // We only reach this branch when castMainnetVote was called for a
    // proposal NOT bound to BioPassportVoting (`0x8Dea8065…`). After the
    // Step11 routing fix (2026-05-21), only TD3 passports take this code
    // path — TD1 ID cards now go through freedomTool.submitProposal which
    // auto-routes per proposal.sendVoteContractAddress. So this error
    // means: TD3 passport holder hit a proposal whose votingWhitelist[0]
    // is IDCardVoting (`0x7d73513d64ee…`) — the proposal is reserved for
    // CNIe holders, not passport holders. Step11's error handler strips
    // the `[VOTE_INELIGIBLE]` prefix and shows the message verbatim.
    throw new Error(
      "[VOTE_INELIGIBLE] Ce scrutin est réservé aux porteurs de carte " +
      "nationale d'identité (CNIe) — il n'est pas accessible avec un " +
      "passeport. Choisissez un autre scrutin dans la liste sur l'écran " +
      "d'accueil.",
    );
  }
  const rulesBytes: string = proposalConfig.votingWhitelistData[thisId];
  const proposalRules = decodeProposalRules(rulesBytes);

  return {
    passportInfoKey,
    identityKey,
    proofIndex,
    smtProof: {
      root: smtProofRaw.root,
      siblings: Array.from(smtProofRaw.siblings as readonly string[]),
    },
    issueTimestamp: passportInfoTuple.identityInfo.issueTimestamp,
    identityReissueCounter: passportInfoTuple.passportInfo.identityReissueCounter,
    proposalRules,
    proposalEventId,
    rootValidity,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface CastMainnetVoteArgs {
  /** DG1 bytes from the NFC scan. */
  dg1: Uint8Array;
  /** BJJ private key as 64-char hex (no 0x prefix), from SecureStore. */
  bjjPrivateKeyHex: string;
  /** Passport hash that the SDK / on-chain registration uses as the
   * passport key. For no-AA passports this equals `passport.getPassportHash()`
   * from the Rarime SDK. Decimal string OR bigint OR 0x-hex — we coerce. */
  passportHash: bigint | string;
  /** Profile key from `RarimeUtils.getProfileKey(privateKey)`. Same coercion. */
  profileKey: bigint | string;
  /** Proposal id (the QR-resolved metadata.proposal_id, e.g. 47). */
  proposalId: number | bigint;
  /** Three-letter ASCII nationality, e.g. "FRA". From MRZ
   * personDetails.nationality. */
  citizenship: string;
  /** The selected option indices, one per question. Binary proposal:
   * `[0]` for "Yes", `[1]` for "No", etc. */
  voteIndices: number[];
  /** Optional callback invoked while the 757 MB zkey is being fetched on
   * first vote. Subsequent votes reuse the cached file. */
  onZkeyProgress?: (p: ZkeyDownloadProgress) => void;
}

export interface CastMainnetVoteResult {
  txId: string;
  proofGenerationMs: number;
  totalElapsedMs: number;
}

/**
 * End-to-end vote on Mainnet. Reads chain state, generates the Groth16
 * proof, encodes the vote() calldata, submits to the relayer, returns the
 * tx id.
 *
 * Expected runtime on the Volla Phone X23 — dominated by proof generation:
 *   ~5–10 s for the 4 parallel on-chain reads (one connection, batched)
 *   ~30–60 s witnesscalc + rapidsnark prove
 *   ~1–2 s relayer POST + response
 *
 * First-run additionally pays for the 757 MB zkey download (network
 * dependent — minutes on a typical mobile connection). The onZkeyProgress
 * callback should drive a UI progress bar; otherwise the user sees a
 * silent ~ten-minute wait.
 */
export async function castMainnetVote(args: CastMainnetVoteArgs): Promise<CastMainnetVoteResult> {
  const t0 = Date.now();
  const passportInfoKey = typeof args.passportHash === 'bigint'
    ? args.passportHash
    : BigInt(args.passportHash);
  const identityKey = typeof args.profileKey === 'bigint'
    ? args.profileKey
    : BigInt(args.profileKey);
  const proposalId = BigInt(args.proposalId);

  // SECURITY: citizenship is a 3-letter country code and falls through the
  // logger's PII redaction (too short for the digit-length filter, label
  // not in PII_LABELS until 2026-05-24). Keep the full line dev-only and
  // emit an abstract version in release so the error-report buffer doesn't
  // hold the country.
  if (__DEV__) {
    console.log(`[mainnet-vote] starting cast — proposal=${proposalId}, citizenship="${args.citizenship}", voteIndices=[${args.voteIndices.join(',')}]`);
    // passportInfoKey + identityKey together are the stable per-passport
    // pseudonym used by every Rarimo contract. Logging them in release
    // exposes cross-proposal correlation via logcat.
    console.log(`[mainnet-vote] passportInfoKey=${toBytes32(passportInfoKey)} identityKey=${toBytes32(identityKey)}`);
  } else {
    console.log(`[mainnet-vote] starting cast — proposal=${proposalId}, voteIndices=[${args.voteIndices.join(',')}]`);
  }

  const provider = new ethers.JsonRpcProvider(RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl);
  const ctx = await readOnChainContext({
    provider,
    passportInfoKey,
    identityKey,
    proposalId,
    bioPassportVotingAddress: MAINNET_BIO_PASSPORT_VOTING_ADDRESS,
  });

  // Pre-flight: has this user already voted on this proposal? The vote
  // contract stores a per-proposal SMT of used nullifiers; if our nullifier
  // is already there, the relayer would accept the call, but the on-chain
  // BaseVoting would revert with InvalidZKProof (the recomputed pub signals
  // would include our nullifier but the vote SMT insertion would fail).
  // Checking here saves ~6 s of proof generation + a confusing relayer error.
  // Mirrors FreedomTool.isAlreadyVoted in the SDK (used by the testnet
  // path's ft.verify()) — same nullifier formula:
  //   nullifier = Poseidon3(sk, Poseidon1(sk), eventId)
  // and same lookup in the proposalSmtAddress contract.
  const proposalsStateForVoteCheck = new ethers.Contract(
    MAINNET_PROPOSALS_STATE_ADDRESS,
    PROPOSALS_STATE_ABI,
    provider,
  );
  const proposalSmtAddress: string = (await proposalsStateForVoteCheck.getProposalInfo(proposalId)).proposalSMT;
  const skBigInt = BigInt(
    '0x' + (args.bjjPrivateKeyHex.startsWith('0x') ? args.bjjPrivateKeyHex.slice(2) : args.bjjPrivateKeyHex),
  );
  const skHashed = IdenPoseidon.hash([skBigInt]);
  const voteNullifier = IdenPoseidon.hash([skBigInt, skHashed, ctx.proposalEventId]);
  const voteNullifierBytes32 = toBytes32(voteNullifier);
  const voteSmt = new ethers.Contract(proposalSmtAddress, REGISTRATION_SMT_ABI, provider);
  const usedProof = await voteSmt.getProof(voteNullifierBytes32);
  if (usedProof.existence) {
    // Nullifier is per-(BJJ key, proposal); logging it in release lets a
    // logcat reader correlate the same user across proposals once the
    // hash is captured. Keep the full bytes32 dev-only and the release
    // log abstract.
    if (__DEV__) {
      console.log(`[mainnet-vote] already voted: nullifier ${voteNullifierBytes32} exists in proposalSMT ${proposalSmtAddress}`);
    } else {
      console.log(`[mainnet-vote] already voted (nullifier hit in proposalSMT)`);
    }
    // Match the SDK's "User has already voted" wording so Step11.tsx's error
    // handler routes to the friendly already-voted screen.
    throw new Error('User has already voted');
  }
  if (__DEV__) {
    console.log(`[mainnet-vote] not voted yet: nullifier ${voteNullifierBytes32} absent in proposalSMT ${proposalSmtAddress}`);
  } else {
    console.log(`[mainnet-vote] not voted yet (nullifier absent in proposalSMT)`);
  }

  // Compute identityCreationTimestampUpperBound — mirrors the Android
  // VotingManager logic. Two cases:
  //
  //   (a) Registered BEFORE proposal start (issueTimestamp <= rules.upper):
  //       timestampUpperbound = rules.upper - ROOT_VALIDITY
  //       identityCounterUpperbound = UINT32_MAX (no per-passport cap)
  //
  //   (b) Registered AFTER proposal start (issueTimestamp > rules.upper):
  //       timestampUpperbound = issueTimestamp + 1
  //       identityCounterUpperbound = rules.identityCounterUpperBound
  //
  // History: OTA #4 briefly switched (b) to UINT64_MAX - 1 to mirror the
  // Rarime JS SDK's Freedomtool.buildQueryProofParams (Freedomtool.js:206-211).
  // That SDK targets a Noir circuit; OUR app runs Circom + Groth16 + witnesscalc
  // (assets/circuits/query_identity.dat + Groth16 zkey). The Noir sentinel
  // is rejected by our Circom circuit — witnesscalc fires "Error loading
  // signal timestampUpperbound / assert failed" on the first signal load.
  // Empirically `issueTimestamp + 1n` is the value that works for our
  // circuit (proven by a successful Mainnet vote on commit d676dd5 using
  // this exact value). Reverted in this commit. The corresponding
  // identityCreationTimestamp in the vote calldata (utils/vote-calldata.ts)
  // is reverted to read pub_signals[15] for the same reason.
  let identityCreationTimestampUpperBound =
    ctx.proposalRules.identityCreationTimestampUpperBound - ctx.rootValidity;
  let identityCounterUpperBound = (1n << 32n) - 1n; // UINT32_MAX, the IDENTITY_LIMIT default
  let isRegisteredAfterVoting = false;

  if (ctx.issueTimestamp > ctx.proposalRules.identityCreationTimestampUpperBound) {
    if (ctx.identityReissueCounter > ctx.proposalRules.identityCounterUpperBound) {
      throw new Error(
        `[mainnet-vote] uniqueness violation — passport reissue counter ` +
        `${ctx.identityReissueCounter} > rules.identityCounterUpperBound ` +
        `${ctx.proposalRules.identityCounterUpperBound}. This identity cannot ` +
        `be uniquely verified for this proposal.`,
      );
    }
    identityCreationTimestampUpperBound = ctx.issueTimestamp + 1n;
    identityCounterUpperBound = ctx.proposalRules.identityCounterUpperBound;
    isRegisteredAfterVoting = true;
    console.log('[mainnet-vote] re-registered after proposal start — isRegisteredAfterVoting=true');
  }

  // event_data = keccak248 of abi.encode(vote_) — same as on-chain
  // BioPassportVoting._buildPublicSignals does.
  const voteIndicesAsBits = args.voteIndices.map((i) => 1n << BigInt(i));
  const eventData = computeVotingEventData(voteIndicesAsBits);

  const inputs = buildQueryIdentityInputs({
    dg1: args.dg1,
    smtProof: ctx.smtProof,
    selector: ctx.proposalRules.selector.toString(10),
    pkPassportHash: passportInfoKey.toString(10),
    issueTimestamp: ctx.issueTimestamp.toString(10),
    identityCounter: ctx.identityReissueCounter.toString(10),
    eventId: '0x' + ctx.proposalEventId.toString(16),
    eventData: '0x' + eventData.toString(16),
    timestampLowerbound: '0',
    timestampUpperbound: identityCreationTimestampUpperBound.toString(10),
    identityCounterLowerbound: '0',
    identityCounterUpperbound: identityCounterUpperBound.toString(10),
    expirationDateLowerbound: '0x' + ctx.proposalRules.expirationDateLowerBound.toString(16),
    // ZERO_IN_HEX = "0x303030303030" = ASCII "000000" — the *encoded* form of
    // the all-zeros YYMMDD date. The circuit's DateDecoder runs on every date
    // input (regardless of selector) and asserts the input is a valid UTF-8
    // YYMMDD encoding via DateEncoder.encoded === dateEncoded. A literal
    // 0x000000 (three nul bytes) is NOT a valid encoding and fires
    // "assert failed" inside witnesscalc. Match the Android Rarime app's
    // `ZERO_IN_HEX` constant verbatim.
    expirationDateUpperbound: '0x303030303030',
    birthDateLowerbound: '0x' + ctx.proposalRules.birthDateLowerbound.toString(16),
    birthDateUpperbound: '0x' + ctx.proposalRules.birthDateUpperbound.toString(16),
    citizenshipMask: '0x0', // BioPassportVoting passes the user's citizenship directly via UserData
    skIdentityDecimal: BigInt(
      '0x' + (args.bjjPrivateKeyHex.startsWith('0x') ? args.bjjPrivateKeyHex.slice(2) : args.bjjPrivateKeyHex),
    ).toString(10),
  });

  const tProveStart = Date.now();
  let proof;
  try {
    proof = await generateQueryGroth16Proof({
      inputs,
      onZkeyProgress: args.onZkeyProgress,
    });
  } catch (e: any) {
    // Witnesscalc reports any in-circuit assert failure as
    //   "Error loading signal <last-alphabetic-signal>\nassert failed"
    // (the signal name is just whichever was set last when run() fired;
    // the actual failing constraint is somewhere else). We diagnose the
    // likely cause from the proposal rules + passport MRZ data and
    // re-throw with a user-facing French message that Step11 can
    // recognize via its [VOTE_INELIGIBLE] prefix.
    const msg = e?.message ?? '';
    if (msg.includes('Error loading signal') && msg.includes('assert failed')) {
      const reason = diagnoseIneligibility({
        dg1: args.dg1,
        selector: ctx.proposalRules.selector,
        expirationDateLowerBound: ctx.proposalRules.expirationDateLowerBound,
        birthDateLowerbound: ctx.proposalRules.birthDateLowerbound,
        birthDateUpperbound: ctx.proposalRules.birthDateUpperbound,
        skIdentity: inputs.skIdentity as string,
      });
      if (reason) throw new Error(`[VOTE_INELIGIBLE] ${reason}`);
    }
    throw e;
  }
  const proofMs = Date.now() - tProveStart;
  console.log(`[mainnet-vote] proof generated in ${proofMs}ms — pub_signals=${proof.pub_signals.length}`);
  // Dump pub_signals so we can compare against what the contract's
  // _buildPublicSignals recomputed (which is what shows up in
  // InvalidZKProof(uint256[]) revert data when the call fails to estimate
  // gas). Any divergence here is the proof/contract pub-signals mismatch.
  // SECURITY: pub_signals contain the per-passport nullifier + identity
  // commitments. Dev-only to avoid logcat correlation.
  if (__DEV__) {
    proof.pub_signals.forEach((v, i) => {
      let asHex: string;
      try {
        asHex = '0x' + BigInt(v).toString(16);
      } catch {
        asHex = String(v);
      }
      console.log(`[mainnet-vote][pub] ${String(i).padStart(2)}: ${asHex}`);
    });
  }

  // When the proposal's citizenshipWhitelist is empty, the circuit's
  // citizenship reveal bit (selector[5]) is also OFF, so the circuit outputs
  // pub[6] = 0. BioPassportVoting._buildPublicSignals UNCONDITIONALLY writes
  // pub[6] = userData_.citizenship, so the on-chain verifier rejects with
  // InvalidZKProof unless we pass userData_.citizenship = 0 in that case.
  // Source: rarime-android-app VotingManager.kt — passes " " (decoded
  // from "0x0") when `citizenshipWhitelist.isEmpty()`. The empty string is
  // the equivalent here (citizenshipToUint256 short-circuits to 0n on length
  // 0 — see vote-calldata.ts).
  const effectiveCitizenship = ctx.proposalRules.citizenshipWhitelist.length === 0
    ? ''
    : args.citizenship;
  const { calldata, destination, decoded } = buildVoteCalldata({
    proof,
    proposalId,
    voteIndices: args.voteIndices,
    citizenship: effectiveCitizenship,
    isRegisteredAfterVoting,
  });
  // SECURITY: `nullifier` + `registrationRoot` together let a logcat
  // reader correlate this vote with future votes from the same user.
  // Full calldata also embeds the nullifier in its bytes. Both dev-only.
  if (__DEV__) {
    console.log(
      `[mainnet-vote] vote calldata: dest=${destination} nullifier=${decoded.nullifier} ` +
      `currentDate=${decoded.currentDate} registrationRoot=${decoded.registrationRoot}`,
    );
    console.log(`[mainnet-vote] full calldata=${calldata}`);
  } else {
    console.log(`[mainnet-vote] vote calldata: dest=${destination} currentDate=${decoded.currentDate}`);
  }

  const { txId } = await submitVote('mainnet', calldata, destination);
  const total = Date.now() - t0;
  console.log(`[mainnet-vote] DONE — txId=${txId} total=${total}ms (prove=${proofMs}ms)`);

  return { txId, proofGenerationMs: proofMs, totalElapsedMs: total };
}

/** Re-export so call sites can avoid touching identityKey defaults. */
export { MAINNET_REGISTRATION_CONTRACT_ADDRESS };

// ---------------------------------------------------------------------------
// Eligibility diagnostics. Triggered AFTER witnesscalc throws — we know a
// circuit assert fired but witnesscalc only reports the last-alphabetic
// signal name, so we re-check the most common failing constraints against
// the proposal rules + passport MRZ to surface a specific French message.
// ---------------------------------------------------------------------------

/** Decode an encoded YYMMDD bigint (e.g. 0x323630353138 = "260518") into
 * a YYMMDD string. Returns null if the value isn't a valid encoding (in
 * which case the constraint wouldn't be enforced anyway). */
function decodeYymmdd(b: bigint): string | null {
  // Up to 6 ASCII bytes; right-aligned in the bigint (high bits = first char).
  const hex = b.toString(16).padStart(12, '0');
  if (hex.length !== 12) return null;
  let out = '';
  for (let i = 0; i < 12; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c < 0x30 || c > 0x39) return null;
    out += String.fromCharCode(c);
  }
  return out;
}

/** Convert YYMMDD → YYYY-MM-DD for diagnostic error-message display only.
 * Delegates century expansion to the shared helpers in utils/mrzDate.ts so
 * there is exactly one place that decides "YY=65 is 1965, not 2065". The
 * caller passes the date's semantic role ('birth' | 'expiry') because the
 * two contexts use different ICAO cutoffs (see expandMrzBirthYear /
 * expandMrzExpiryYear).
 *
 * History: a previous local `yy >= 70` rule formatted a voter born
 * 1965-04-14 as "2065-04-14" in `diagnoseIneligibility`'s age-rule message,
 * which mis-blamed Bug 2 (malformed BJJ key) as an age ineligibility two
 * reports in a row before the cause was identified. Do NOT reintroduce a
 * local cutoff here — route through the shared helpers. */
function yymmddToFullDate(yymmdd: string, mode: 'birth' | 'expiry'): string {
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const yyyy = mode === 'birth' ? expandMrzBirthYear(yy) : expandMrzExpiryYear(yy);
  return `${yyyy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

/** Extract the passport's MRZ dates from raw DG1 bytes. TD3 only (93-byte
 * DG1) — that's the only doctype this flow handles. Byte offsets per
 * ICAO 9303:
 *   header   bytes 0-4   (61 5B 5F 1F 58 wrapper)
 *   line 1   bytes 5-48  (P< issuer name…)
 *   line 2   bytes 49-92
 *     58 = check, 59-61 = nationality, 62-67 = birth YYMMDD,
 *     68 = check, 69 = sex, 70-75 = expiry YYMMDD, …
 */
function extractMrzDates(dg1: Uint8Array): { birthYymmdd: string; expiryYymmdd: string } | null {
  if (dg1.length !== 93) return null;
  const ascii = (start: number, n: number) =>
    String.fromCharCode(...dg1.subarray(start + 5, start + 5 + n));
  return {
    birthYymmdd: ascii(57, 6),
    expiryYymmdd: ascii(65, 6),
  };
}

function diagnoseIneligibility(args: {
  dg1: Uint8Array;
  selector: bigint;
  expirationDateLowerBound: bigint;
  birthDateLowerbound: bigint;
  birthDateUpperbound: bigint;
  /** Decimal string of the BJJ private key the proof was built with. Used
   * to detect Bug 2 (malformed sk that falls outside the vote circuit's
   * Num2Bits(253) decomposition range). Must be checked BEFORE the age
   * heuristics — Bug 2 produces the same misleading
   * "Error loading signal timestampUpperbound" surface error as a date
   * constraint, but the user-facing remediation is completely different. */
  skIdentity: string;
}): string | null {
  // ── Bug 2: malformed BJJ private key (sk >= 2^253) ─────────────────────
  // The vote circuit's BabyPbk decomposes skIdentity via circomlib's
  // `Num2Bits(253)`, which only accepts scalars in [0, 2^253). Older
  // SDK-generated keys (`@iden3/js-crypto`'s `babyJub.F.random()`) sampled
  // from the base field [0, p ≈ 2^254) with no subgroup reduction; ~34%
  // landed in the dead zone and tripped the assert ~280 ms into
  // witnesscalc. Witnesscalc reports the alphabetically-last loaded signal
  // (`timestampUpperbound`) as the error name — same surface error as a
  // genuine date-bound mismatch, which is why this used to be mis-blamed
  // on the age rule with a century-bug-induced "naissance le 2065-04-14"
  // message. The user's recourse is different too: no document or
  // proposal change rescues a key that's already on-chain; only switching
  // to a different document works.
  //
  // Generation of new keys is now safe — `utils/identity.ts`'s
  // `generateValidBJJPrivateKey()` rejection-samples until sk < 2^253 —
  // but identities already registered on-chain with a bad sk remain
  // unrecoverable on French passports (no DG15 → no AA → `revoke()`
  // blocked).
  try {
    if (BigInt(args.skIdentity) >= (1n << 253n)) {
      return (
        `Ce passeport est lié à une identité on-chain dont la clé privée ` +
        `n'est pas valide pour le circuit de vote (clé hors plage). Cette ` +
        `identité ne peut pas être réinitialisée pour un passeport français ` +
        `(absence d'authentification active / DG15). Veuillez voter avec un ` +
        `autre document.`
      );
    }
  } catch {
    // skIdentity isn't a valid decimal — not the case this branch guards.
    // Fall through to the standard date-based heuristics below.
  }

  const sel = args.selector;
  const bit = (i: number) => ((sel >> BigInt(i)) & 1n) === 1n;
  const dates = extractMrzDates(args.dg1);
  if (!dates) return null;

  // selector[12]: expirationDateLowerbound < passport.expirationDate
  if (bit(12)) {
    const lb = decodeYymmdd(args.expirationDateLowerBound);
    if (lb && dates.expiryYymmdd) {
      const passportExp = yymmddToFullDate(dates.expiryYymmdd, 'expiry');
      const minExp = yymmddToFullDate(lb, 'expiry');
      if (passportExp < minExp) {
        return (
          `Votre passeport est expiré pour ce scrutin. ` +
          `Le passeport expire le ${passportExp} ; ce scrutin requiert une ` +
          `expiration postérieure au ${minExp}. ` +
          `Utilisez un passeport valide ou attendez un scrutin avec des règles différentes.`
        );
      }
    }
  }

  // selector[14]: birthDateLowerbound < passport.birthDate
  if (bit(14)) {
    const lb = decodeYymmdd(args.birthDateLowerbound);
    if (lb && dates.birthYymmdd) {
      const passportBirth = yymmddToFullDate(dates.birthYymmdd, 'birth');
      const minBirth = yymmddToFullDate(lb, 'birth');
      if (passportBirth < minBirth) {
        return (
          `Votre date de naissance est antérieure à la limite de ce scrutin ` +
          `(${passportBirth} avant ${minBirth}).`
        );
      }
    }
  }

  // selector[15]: passport.birthDate < birthDateUpperbound (≥ 18 ans check)
  if (bit(15)) {
    const ub = decodeYymmdd(args.birthDateUpperbound);
    if (ub && dates.birthYymmdd) {
      const passportBirth = yymmddToFullDate(dates.birthYymmdd, 'birth');
      const maxBirth = yymmddToFullDate(ub, 'birth');
      if (passportBirth >= maxBirth) {
        return (
          `Vous n'êtes pas éligible à ce scrutin selon la règle d'âge ` +
          `(naissance le ${passportBirth}, le scrutin exige une naissance ` +
          `avant le ${maxBirth}).`
        );
      }
    }
  }

  return null;
}
