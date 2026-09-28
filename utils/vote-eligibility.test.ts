jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { bundledProposalIndex, parseProposalIndex, type ProposalIndex } from './proposal-index';
import {
  checkVoteEligibility,
  entryEligibility,
  pickNextProposal,
  twinPairs,
  type EligibilityContext,
} from './vote-eligibility';

const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
const PASSPORT = '0x8Dea8065888A14F66ba9Fb944353d898663863cf';
const NOW = Math.floor(Date.UTC(2026, 8, 22, 12) / 1000);
const FRA = BigInt('0x465241');

function proposal(id: string, contract: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    sendVoteContractAddress: contract,
    // 15/09/2026 → 24/12/2026, like #73
    startTimestamp: 1_789_430_400n,
    duration: 8_640_000n,
    questions: [{ title: 'q', variants: ['Oui', 'Non'] }],
    votingResults: [[1n, 2n]],
    criteria: {
      selector: 39457n,
      citizenshipWhitelist: [FRA],
      birthDateLowerbound: 52983525027888n,
      birthDateUpperbound: 52983525027888n,
      expirationDateLowerbound: 52983525027888n,
    },
    ...extra,
  };
}
// The June questions: passport contract, open on chain until 10 October.
const june = ['52', '53', '54', '55', '56'].map((id) =>
  proposal(id, PASSPORT, { startTimestamp: 1_781_481_600n, duration: 10_191_900n }),
);
const p73 = proposal('73', CARD);

const index = (mainnet: Record<string, unknown>): ProposalIndex =>
  parseProposalIndex({
    version: 1,
    mainnet: { active: [], devOnly: [], ...mainnet },
    testnet: { active: [], devOnly: [] },
  })!;
const ctx = (idx: ProposalIndex, extra: Partial<EligibilityContext> = {}): EligibilityContext => ({
  index: idx,
  network: 'mainnet',
  devAllowed: false,
  nowSeconds: NOW,
  ...extra,
});
const votes = (p: { votingResults: bigint[][] }) => Number(p.votingResults[0].reduce((a, b) => a + b, 0n));

describe('the post-vote suggestion (item 2)', () => {
  it('cached [73, 52..56] with the bundled index: nothing to offer after a card vote on 73', () => {
    const list = [p73, ...june];
    const choice = pickNextProposal({
      list,
      justVotedId: '73',
      document: 'idCard',
      ctx: ctx(bundledProposalIndex()),
      votesOf: votes,
    });
    expect(choice).toBeNull();
  });

  it('never offers #54 to a card, even with an index that has not closed it yet', () => {
    const idx = index({ active: ['73', '54'] });
    const choice = pickNextProposal({ list: [p73, ...june], justVotedId: '73', document: 'idCard', ctx: ctx(idx), votesOf: votes });
    expect(choice).toBeNull();
    expect(checkVoteEligibility(june[2], 'idCard', ctx(idx))).toEqual({ ok: false, reason: 'wrong-document' });
  });

  it('a live card twin is offered with the pair, so each document goes to its own contract', () => {
    const idx = index({ active: ['73', '80'], twins: { '80': '81' } });
    const list = [p73, proposal('80', PASSPORT), proposal('81', CARD)];
    const choice = pickNextProposal({ list, justVotedId: '73', document: 'idCard', ctx: ctx(idx), votesOf: votes });
    expect(choice).not.toBeNull();
    expect(choice!.proposal.id).toBe('81');
    expect(choice!.proposalId).toBe('80');
    expect(choice!.cardProposalId).toBe('81');
  });

  it('a passport-only question after a card vote: none', () => {
    const idx = index({ active: ['73', '80'] });
    const list = [p73, proposal('80', PASSPORT)];
    expect(pickNextProposal({ list, justVotedId: '73', document: 'idCard', ctx: ctx(idx), votesOf: votes })).toBeNull();
  });

  it('excludes the question just voted and its twin in both directions', () => {
    const idx = index({ active: ['80'], twins: { '80': '81' } });
    const list = [proposal('80', PASSPORT), proposal('81', CARD)];
    expect(pickNextProposal({ list, justVotedId: '81', document: 'idCard', ctx: ctx(idx), votesOf: votes })).toBeNull();
    expect(pickNextProposal({ list, justVotedId: '80', document: 'passport', ctx: ctx(idx), votesOf: votes })).toBeNull();
  });
});

describe('checkVoteEligibility', () => {
  it('accepts #73 for a card with the bundled index', () => {
    expect(checkVoteEligibility(p73, 'idCard', ctx(bundledProposalIndex()))).toEqual({ ok: true });
  });

  it('refuses a passport on the card contract', () => {
    expect(checkVoteEligibility(p73, 'passport', ctx(bundledProposalIndex()))).toEqual({
      ok: false,
      reason: 'wrong-document',
    });
  });

  it('refuses an unknown contract for both documents, never inferring "card" from "not passport"', () => {
    const idx = index({ active: ['90'] });
    const p = proposal('90', '0x1111111111111111111111111111111111111111');
    expect(checkVoteEligibility(p, 'idCard', ctx(idx))).toEqual({ ok: false, reason: 'unknown-contract' });
    expect(checkVoteEligibility(p, 'passport', ctx(idx))).toEqual({ ok: false, reason: 'unknown-contract' });
    // And on a network with no pinned contract at all.
    expect(checkVoteEligibility(p73, 'idCard', ctx(idx, { network: 'testnet', devAllowed: true }))).toEqual({
      ok: false,
      reason: 'unknown-contract',
    });
  });

  it('beta dev mode keeps the test questions: devOnly ids are allowed, and only then', () => {
    const idx = index({ active: ['73'], devOnly: ['75'] });
    const p75 = proposal('75', CARD);
    expect(checkVoteEligibility(p75, 'idCard', ctx(idx, { devAllowed: true }))).toEqual({ ok: true });
    expect(checkVoteEligibility(p75, 'idCard', ctx(idx))).toEqual({ ok: false, reason: 'not-listed' });
  });

  it('dev mode waives the listing, not the other rules', () => {
    const idx = index({ active: [], closed: ['54'] });
    expect(checkVoteEligibility(june[2], 'passport', ctx(idx, { devAllowed: true }))).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('propagates a closure to both members of a pair', () => {
    const idx = index({ active: [], closed: ['80'], twins: { '80': '81' } });
    expect(checkVoteEligibility(proposal('81', CARD), 'idCard', ctx(idx))).toEqual({ ok: false, reason: 'closed' });
    const reverse = index({ active: [], closed: ['81'], twins: { '80': '81' } });
    expect(checkVoteEligibility(proposal('80', PASSPORT), 'passport', ctx(reverse))).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('checks the period, the single question and the rules', () => {
    const idx = index({ active: ['73'] });
    expect(checkVoteEligibility(p73, 'idCard', ctx(idx, { nowSeconds: 1_789_430_000 }))).toEqual({
      ok: false,
      reason: 'not-started',
    });
    expect(checkVoteEligibility(p73, 'idCard', ctx(idx, { nowSeconds: 1_789_430_400 + 8_640_001 }))).toEqual({
      ok: false,
      reason: 'ended',
    });
    const multi = proposal('73', CARD, { questions: [{}, {}] });
    expect(checkVoteEligibility(multi, 'idCard', ctx(idx))).toEqual({ ok: false, reason: 'multi-question' });
    // The SDK's all-zero stub when the rules could not be decoded.
    const stub = proposal('73', CARD, {
      criteria: {
        selector: 0n,
        citizenshipWhitelist: [],
        birthDateLowerbound: 0n,
        birthDateUpperbound: 0n,
        expirationDateLowerbound: 0n,
      },
    });
    // REG-2: the stub is a transient read failure, not a property of the
    // question, so it is tolerated. The on-chain verifier stays the authority
    // and the stub degrades permissively everywhere it is read afterwards.
    // See utils/vote-transient-rules.test.ts for the whole argument.
    expect(checkVoteEligibility(stub, 'idCard', ctx(idx))).toEqual({ ok: true });
    expect(checkVoteEligibility({ ...p73, criteria: undefined }, 'idCard', ctx(idx))).toEqual({
      ok: true,
    });
  });

  it('refuses a question whose whitelist leaves France out', () => {
    const idx = index({ active: ['73'] });
    const deu = proposal('73', CARD, {
      criteria: { ...p73.criteria, citizenshipWhitelist: [BigInt('0x444555')] },
    });
    expect(checkVoteEligibility(deu, 'idCard', ctx(idx))).toEqual({ ok: false, reason: 'citizenship' });
  });

  it('refuses everything once the app is below the signed minimum', () => {
    expect(checkVoteEligibility(p73, 'idCard', ctx(bundledProposalIndex(), { appOutdated: true }))).toEqual({
      ok: false,
      reason: 'app-outdated',
    });
  });

  it('reads cached proposals whose bigints came back through the JSON reviver', () => {
    const revived = { ...p73, startTimestamp: '1789430400', duration: '8640000' };
    expect(checkVoteEligibility(revived, 'idCard', ctx(bundledProposalIndex()))).toEqual({ ok: true });
  });
});

describe('entryEligibility (the home card)', () => {
  const idx = index({ active: ['80', '73'], twins: { '80': '81' } });
  const list = [p73, proposal('80', PASSPORT), proposal('81', CARD), ...june];
  const find = (id: string) => list.find((p) => p.id === id);

  it('a folded pair is votable by card through its card member', () => {
    const entry = { id: '80', twin: { passportId: '80', cardId: '81' } };
    expect(entryEligibility(entry, ['idCard'], find, ctx(idx))).toEqual({ ok: true });
  });

  it('a passport-only closed June question is not votable', () => {
    expect(entryEligibility({ id: '54' }, ['idCard'], find, ctx(bundledProposalIndex())).ok).toBe(false);
  });

  it('twinPairs reads the shipped table and the index, both directions', () => {
    const pairs = twinPairs(idx, 'mainnet');
    expect(pairs.cardOf.get('80')).toBe('81');
    expect(pairs.passportOf.get('81')).toBe('80');
    expect(pairs.passportOf.get('73')).toBe('72'); // constants/twin-proposals.ts
  });
});
