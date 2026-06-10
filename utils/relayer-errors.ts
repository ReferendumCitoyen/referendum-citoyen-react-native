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
