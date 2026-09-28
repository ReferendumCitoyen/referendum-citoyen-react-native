/**
 * Classify whether an error is a transient, server-side relayer/transport
 * failure (HTTP 5xx, a network failure, or a confirmation timeout) as opposed
 * to a permanent client/logic error (bad request, ineligibility, missing CSCA,
 * not-yet-registered).
 *
 * Why this matters
 * ----------------
 * The Rarimo registration relayer returns an opaque `500 Internal Server Error`
 * for both infra problems and txs that would revert — we can't distinguish, so
 * we treat all 5xx uniformly as "temporarily unavailable, try again later".
 * Callers (Step 7) use this to (a) show an honest "service unavailable" message
 * instead of the misleading "restore your key", and (b) BLOCK the flow so the
 * user isn't auto-advanced into a vote that will fail with existence=false.
 */
export function isServiceUnavailableError(err: unknown): boolean {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return false;
  const msg = raw.toLowerCase();

  // HTTP 5xx surfaced by our relayer error strings ("relayer 500 : …",
  // "HTTP error 503: …"). Require a 5xx code alongside a relayer/http/server
  // context so a stray "500" elsewhere doesn't trip it.
  if (/\b5\d\d\b/.test(msg) && /(relayer|http|server)/.test(msg)) return true;

  // Generic server-error body with no parsed status code.
  if (msg.includes('internal server error')) return true;

  // Transport/network failures — fetch throws these before any HTTP status.
  if (/(network request failed|failed to fetch|network error|connection (refused|reset)|econnrefused|enotfound)/.test(msg)) {
    return true;
  }

  // Timeouts: a slow relayer, or our Step 7 registration-confirmation poll
  // ("Registration confirmation timed out after 63s") — both mean the
  // registration hasn't landed; block rather than advance to the vote.
  if (/(timed out|timeout|request was aborted|operation was aborted)/.test(msg)) {
    return true;
  }

  return false;
}


/**
 * Whether a vote failure is final for this document, so retrying could only
 * fail the same way.
 *
 * Everything else — a reverted tx, a relayer 5xx, a dropped connection, the
 * registration-root race (fixed in the SDK patch, but a second voter can still
 * lose a different race) — is worth one more attempt: a retry regenerates the
 * proof against the current chain state, which is exactly what makes it
 * succeed. The vote screen shows "Réessayer le vote" unless this returns true.
 *
 * Matches on the message the user was shown as well as the raw error, because
 * the already-voted paths in Step11 call onError with a translated string and
 * no error object at all.
 */
const TERMINAL_VOTE_PATTERNS: RegExp[] = [
  // fr: "a déjà voté", "vous avez déjà voté sur cette question"
  /d[ée]j[àa]\s+vot[ée]/i,
  /already\s+voted/i,
  /nullifier\s+already\s+used/i,
  /proposal\s+(closed|not\s+active)/i,
  // FreedomTool.verify throws these two verbatim, before any proof is made.
  /voting has (ended|not started)/i,
  /le vote (est terminé|n'a pas encore commencé)/i,
  // Eligibility refused on the document itself (age, nationality). No global
  // "[VOTE_INELIGIBLE]" pattern any more: each sub-case has its own entry in
  // utils/vote-error-table.ts, which Step 11 passes by code, so that the
  // unsupported-document case stays reportable. This list is only the
  // fallback for a caller that passes no code.
  /réservé aux (personnes majeures|citoyens français)/i,
];

export function isTerminalVoteError(reason?: string | null, err?: unknown): boolean {
  const fromErr =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const haystack = `${reason ?? ''}\n${fromErr}`;
  if (!haystack.trim()) return false;
  return TERMINAL_VOTE_PATTERNS.some((p) => p.test(haystack));
}
