/**
 * One eligibility rule for a vote (R7, item 2).
 *
 * Why one function: the post-vote "another referendum" card offered #54 (a
 * closed June question on the passport contract) to people who had just voted
 * on #73 with their card, the flow started on that id with no contract check,
 * the card proof went to BioPassportVoting and the relayer answered 400; the
 * 2.0.1 Retry then repeated it. The home screen already knew better (it reads
 * the index), but the card, the route, the Retry and the proof itself each
 * applied their own partial rule. Every place that can start or continue a vote
 * now asks this module, with the same inputs:
 *
 *   - the trusted LOCAL index (the signed copy cached by the last download, or
 *     the list built into the app; readLocalProposalIndex, never a fetch);
 *   - the canonical twin pair of the question, in both directions (the index
 *     table plus the one shipped in constants/twin-proposals.ts), with a
 *     closure propagated to both members;
 *   - the voting contract positively recognised for this document type and
 *     network: a card may only vote on a contract known to take cards, never on
 *     "anything that is not the passport contract";
 *   - the voting period, a single question, and rules the app understands.
 *
 * Anything unknown refuses locally. In the beta, dev mode (devMode &&
 * isBetaBuild(), computed by the caller) waives only the index listing, so the
 * test questions found on chain keep working; every other rule still applies.
 *
 * Pure: no request, no log. Callers log the constant reason code, never a
 * candidate list.
 */
import type { Network } from '@/constants/rarime-config';
import { TWIN_PROPOSALS } from '@/constants/twin-proposals';
import { closedForNetwork, idsForNetwork, type ProposalIndex } from './proposal-index';
import { isVotingBlockedByVersion } from './update-notice';
import { BIO_PASSPORT_VOTING_ADDRESS, FRA_BIGINT, ID_CARD_VOTING_ADDRESS } from './voteResults';

export type VoteDocument = 'idCard' | 'passport';

/** Voting contracts known to verify each document's proof, per network. A
 * contract missing from here is refused: adding a network or a contract is a
 * deliberate edit, not an inference. */
export const VOTING_CONTRACTS: Readonly<Record<Network, Readonly<Record<VoteDocument, readonly string[]>>>> = {
  mainnet: {
    idCard: [ID_CARD_VOTING_ADDRESS],
    passport: [BIO_PASSPORT_VOTING_ADDRESS],
  },
  // No voting contract of the test network is pinned in this tree.
  // TODO(DECISION-D9): the app developer to supply the two testnet voting addresses, or to
  // accept that a testnet vote is refused in the beta, which is what this
  // empty table means today (wave 2b REG-1: the whole testnet bench cannot
  // vote). Left as it is on purpose; the refusal is now at least explained on
  // screen (REG-10, refusalMessageKey below).
  testnet: { idCard: [], passport: [] },
};

export type IneligibilityReason =
  | 'not-listed'
  | 'closed'
  | 'not-started'
  | 'ended'
  | 'unknown-contract'
  | 'wrong-document'
  | 'multi-question'
  | 'unknown-rules'
  | 'citizenship'
  | 'app-outdated';

export type EligibilityVerdict = { ok: true } | { ok: false; reason: IneligibilityReason };

/** The slice of the SDK's ProposalInfo this rule reads. */
export interface EligibilityProposal {
  id: string | number;
  sendVoteContractAddress?: string;
  startTimestamp: bigint | number | string;
  duration: bigint | number | string;
  questions?: readonly unknown[];
  criteria?: {
    selector?: unknown;
    citizenshipWhitelist?: readonly unknown[];
    birthDateLowerbound?: unknown;
    birthDateUpperbound?: unknown;
    expirationDateLowerbound?: unknown;
  };
}

export interface EligibilityContext {
  index: ProposalIndex;
  network: Network;
  /** devMode && isBetaBuild(): waives the index listing, nothing else. */
  devAllowed: boolean;
  nowSeconds?: number;
  /** The installed app is below the signed index's minimum (R10). */
  appOutdated?: boolean;
}

/**
 * The context every call site builds the same way. Below the signed index's
 * minimum app version, every vote is refused (R10, item 9).
 *
 * DECIDED 23/09/2026. A published minimum keeps BLOCKING the vote, and the
 * trap that came with it is closed rather than traded away: the index carried
 * ONE minimum against TWO version lines, the store app in 2.0.x
 * (app.config.ts) and the beta in 1.6.0, so raising it to 2.0.2 to push store
 * users to update would have taken the vote away from every beta tester the
 * same minute. The published table may now name a flavour, and a build reads
 * its own entry and no other (AppVersionTable in utils/proposal-index.ts,
 * publishedVersionsFor in utils/update-notice.ts). An index that carries only
 * the old per-platform keys still behaves exactly as it did.
 */
export function localEligibilityContext(
  index: ProposalIndex,
  network: Network,
  devAllowed: boolean,
): EligibilityContext {
  return { index, network, devAllowed, appOutdated: isVotingBlockedByVersion(index) };
}

export interface TwinPairs {
  /** passport id → card id */
  cardOf: ReadonlyMap<string, string>;
  /** card id → passport id */
  passportOf: ReadonlyMap<string, string>;
}

/** The canonical pairs for a network: the shipped table, then the signed
 * index (the index wins on a clash), read in both directions. */
export function twinPairs(index: ProposalIndex, network: Network): TwinPairs {
  const table: Record<string, string> = {
    ...(network === 'mainnet' ? TWIN_PROPOSALS : {}),
    ...(index[network].twins ?? {}),
  };
  const cardOf = new Map<string, string>();
  const passportOf = new Map<string, string>();
  for (const [passportId, cardId] of Object.entries(table)) {
    if (passportId === cardId) continue;
    cardOf.set(passportId, cardId);
    passportOf.set(cardId, passportId);
  }
  return { cardOf, passportOf };
}

/** The other member of `id`'s pair, whichever side `id` is on. */
export function twinOf(pairs: TwinPairs, id: string): string | undefined {
  return pairs.cardOf.get(id) ?? pairs.passportOf.get(id);
}

const toBig = (v: unknown): bigint | null => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^\d+n?$/.test(v)) return BigInt(v.replace(/n$/, ''));
  return null;
};

/**
 * Whether the on-chain rules of this proposal were READ, as opposed to
 * satisfied. The SDK's getProposalRules hands back an all-zero stub when it
 * cannot decode them, and a zero selector is that stub.
 *
 * REG-2, and why this is no longer a refusal. That stub is a TRANSIENT state
 * of the phone's connection, not a property of the question: an RPC hiccup, a
 * gateway 5xx, a slow IPFS read, and the SDK itself says so where it returns
 * the stub ("which lets isFrenchCompatible default to permissive and the
 * on-chain verifier remains the source of truth for vote eligibility"). 2.0.2
 * turned it into a refusal, so during any network incident an open question
 * showed with no Vote button at all, where 2.0.1 let the voter try and
 * explained any real refusal further along the flow.
 *
 * Tolerating it is safe because the stub degrades permissively everywhere it
 * is read afterwards: zero bounds are MRZ_DATE_UNUSED, so the age pre-check
 * skips rather than refuses (utils/mrz-date-bounds.ts), and an empty
 * citizenship whitelist is already read as "no restriction". The authority on
 * eligibility is the on-chain verifier, which refuses a proof that does not
 * satisfy the real rules, and that refusal is explained by the vote error
 * table. Refusing locally on a value we know we failed to read only removes
 * the voter's ability to find out.
 */
function rulesReadable(p: EligibilityProposal): boolean {
  const c = p.criteria;
  if (!c) return false;
  const selector = toBig(c.selector);
  if (selector === null || selector === 0n) return false;
  return (
    toBig(c.birthDateLowerbound) !== null &&
    toBig(c.birthDateUpperbound) !== null &&
    toBig(c.expirationDateLowerbound) !== null &&
    Array.isArray(c.citizenshipWhitelist)
  );
}

function frenchAccepted(p: EligibilityProposal): boolean {
  const list = p.criteria?.citizenshipWhitelist ?? [];
  if (list.length === 0) return true;
  return list.some((c) => toBig(c) === FRA_BIGINT);
}

/** Which document the proposal's contract is known to take, or null. */
export function documentOfContract(network: Network, address: string | undefined): VoteDocument | null {
  if (!address) return null;
  const a = address.toLowerCase();
  const known = VOTING_CONTRACTS[network];
  if (known.idCard.includes(a)) return 'idCard';
  if (known.passport.includes(a)) return 'passport';
  return null;
}

/**
 * May `document` vote on `proposal` right now, by the local rules alone?
 * The order of the checks decides which reason is reported, most specific to
 * the voter last: a closed question is "closed" whatever document is held.
 */
export function checkVoteEligibility(
  proposal: EligibilityProposal,
  document: VoteDocument,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const { index, network, devAllowed } = ctx;
  const id = String(proposal.id);
  const pairs = twinPairs(index, network);
  const twin = twinOf(pairs, id);

  if (ctx.appOutdated) return { ok: false, reason: 'app-outdated' };

  // Listed by the trusted index, directly or through its twin.
  if (!devAllowed) {
    const listed = new Set(idsForNetwork(index, network, false));
    if (!listed.has(id) && !(twin && listed.has(twin))) return { ok: false, reason: 'not-listed' };
  }

  // Closed by the index, on either member of the pair.
  const closed = closedForNetwork(index, network);
  if (closed.has(id) || (twin !== undefined && closed.has(twin))) return { ok: false, reason: 'closed' };

  // Open on chain dates.
  const start = toBig(proposal.startTimestamp);
  const duration = toBig(proposal.duration);
  if (start === null || duration === null) return { ok: false, reason: 'unknown-rules' };
  const now = BigInt(Math.floor(ctx.nowSeconds ?? Date.now() / 1000));
  if (now < start) return { ok: false, reason: 'not-started' };
  if (now > start + duration) return { ok: false, reason: 'ended' };

  // One question: the contracts reject vote_.length !== questions.length.
  if ((proposal.questions?.length ?? 0) !== 1) return { ok: false, reason: 'multi-question' };

  // The contract, recognised for this document on this network.
  const contractDocument = documentOfContract(network, proposal.sendVoteContractAddress);
  if (contractDocument === null) return { ok: false, reason: 'unknown-contract' };
  if (contractDocument !== document) return { ok: false, reason: 'wrong-document' };

  // REG-2: rules we could not read are tolerated, not refused. Only rules we
  // DID read, and that exclude this voter, refuse here.
  if (rulesReadable(proposal) && !devAllowed && !frenchAccepted(proposal)) {
    return { ok: false, reason: 'citizenship' };
  }

  return { ok: true };
}

/** The id `document` votes for a list entry that may stand for a pair. */
export function targetIdFor(
  entryId: string,
  document: VoteDocument,
  pairs: TwinPairs,
): string {
  const id = String(entryId);
  if (document === 'idCard') return pairs.cardOf.get(id) ?? id;
  return pairs.passportOf.get(id) ?? id;
}

/** The route parameters that start the flow on a pair or a single question,
 * the way the home does (passport id first, card id as its twin). */
export function routeParamsFor(
  id: string,
  pairs: TwinPairs,
): { proposalId: string; cardProposalId?: string } {
  const passportId = pairs.passportOf.get(id) ?? id;
  const cardId = pairs.cardOf.get(passportId);
  return cardId ? { proposalId: passportId, cardProposalId: cardId } : { proposalId: passportId };
}

export interface NextProposalChoice<P extends EligibilityProposal> {
  /** The member the voter's document will vote (shown on the card). */
  proposal: P;
  proposalId: string;
  cardProposalId?: string;
}

/**
 * The post-vote suggestion: the most-voted question this document may vote
 * next, or null. Never the question just voted, nor its twin in either
 * direction. `votesOf` ranks; ties keep the list order.
 */
export function pickNextProposal<P extends EligibilityProposal>(args: {
  list: readonly P[];
  justVotedId?: string | number | null;
  document: VoteDocument;
  ctx: EligibilityContext;
  votesOf: (p: P) => number;
}): NextProposalChoice<P> | null {
  const { list, document, ctx, votesOf } = args;
  const pairs = twinPairs(ctx.index, ctx.network);
  const excluded = new Set<string>();
  if (args.justVotedId !== undefined && args.justVotedId !== null) {
    const voted = String(args.justVotedId);
    excluded.add(voted);
    const t = twinOf(pairs, voted);
    if (t) excluded.add(t);
  }
  const byId = new Map(list.map((p) => [String(p.id), p]));
  const seen = new Set<string>();
  let best: { choice: NextProposalChoice<P>; votes: number } | null = null;
  for (const p of list) {
    const id = String(p.id);
    if (excluded.has(id)) continue;
    const targetId = targetIdFor(pairs.passportOf.get(id) ?? id, document, pairs);
    if (excluded.has(targetId) || seen.has(targetId)) continue;
    seen.add(targetId);
    const target = byId.get(targetId);
    if (!target) continue;
    if (!checkVoteEligibility(target, document, ctx).ok) continue;
    const twin = twinOf(pairs, targetId);
    const twinProposal = twin ? byId.get(twin) : undefined;
    const votes = votesOf(target) + (twinProposal ? votesOf(twinProposal) : 0);
    if (!best || votes > best.votes) {
      best = { choice: { proposal: target, ...routeParamsFor(targetId, pairs) }, votes };
    }
  }
  return best?.choice ?? null;
}

/**
 * The verdict for a list entry (the home card): eligible when any document
 * the app lets the voter choose may vote its member; otherwise the reason of
 * the first document tried.
 */
export function entryEligibility<P extends EligibilityProposal>(
  entry: { id: string | number; twin?: { passportId: string; cardId: string } },
  documents: readonly VoteDocument[],
  find: (id: string) => P | undefined,
  ctx: EligibilityContext,
): EligibilityVerdict {
  const pairs = twinPairs(ctx.index, ctx.network);
  let first: EligibilityVerdict | null = null;
  for (const document of documents) {
    // A pair the list folded (declared or matched by title) names its members.
    const targetId = entry.twin
      ? document === 'idCard'
        ? entry.twin.cardId
        : entry.twin.passportId
      : targetIdFor(String(entry.id), document, pairs);
    const target = find(targetId);
    const verdict: EligibilityVerdict = target
      ? checkVoteEligibility(target, document, ctx)
      : { ok: false, reason: 'not-listed' };
    if (verdict.ok) return verdict;
    first = first ?? verdict;
  }
  return first ?? { ok: false, reason: 'not-listed' };
}

/**
 * The i18n key that tells the voter why there is no Vote button (REG-10).
 *
 * The home card used to render the button only when the verdict was ok and
 * say nothing at all otherwise: the question showed as "En cours", the results
 * showed, and there was nothing to touch and nothing to read. That is the most
 * expensive kind of failure, the one that produces a support email carrying no
 * information, and the four rules added in 2.0.2 (the pinned contract list,
 * the on-chain rules read, the minimum version and the citizenship filter) all
 * land there.
 *
 * Most of these sentences already existed for the voting flow; a refusal the
 * voter sees on the home screen deserves the same words as the same refusal
 * seen one screen later.
 */
export function refusalMessageKey(reason: IneligibilityReason): string {
  switch (reason) {
    case 'app-outdated':
      return 'voting.voteErrors.appOutdated';
    case 'closed':
    case 'ended':
      return 'voting.voteErrors.questionClosed';
    case 'citizenship':
      return 'voting.voteErrors.citizenship';
    case 'wrong-document':
      // The launch is card only; the passport flow is unreachable.
      return 'voting.voteErrors.unsupportedDocument_idCard';
    case 'unknown-rules':
      // Transient by nature: the SDK hands back an all-zero stub when it
      // cannot decode the on-chain rules, which is what an RPC hiccup or a
      // slow IPFS gateway looks like. Ask for a retry, do not say "closed".
      return 'voting.voteErrors.rulesUnknown';
    case 'unknown-contract':
      // This build does not know the address the question votes through:
      // a testnet with no pinned address, or a contract redeployed since.
      return 'voting.voteErrors.contractUnknown';
    case 'multi-question':
      return 'home.voteUnsupportedMultiQuestion';
    case 'not-listed':
    case 'not-started':
    default:
      return 'voting.voteErrors.notAvailable';
  }
}
