/**
 * Fold "twin" proposals into one list entry.
 *
 * A proposal names the voting contracts allowed to vote it, and each contract
 * holds one verifier: BioPassportVoting checks passport proofs, IDCardVoting
 * checks ID-card proofs. Until a question is created with both contracts on
 * one id, the same question exists twice on chain — once per contract — and
 * the list would show it twice. This folds such a pair into one entry: the
 * passport member's id, title and dates, both members' results added up, and
 * the two ids kept so the vote flow can pick the one the scanned document can
 * vote (`twinIdFor`).
 *
 * Two proposals are twins when either
 *   - `TWIN_PROPOSALS` (constants/twin-proposals.ts) says so, or
 *   - one is bound to BioPassportVoting, the other to IDCardVoting, their
 *     titles and options match after whitespace/case normalisation, and
 *     their voting windows overlap.
 *
 * The description is deliberately not compared: it is where a typo lands
 * (#69 lost the final full stop of #68's), and the IPFS CID differs as soon
 * as one byte does. Two proposals on the SAME contract never pair — 59 and 60
 * share a title and both take passports; they are two polls.
 */

import { TWIN_PROPOSALS } from '@/constants/twin-proposals';
import { isPassportVotingTarget } from './voteResults';

export type DocumentKind = 'passport' | 'idCard';

export interface TwinIds {
  passportId: string;
  cardId: string;
}

/** The slice of the SDK's `ProposalInfo` this module reads. Typed here rather
 * than imported so the pairing stays a plain function over plain data. */
export interface ProposalLike {
  id: string;
  title: string;
  questions: { title: string; variants: string[] }[];
  votingResults: bigint[][];
  startTimestamp: bigint;
  duration: bigint;
  sendVoteContractAddress: string;
}

/** A list entry. `twin` is set when two on-chain proposals were folded into it. */
export type WithTwin<P extends ProposalLike> = P & { twin?: TwinIds };

const normalise = (s: string | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** What has to match for two proposals to be the same question. */
export function pairingKey(p: ProposalLike): string {
  const questions = (p.questions ?? []).map(
    (q) => `${normalise(q.title)}=${(q.variants ?? []).map(normalise).join('/')}`,
  );
  return `${normalise(p.title)}|${questions.join('|')}`;
}

const windowsOverlap = (a: ProposalLike, b: ProposalLike): boolean =>
  a.startTimestamp <= b.startTimestamp + b.duration &&
  b.startTimestamp <= a.startTimestamp + a.duration;

/** Element-wise sum of two `votingResults` matrices; a missing cell counts 0. */
export function sumVotingResults(
  a: bigint[][] | null | undefined,
  b: bigint[][] | null | undefined,
): bigint[][] {
  const rows = Math.max(a?.length ?? 0, b?.length ?? 0);
  const out: bigint[][] = [];
  for (let r = 0; r < rows; r++) {
    const ra = a?.[r] ?? [];
    const rb = b?.[r] ?? [];
    const cols = Math.max(ra.length, rb.length);
    out.push(Array.from({ length: cols }, (_, c) => (ra[c] ?? 0n) + (rb[c] ?? 0n)));
  }
  return out;
}

/** The passport member carries the entry (id, title, dates, rules); the card
 * member only adds its counts. */
export function mergeTwins<P extends ProposalLike>(passport: P, card: P): WithTwin<P> {
  return {
    ...passport,
    votingResults: sumVotingResults(passport.votingResults, card.votingResults),
    twin: { passportId: String(passport.id), cardId: String(card.id) },
  };
}

export function pairProposals<P extends ProposalLike>(
  list: readonly P[],
  overrides: Readonly<Record<string, string>> = TWIN_PROPOSALS,
): WithTwin<P>[] {
  const byId = new Map(list.map((p) => [String(p.id), p]));
  const cardOf = new Map<string, string>();
  const consumed = new Set<string>();

  // 1. Declared pairs win, whatever the titles say. The two must sit on
  //    different contracts; if the table has them the wrong way round, put
  //    the passport one in front rather than sending a passport to the card
  //    contract.
  for (const [a, b] of Object.entries(overrides)) {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb || a === b) continue;
    const aIsPassport = isPassportVotingTarget(pa);
    if (aIsPassport === isPassportVotingTarget(pb)) continue;
    const [passportId, cardId] = aIsPassport ? [a, b] : [b, a];
    cardOf.set(passportId, cardId);
    consumed.add(cardId);
  }

  // 2. Then the same question on the two contracts.
  const groups = new Map<string, { passports: P[]; cards: P[] }>();
  for (const p of list) {
    const id = String(p.id);
    if (consumed.has(id) || cardOf.has(id)) continue;
    const key = pairingKey(p);
    const group = groups.get(key) ?? { passports: [], cards: [] };
    (isPassportVotingTarget(p) ? group.passports : group.cards).push(p);
    groups.set(key, group);
  }
  const newestFirst = (a: P, b: P) => Number(b.id) - Number(a.id);
  for (const group of groups.values()) {
    if (group.passports.length === 0 || group.cards.length === 0) continue;
    const passport = [...group.passports].sort(newestFirst)[0];
    const card = [...group.cards].sort(newestFirst).find((c) => windowsOverlap(passport, c));
    if (!card) continue;
    cardOf.set(String(passport.id), String(card.id));
    consumed.add(String(card.id));
  }

  // 3. One entry per question, in the passport member's place.
  const out: WithTwin<P>[] = [];
  for (const p of list) {
    const id = String(p.id);
    if (consumed.has(id)) continue;
    const cardId = cardOf.get(id);
    const card = cardId ? byId.get(cardId) : undefined;
    out.push(card ? mergeTwins(p, card) : p);
  }
  return out;
}

/** The id this document can actually vote. A single answers with its own id. */
export function twinIdFor(p: WithTwin<ProposalLike>, document: DocumentKind): string {
  if (!p.twin) return String(p.id);
  return document === 'idCard' ? p.twin.cardId : p.twin.passportId;
}

/** In an already-paired list, the other member of `id`'s pair, if it has one. */
export function otherTwinId(list: readonly WithTwin<ProposalLike>[], id: string): string | undefined {
  for (const p of list) {
    if (!p.twin) continue;
    if (p.twin.passportId === id) return p.twin.cardId;
    if (p.twin.cardId === id) return p.twin.passportId;
  }
  return undefined;
}
