import {
  mergeTwins,
  otherTwinId,
  pairProposals,
  pairingKey,
  sumVotingResults,
  twinIdFor,
  type ProposalLike,
} from './proposal-pairing';

const PASSPORT = '0x8Dea8065888A14F66ba9Fb944353d898663863cf';
const CARD = '0x7d73513d64ee4427cf60711b9c4d76284d4f9e2f';

type Fixture = ProposalLike & { description: string };

const proposal = (
  id: number,
  contract: string,
  overrides: Partial<Fixture> = {},
): Fixture => ({
  id: String(id),
  startTimestamp: 1_000n,
  duration: 1_000n,
  sendVoteContractAddress: contract,
  title: 'TEST DOUBLE — passeport et carte',
  description: 'Scrutin de test.',
  questions: [{ title: 'Le vote fonctionne-t-il ?', variants: ['Oui', 'Non', 'Blanc'] }],
  votingResults: [[1n, 0n, 0n]],
  ...overrides,
});

describe('pairingKey', () => {
  it('ignores case, surrounding and repeated whitespace, and the description', () => {
    const a = proposal(1, PASSPORT, { title: '  Test  Double — passeport et carte ', description: 'x.' });
    const b = proposal(2, CARD, { title: 'TEST DOUBLE — PASSEPORT ET CARTE', description: 'x' });
    expect(pairingKey(a)).toBe(pairingKey(b));
  });

  it('changes when an option differs', () => {
    const a = proposal(1, PASSPORT);
    const b = proposal(2, CARD, {
      questions: [{ title: 'Le vote fonctionne-t-il ?', variants: ['Oui', 'Non', 'Blanc', 'Je refuse de voter'] }],
    });
    expect(pairingKey(a)).not.toBe(pairingKey(b));
  });
});

describe('sumVotingResults', () => {
  it('adds cell by cell and pads the shorter side with zeros', () => {
    expect(sumVotingResults([[1n, 2n]], [[3n, 4n, 5n]])).toEqual([[4n, 6n, 5n]]);
    expect(sumVotingResults(undefined, [[1n]])).toEqual([[1n]]);
    expect(sumVotingResults([], [])).toEqual([]);
  });
});

describe('pairProposals', () => {
  it('folds a passport proposal and its card twin into one entry under the passport id', () => {
    const passport = proposal(68, PASSPORT, { votingResults: [[2n, 1n, 0n]] });
    const card = proposal(69, CARD, { votingResults: [[1n, 0n, 1n]] });
    const out = pairProposals([card, passport], {});
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('68');
    expect(out[0].sendVoteContractAddress).toBe(PASSPORT);
    expect(out[0].votingResults).toEqual([[3n, 1n, 1n]]);
    expect(out[0].twin).toEqual({ passportId: '68', cardId: '69' });
  });

  it('keeps the entry where the passport member was, and drops the card member', () => {
    const other = proposal(70, PASSPORT, { title: 'Autre question' });
    const card = proposal(69, CARD);
    const passport = proposal(68, PASSPORT);
    expect(pairProposals([other, card, passport], {}).map((p) => p.id)).toEqual(['70', '68']);
  });

  it('never pairs two proposals on the same contract, even with the same text', () => {
    const out = pairProposals([proposal(60, PASSPORT), proposal(59, PASSPORT)], {});
    expect(out.map((p) => p.id)).toEqual(['60', '59']);
    expect(out.every((p) => !p.twin)).toBe(true);
  });

  it('does not pair when the options differ', () => {
    const passport = proposal(68, PASSPORT);
    const card = proposal(69, CARD, {
      questions: [{ title: 'Le vote fonctionne-t-il ?', variants: ['Oui', 'Non'] }],
    });
    expect(pairProposals([passport, card], {})).toHaveLength(2);
  });

  it('does not pair when the voting windows do not overlap', () => {
    const passport = proposal(68, PASSPORT, { startTimestamp: 1_000n, duration: 100n });
    const card = proposal(69, CARD, { startTimestamp: 5_000n, duration: 100n });
    expect(pairProposals([passport, card], {})).toHaveLength(2);
  });

  it('pairs the newest of each side when a question was created more than once', () => {
    const out = pairProposals(
      [proposal(72, CARD), proposal(71, PASSPORT), proposal(70, CARD), proposal(69, PASSPORT)],
      {},
    );
    expect(out.map((p) => p.id)).toEqual(['71', '70', '69']);
    expect(out[0].twin).toEqual({ passportId: '71', cardId: '72' });
    expect(out[1].twin).toBeUndefined();
  });

  it('honours a declared pair whose texts differ', () => {
    const passport = proposal(52, PASSPORT, { title: 'SUPPRESSION DES ZFE' });
    const card = proposal(80, CARD, { title: 'Suppression des ZFE (carte)' });
    const out = pairProposals([card, passport], { '52': '80' });
    expect(out).toHaveLength(1);
    expect(out[0].twin).toEqual({ passportId: '52', cardId: '80' });
  });

  it('puts the passport member in front when a declared pair is written the wrong way round', () => {
    const passport = proposal(52, PASSPORT, { title: 'A' });
    const card = proposal(80, CARD, { title: 'B' });
    const out = pairProposals([passport, card], { '80': '52' });
    expect(out[0].id).toBe('52');
    expect(out[0].twin).toEqual({ passportId: '52', cardId: '80' });
  });

  it('ignores a declared pair with a missing member or two members on one contract', () => {
    const out = pairProposals([proposal(52, PASSPORT, { title: 'A' }), proposal(53, PASSPORT, { title: 'B' })], {
      '52': '80',
      '53': '52',
    });
    expect(out.map((p) => p.id)).toEqual(['52', '53']);
    expect(out.every((p) => !p.twin)).toBe(true);
  });

  it('uses the shipped table by default', () => {
    const out = pairProposals([proposal(68, PASSPORT, { title: 'x' }), proposal(69, CARD, { title: 'y' })]);
    expect(out).toHaveLength(1);
    expect(out[0].twin).toEqual({ passportId: '68', cardId: '69' });
  });
});

describe('twinIdFor / otherTwinId', () => {
  const merged = mergeTwins(proposal(68, PASSPORT), proposal(69, CARD));

  it('sends a card to the card twin and a passport to the passport twin', () => {
    expect(twinIdFor(merged, 'idCard')).toBe('69');
    expect(twinIdFor(merged, 'passport')).toBe('68');
  });

  it('answers a single with its own id whatever the document', () => {
    const single = proposal(57, CARD);
    expect(twinIdFor(single, 'passport')).toBe('57');
    expect(twinIdFor(single, 'idCard')).toBe('57');
  });

  it('finds the other member from either id', () => {
    const list = [merged, proposal(57, CARD)];
    expect(otherTwinId(list, '68')).toBe('69');
    expect(otherTwinId(list, '69')).toBe('68');
    expect(otherTwinId(list, '57')).toBeUndefined();
  });
});
