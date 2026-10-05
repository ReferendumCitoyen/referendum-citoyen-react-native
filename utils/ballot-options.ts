/**
 * The option order of a ballot, and who is allowed to decide it.
 *
 * A vote is an INDEX. `Step9Vote` renders `questions[0].variants` and submits
 * the position of the button the voter pressed; `getEventData` turns it into
 * `1 << index`. Permute that array and every vote cast is silently inverted:
 * the proof is valid, the nullifier burns, the ballot cannot be recast, and
 * the Verify tab reads its labels back from the same source, so the lie is
 * consistent with itself. Nothing on screen can betray it.
 *
 * Two sources feed that array and NEITHER is authenticated:
 *
 *   1. the IPFS gateway. `FreedomTool.getProposalMetadata` fetches the file
 *      the chain's CID names and uses it as it comes; nothing recomputes the
 *      multihash. The gateway operator, or anyone who can present a
 *      certificate the device trusts (a managed fleet, a corporate proxy),
 *      chooses what "Oui" means. Closed in the SDK patch, which lets the
 *      bundled copy for that CID decide the order.
 *   2. this app's own AsyncStorage cache (utils/proposal-cache.ts), plain
 *      JSON that the voting flow reads on entry to skip a roundtrip. Whoever
 *      can write the sandbox gets the same inversion without touching the
 *      network. Closed here, on the read path.
 *
 * The bundled table is keyed BY CID, which is the hash of the content, so an
 * entry can only ever stand for the exact file the chain points at: it is the
 * one reference in the app that an attacker cannot move. A stale entry is not
 * a risk, it is simply never matched.
 *
 * WHAT IS STILL MISSING, and it is the half that needs a decision.
 * The signed proposal index (public-data/proposals.json, verified Ed25519 by
 * utils/proposal-index.ts) carries `active`, `devOnly`, `twins`, `closed`,
 * `pages` and the version floors. It carries NO metadata CID. So a question
 * published after this build ships has no trusted reference at all, and for
 * it these functions can only fall back to bounding the shape against the
 * chain. The full fix is one field in the signed index:
 *
 *     "mainnet": {
 *       "active": ["73"],
 *       "metadata": { "73": "QmUgNBTTbJ4jca7fkZGkcSfvSku3dRMthV9MNT5gCPVwk2" }
 *     }
 *
 * With that, the app verifies the CID the chain returns against the signed
 * one, and refuses metadata whose multihash does not match the CID, instead
 * of trusting whatever the gateway sent. The signing workflow already exists
 * (.github/workflows/publish-proposal-index.yml) and the schema is additive,
 * so an older build ignores the field. That is a decision for the product owner and the app developer, not
 * one to take tonight: it changes what operations must publish for every new
 * question.
 */
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { BUNDLED_PROPOSAL_METADATA } from '@/constants/bundled-proposal-metadata';

/** Is this the order the bundled copy for that CID declares? */
export function optionOrderMatchesBundled(
  metadataCid: string | undefined,
  questions: unknown,
): boolean {
  if (!metadataCid) return false;
  const bundled = BUNDLED_PROPOSAL_METADATA[metadataCid];
  if (!bundled) return false;
  return JSON.stringify(questions) === JSON.stringify(bundled.acceptedOptions);
}

/**
 * Give a proposal back the option order its bundled copy declares, when the
 * CID it names has one. Display text the cache carries is left alone: what is
 * restored is the thing a vote is an index into, nothing else.
 *
 * A proposal whose CID has no bundled copy is returned untouched: there is
 * nothing to compare it against here, and refusing to show a live question
 * because this build predates it would be a worse failure than showing it.
 * The chain-side bound on the same file lives in the SDK patch.
 */
export function withBundledOptionOrder<T extends ProposalInfo>(proposal: T): T {
  const cid = (proposal as { metadataCid?: string }).metadataCid;
  if (!cid) return proposal;
  const bundled = BUNDLED_PROPOSAL_METADATA[cid];
  if (!bundled) return proposal;
  if (optionOrderMatchesBundled(cid, proposal.questions)) return proposal;
  // Constant code: no CID, no cached body, nothing from the attacker's side.
  console.warn(`[ballot] #${proposal.id} BALLOT_OPTIONS_MISMATCH bundled-order-used`);
  return {
    ...proposal,
    questions: bundled.acceptedOptions,
    rankingBased: bundled.rankingBased ?? false,
  };
}
