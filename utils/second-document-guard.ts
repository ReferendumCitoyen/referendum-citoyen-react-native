/**
 * One document per person, checked on this phone before any proof is built.
 *
 * The rule the project settled on (2026-09-08) is that a person votes
 * with one document, whichever they scanned first. Two mechanisms enforce it
 * and both have a hole:
 *
 *  - Level 1 (utils/identity.ts) makes the SECOND document inherit the
 *    FIRST one's key when their DG11 person keys match, so the two share a
 *    nullifier. It only fires when the row is CREATED. A document whose row
 *    already existed — anything scanned before Level 1 shipped — keeps the key
 *    it was given and never links.
 *  - StateKeeper refuses to bind a second document to an identity that is
 *    already bound, which utils/relayer-simulation.ts surfaces as
 *    IDENTITY_BOUND_ELSEWHERE. That only catches documents that share a key.
 *    Two keys are two identities, and the relayer accepts both.
 *
 * Between them sits the case a tester actually hit on 2026-09-09: an ID card
 * whose row was written on build 16 with a key of its own, next to a passport
 * that had already voted. Nothing refused it. With a working prover he would
 * have held two identities and cast two votes.
 *
 * So: before Step 7 registers anything, look for a document of the OTHER type
 * belonging to the same person and holding a DIFFERENT key, and refuse if that
 * document is in use. Rows that share our key are left to the two mechanisms
 * above, which already handle them and word it better.
 *
 * "In use" is deliberately evidence-based rather than "a row exists". A row is
 * created by scanning, and scanning is not registering: on the last two test
 * nights people scanned documents that then failed to register. Blocking on
 * the mere existence of a sibling row would strand anyone holding two
 * unregistered documents — refused on the card because of the passport, and on
 * the passport because of the card, with no way out of either. The evidence is
 * one of:
 *
 *  - the sibling has voted on THIS proposal (its nullifier is in the tree), or
 *  - a previous scan saw the chain report the sibling bound to ITS OWN key, and
 *    recorded `registeredAt` for it.
 *
 * Neither can be true of a document that was only ever scanned, and both are
 * facts rather than guesses, so the message we show is true as written.
 *
 * `registeredAt` rather than `onChainIdentity` is load-bearing: the latter is
 * also written when the chain reports a document bound to a key this phone does
 * not hold, which is exactly when that document can never vote again. Reading
 * that as "in use" would refuse the person's remaining document and leave them
 * unable to vote with either.
 *
 * The matching itself is pure and the on-chain question is injected, so this
 * is testable without a chain or a keystore.
 */
import type { DocType, PassportKeyEntry } from '@/utils/passport-key-db';

/**
 * The June phones. A passport row written by 1.2.x has neither a document
 * type nor a person key, so a card scanned next to it can never be linked:
 * it would take a key of its own and register as a second identity — one
 * person, two votes. Until that passport is scanned once on this version
 * (which backfills both), a NEW card is refused (`reason: 'legacy'`). Only
 * cards: 1.2.x knew no other document, so an untyped row IS a passport, and
 * a second passport is another person by the project's rule.
 */
export interface SecondDocumentConflict {
  /** The document the user should carry on with. */
  otherDocType: DocType;
  /** Which piece of evidence fired — each needs different wording. */
  reason: 'voted' | 'registered' | 'legacy';
}

type TypedEntry = PassportKeyEntry & { docType: DocType };

export async function findSecondDocumentConflict(args: {
  /** Every row in the key DB. */
  entries: PassportKeyEntry[];
  /** The person key of the document being scanned; absent for the ~0.6% of
   *  documents with no DG11, and for rows written before it existed. */
  personKey?: string;
  /** The type of the document being scanned. */
  docType?: DocType;
  /** The key the document being scanned would register with. */
  ownPrivateKey: string;
  /** Has this key already voted on the proposal in hand? Injected: the real
   *  one is three eth_calls (utils/vote-nullifier.ts). */
  hasVoted: (bjjPrivateKeyHex: string) => Promise<boolean>;
}): Promise<SecondDocumentConflict | null> {
  const { entries, personKey, docType, ownPrivateKey, hasVoted } = args;
  const own = ownPrivateKey.trim().toLowerCase();

  if (docType === 'idCard') {
    const untyped = entries.find(
      (e) => e.docType === undefined && e.privateKey.trim().toLowerCase() !== own,
    );
    if (untyped) return { otherDocType: 'passport', reason: 'legacy' };
  }

  // No person key or no document type means no way to tell whose document
  // this is. Silence is the only honest answer.
  if (!personKey || !docType) return null;
  const siblings = entries.filter(
    (e): e is TypedEntry =>
      e.personKey === personKey &&
      e.docType !== undefined &&
      e.docType !== docType &&
      e.privateKey.trim().toLowerCase() !== own,
  );
  if (siblings.length === 0) return null;

  // Local evidence first — it costs nothing and does not depend on the
  // proposal, so it holds for a question the sibling has not voted on yet.
  const bound = siblings.find((e) => e.registeredAt);
  if (bound) return { otherDocType: bound.docType, reason: 'registered' };

  for (const sibling of siblings) {
    if (await hasVoted(sibling.privateKey)) {
      return { otherDocType: sibling.docType, reason: 'voted' };
    }
  }

  return null;
}
