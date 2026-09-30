import { findSecondDocumentConflict } from '@/utils/second-document-guard';
import type { DocType, PassportKeyEntry } from '@/utils/passport-key-db';

const PERSON = 'a'.repeat(64);
const OTHER_PERSON = 'b'.repeat(64);

let n = 0;
function row(over: Partial<PassportKeyEntry> & { docType?: DocType }): PassportKeyEntry {
  n += 1;
  return {
    passportHash: String(n).padStart(64, '0'),
    privateKey: String(n).repeat(64).slice(0, 64),
    addedAt: 1_700_000_000,
    ...over,
  };
}

const neverVoted = async () => false;
const alwaysVoted = async () => true;

describe('findSecondDocumentConflict', () => {
  it('says nothing when the phone holds no other document', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [row({ docType: 'passport', personKey: PERSON })],
        personKey: PERSON,
        docType: 'passport',
        ownPrivateKey: 'f'.repeat(64),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });

  // The case from the 2026-09-09 test night: a card carrying its own key from
  // build 16, next to a passport that had already voted.
  it('refuses a card when the passport of the same person has voted', async () => {
    const conflict = await findSecondDocumentConflict({
      entries: [
        row({ docType: 'passport', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
        row({ docType: 'idCard', personKey: PERSON, privateKey: 'c3'.repeat(32) }),
      ],
      personKey: PERSON,
      docType: 'idCard',
      ownPrivateKey: 'c3'.repeat(32),
      hasVoted: async (sk) => sk === 'a1'.repeat(32),
    });
    expect(conflict).toEqual({ otherDocType: 'passport', reason: 'voted' });
  });

  it('refuses a passport when the card of the same person has voted', async () => {
    const conflict = await findSecondDocumentConflict({
      entries: [
        row({ docType: 'idCard', personKey: PERSON, privateKey: 'c3'.repeat(32) }),
        row({ docType: 'passport', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
      ],
      personKey: PERSON,
      docType: 'passport',
      ownPrivateKey: 'a1'.repeat(32),
      hasVoted: async (sk) => sk === 'c3'.repeat(32),
    });
    expect(conflict).toEqual({ otherDocType: 'idCard', reason: 'voted' });
  });

  // A sibling that is bound on chain blocks even on a proposal nobody has
  // voted on yet — that is the point of recording it locally.
  it('refuses on a registered sibling without asking the chain', async () => {
    const hasVoted = jest.fn(neverVoted);
    const conflict = await findSecondDocumentConflict({
      entries: [
        row({
          docType: 'passport',
          personKey: PERSON,
          privateKey: 'a1'.repeat(32),
          registeredAt: 1_757_000_000,
        }),
        row({ docType: 'idCard', personKey: PERSON, privateKey: 'c3'.repeat(32) }),
      ],
      personKey: PERSON,
      docType: 'idCard',
      ownPrivateKey: 'c3'.repeat(32),
      hasVoted,
    });
    expect(conflict).toEqual({ otherDocType: 'passport', reason: 'registered' });
    expect(hasVoted).not.toHaveBeenCalled();
  });

  // onChainIdentity is written when the chain reports a document bound to a
  // key we do NOT hold — the one state in which that document can never vote
  // again. It must not count as evidence, or the person is refused on their
  // remaining document because of the one they have already lost.
  it('does not count a document bound to a key this phone has lost', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [
          row({
            docType: 'passport',
            personKey: PERSON,
            privateKey: 'a1'.repeat(32),
            onChainIdentity: '0x' + 'de'.repeat(32),
          }),
          row({ docType: 'idCard', personKey: PERSON, privateKey: 'c3'.repeat(32) }),
        ],
        personKey: PERSON,
        docType: 'idCard',
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: neverVoted,
      }),
    ).toBeNull();
  });

  // The dead end this guard must not create: two documents scanned, neither
  // used. Both have to stay available or the person cannot vote at all.
  it('allows a card when the passport was only ever scanned', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [
          row({ docType: 'passport', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
          row({ docType: 'idCard', personKey: PERSON, privateKey: 'c3'.repeat(32) }),
        ],
        personKey: PERSON,
        docType: 'idCard',
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: neverVoted,
      }),
    ).toBeNull();
  });

  // Sharing a key means sharing a nullifier. Level 1 and the StateKeeper
  // refusal both cover that, and both say it better than this would.
  it('stays quiet when the other document shares our key', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [
          row({ docType: 'passport', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
          row({ docType: 'idCard', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
        ],
        personKey: PERSON,
        docType: 'idCard',
        ownPrivateKey: 'a1'.repeat(32),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });

  it('never links two documents of the same type', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [
          row({ docType: 'passport', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
          row({ docType: 'passport', personKey: PERSON, privateKey: 'c3'.repeat(32) }),
        ],
        personKey: PERSON,
        docType: 'passport',
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });

  it('never links two different people', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [
          row({ docType: 'passport', personKey: OTHER_PERSON, privateKey: 'a1'.repeat(32) }),
        ],
        personKey: PERSON,
        docType: 'idCard',
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });

  // A document with no DG11, or a row from before the person key existed.
  it('says nothing without a person key or a document type', async () => {
    const entries = [
      row({ docType: 'passport', personKey: PERSON, privateKey: 'a1'.repeat(32) }),
    ];
    expect(
      await findSecondDocumentConflict({
        entries,
        docType: 'idCard',
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
    expect(
      await findSecondDocumentConflict({
        entries,
        personKey: PERSON,
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });

  // Untyped rows predate the person key, so they can never be matched as a
  // sibling — pinned so a future backfill of one field without the other
  // cannot make the person-key rule fire on a row it cannot describe. (For a
  // CARD an untyped row is the 1.2.x passport case and is refused outright;
  // see the 'legacy' block below.)
  it('never matches rows with no document type as a sibling', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [row({ personKey: PERSON, privateKey: 'a1'.repeat(32) })],
        personKey: PERSON,
        docType: 'passport',
        ownPrivateKey: 'c3'.repeat(32),
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });

  it('compares keys without caring about case or padding', async () => {
    expect(
      await findSecondDocumentConflict({
        entries: [
          row({ docType: 'passport', personKey: PERSON, privateKey: 'A1'.repeat(32) }),
        ],
        personKey: PERSON,
        docType: 'idCard',
        ownPrivateKey: ' a1'.repeat(1) + 'a1'.repeat(31) + ' ',
        hasVoted: alwaysVoted,
      }),
    ).toBeNull();
  });
});

describe('a passport row from 1.2.x (no docType, no personKey)', () => {
  const legacyPassport = () => row({});

  it('refuses a new card next to it, so the card cannot take a second key', async () => {
    const out = await findSecondDocumentConflict({
      entries: [legacyPassport(), row({ docType: 'idCard', personKey: PERSON })],
      personKey: PERSON,
      docType: 'idCard',
      ownPrivateKey: 'c'.repeat(64),
      hasVoted: neverVoted,
    });
    expect(out).toEqual({ otherDocType: 'passport', reason: 'legacy' });
  });

  it('refuses even a card without DG11, which could never be linked', async () => {
    const out = await findSecondDocumentConflict({
      entries: [legacyPassport()],
      personKey: undefined,
      docType: 'idCard',
      ownPrivateKey: 'c'.repeat(64),
      hasVoted: neverVoted,
    });
    expect(out).toEqual({ otherDocType: 'passport', reason: 'legacy' });
  });

  it('lets a second passport through: another passport is another person', async () => {
    const out = await findSecondDocumentConflict({
      entries: [legacyPassport()],
      personKey: PERSON,
      docType: 'passport',
      ownPrivateKey: 'c'.repeat(64),
      hasVoted: neverVoted,
    });
    expect(out).toBeNull();
  });

  it('stops refusing once that passport has been rescanned (row typed)', async () => {
    const out = await findSecondDocumentConflict({
      entries: [row({ docType: 'passport', personKey: OTHER_PERSON })],
      personKey: PERSON,
      docType: 'idCard',
      ownPrivateKey: 'c'.repeat(64),
      hasVoted: neverVoted,
    });
    expect(out).toBeNull();
  });

  it('ignores the row of the card being scanned itself', async () => {
    const own = 'c'.repeat(64);
    const out = await findSecondDocumentConflict({
      entries: [row({ privateKey: own })],
      personKey: PERSON,
      docType: 'idCard',
      ownPrivateKey: own,
      hasVoted: neverVoted,
    });
    expect(out).toBeNull();
  });
});
