// Whether a newly scanned document reuses the BJJ key of a document this
// device already holds for the SAME PERSON, so that a passport and an ID card
// share one nullifier and the chain refuses the second vote.
//
// Read by utils/identity.ts::getOrCreateKeyForPassport and by nothing else.
//
// Like TD1_HEAVY_REGISTER in ./td1-heavy-register.ts, this is a single-point
// switch kept as a one-line revert rather than a deleted code path. `true` is
// the resting state; `false` restores the strict one-key-per-chip behaviour
// that predates it.
//
// What flipping it to `false` does — and does NOT do
// ---------------------------------------------------
// It stops NEW links being made. It does not unlink documents already sharing a
// key: those rows already hold the same privateKey, and the on-chain bonds made
// with it are immutable. A revert is a per-build change to future scans, not a
// per-user undo.
//
// It also stops the person key being computed and stored at all: the write
// follows this flag (utils/identity.ts::getOrCreateKeyForPassport). Earlier
// versions stored it regardless, so that flipping the flag back on would find
// rows already indexed; that traded a dictionary-attackable hash of public
// identity data, kept for a feature that is off, against a convenience the
// code does not need — setPersonKeyIfMissing backfills a row the next time
// its chip is read, and voting with a document reads its chip.
//
// Reach for `false` if a real homonym collision is reported (two different
// people refused as one), or if a linked key turns out to be in the BJJ dead
// zone (see the SK_MAX_EXCLUSIVE note in utils/identity.ts) and both documents
// have inherited it.
//
// Who this affects
// ----------------
// Only a document being scanned for the FIRST time on this device, when another
// document of the OTHER type for the same person is already in the DB. A
// document already in the DB keeps the key it has. A person with a single
// document sees no change at all.
//
// Off since the ID-card-only launch (2026-09-15, constants/card-only-launch.ts):
// a card gets its own key, never the passport's, and Step7 skips the
// second-document guard entirely — the June refusal of a card whose holder
// registered a passport included. The one-person-one-vote check that stays is
// the own-key nullifier read on the same question, which runs before the
// guard and does not depend on this flag.
export const UNIVERSAL_PERSON_KEY = false;
