/**
 * Whether the vote is by ID card alone.
 *
 * Decided on the launch call of 2026-09-15 (project team and Rarimo): the
 * passport is parked. Every card + passport variant needed identity data on a
 * server of ours to keep "one person, one vote" across the two documents; the
 * card alone needs none, is as private as the passport alone was in June, and
 * is the document every French citizen can get for free.
 *
 * Read by app/voting-flow.tsx and by nothing else: the flow opens straight on
 * the card path and the document chooser never shows. The passport screens,
 * circuits and relayers stay in the tree, unreachable — a one-line revert
 * rather than a deleted code path, like the other switches in this folder.
 * The list only carries the card twin of the question (#73), so a passport
 * proof would have nowhere to go anyway: IDCardVoting reverts on one ("TD3
 * voting is not supported").
 */
export const CARD_ONLY_LAUNCH = true;
