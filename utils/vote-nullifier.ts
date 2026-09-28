/**
 * The vote nullifier, and the one question it can answer without a proof:
 * has this key already voted on this proposal?
 *
 * `nullifier = Poseidon3(sk, Poseidon1(sk), eventId)` — the same formula the
 * vote circuit computes and `FreedomTool.isAlreadyVoted` mirrors. It depends
 * on the BJJ key and the proposal, and on nothing about the document, which is
 * the whole point of Level 1: a passport and its owner's ID card that share a
 * key produce one nullifier and the chain refuses the second vote.
 *
 * Every proposal keeps its used nullifiers in its own SparseMerkleTree, so
 * "has this key voted here" is a membership read: three eth_calls, no proof,
 * no relayer. utils/mainnet-vote-flow.ts has always done this just before
 * generating the vote proof; Step 7 now does it before generating the
 * REGISTRATION proof, which is 20 s earlier and one screen before the user
 * picks an answer (project decision, 2026-09-09).
 *
 * Read-only and best-effort by design. A failure here must never block a
 * legitimate vote — callers swallow and continue.
 */
import { ethers } from 'ethers';
import { Poseidon as IdenPoseidon } from '@iden3/js-crypto';
import {
  MAINNET_PROPOSALS_STATE_ADDRESS,
  RARIME_MAINNET_CONFIG,
} from '@/constants/rarime-config';

const PROPOSALS_STATE_ABI = [
  'function getProposalEventId(uint256) view returns (uint256)',
  'function getProposalInfo(uint256) view returns (tuple(address proposalSMT, uint8 status, tuple(uint64 startTimestamp, uint64 duration, uint256 multichoice, uint256[] acceptedOptions, string description, address[] votingWhitelist, bytes[] votingWhitelistData) config, uint256[8][] votingResults))',
];

const SMT_ABI = [
  'function getProof(bytes32 key_) view returns (tuple(bytes32 root, bytes32[] siblings, bool existence, bytes32 key, bytes32 value, bool auxExistence, bytes32 auxKey, bytes32 auxValue))',
];

/** What a proposal contributes to the nullifier and where used ones are kept. */
export interface ProposalVoteIndex {
  eventId: bigint;
  proposalSmtAddress: string;
}

/** The nullifier this key would spend on this proposal. */
export function voteNullifier(bjjPrivateKeyHex: string, eventId: bigint): bigint {
  const sk = BigInt('0x' + bjjPrivateKeyHex.trim().replace(/^0x/, ''));
  return IdenPoseidon.hash([sk, IdenPoseidon.hash([sk]), eventId]);
}

export function mainnetProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl);
}

/** The two per-proposal values, read once and reused for every key checked. */
export async function readProposalVoteIndex(
  provider: ethers.JsonRpcProvider,
  proposalId: string | number | bigint,
): Promise<ProposalVoteIndex> {
  const proposals = new ethers.Contract(
    MAINNET_PROPOSALS_STATE_ADDRESS,
    PROPOSALS_STATE_ABI,
    provider,
  );
  const id = BigInt(proposalId);
  const [eventId, info] = await Promise.all([
    proposals.getProposalEventId(id),
    proposals.getProposalInfo(id),
  ]);
  return { eventId: BigInt(eventId), proposalSmtAddress: info.proposalSMT };
}

/**
 * Whether this key's nullifier is already in the proposal's tree.
 *
 * The nullifier is never logged: it is stable per (key, proposal), so a log
 * reader who captured one could follow the same person across proposals.
 */
export async function hasKeyVoted(args: {
  provider: ethers.JsonRpcProvider;
  index: ProposalVoteIndex;
  bjjPrivateKeyHex: string;
}): Promise<boolean> {
  const nullifier = voteNullifier(args.bjjPrivateKeyHex, args.index.eventId);
  const smt = new ethers.Contract(args.index.proposalSmtAddress, SMT_ABI, args.provider);
  const proof = await smt.getProof(ethers.toBeHex(nullifier, 32));
  return Boolean(proof.existence);
}
