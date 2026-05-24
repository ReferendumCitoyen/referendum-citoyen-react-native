/**
 * One-shot signal flagged when a vote tx has just been submitted, consumed
 * by the home screen's useFocusEffect on the next return. Lets us schedule
 * an extra refresh ~4 s after the user lands on home to catch the count
 * update once the tx has propagated through Rarimo's L2 (the immediate
 * focus-time refetch usually races ahead of confirmation and shows the
 * pre-vote count).
 *
 * Module-level state on purpose: a React context would need a Provider
 * wrapping both the voting flow and the home tab, which complicates the
 * existing layout. A simple ref-like singleton is enough — there's exactly
 * one user voting at a time, and a stale flag (e.g. app crash mid-flow)
 * just causes one harmless extra refresh on the next home visit.
 */

let pending = false;

/** Voting flow calls this after Step11 reports the on-chain vote tx was
 * accepted by the relayer (we have a hash but not necessarily confirmation). */
export function markVoteJustCast(): void {
  pending = true;
}

/** Home tab calls this from its focus effect. Returns true exactly once
 * after each `markVoteJustCast()`. */
export function consumePendingVote(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}
