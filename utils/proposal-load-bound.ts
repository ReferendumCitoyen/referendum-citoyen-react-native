/**
 * A bound on the home screen's proposal reads (problem P9).
 *
 * P9 was "Network request failed after very long freezes": four reports, one
 * of them blocked for 11 minutes. The rule that came out of it is that no
 * network call in this app waits for ever, and 2.0.2 applied it to the three
 * paths the report named: the initial status read (constants/rarime-config.ts
 * withRetry, attemptTimeoutMs), the registration POST and its body read
 * (utils/register-via-noir.ts:327, AbortController) and the vote POST
 * (utils/vote-calldata.ts:314, AbortController).
 *
 * It was never applied to the fourth, which is the one the voter meets first.
 * app/(tabs)/index.tsx calls `ft.getProposalInfo(id)` once per open question,
 * through Promise.allSettled, with nothing bounding any of them: a `finally`
 * that turns the spinner off is only reached when every one of those promises
 * has settled, so one stuck read is an indefinite spinner on the home screen.
 * Verified before writing this: AbortController appeared exactly three times
 * in the whole tree, in the three files above, and in none of the two call
 * sites here (fetchProposals and fetchBatch).
 *
 * Why a race and not an AbortController: getProposalInfo belongs to the SDK
 * and takes no signal. Inside it an IPFS fetch, an RPC read and a cache lookup
 * are chained, and there is no handle on any of them from here. So this is the
 * same shape as utils/registration-submission.ts boundedRead and as withRetry's
 * attemptTimeoutMs: the read is not cancelled, it is abandoned, and its late
 * answer is ignored. That is enough for the defect, which is the wait, not the
 * socket.
 */

/** Marks the rejection, so a caller can tell it from an RPC error. */
export const PROPOSAL_FETCH_TIMEOUT = '[PROPOSAL_FETCH_TIMEOUT]';

/**
 * One proposal read. 20 s, the same figure as the pre-flight status read
 * (STATUS_READ_ATTEMPT_TIMEOUT_MS): long enough for IPFS on a slow mobile
 * connection, short enough that the list either fills or says so.
 *
 * The reads run concurrently under Promise.allSettled, so this is also the
 * bound on the whole home-screen load, not the bound per question multiplied
 * by the number of questions.
 */
export const PROPOSAL_FETCH_TIMEOUT_MS = 20_000;

export function isProposalFetchTimeout(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.startsWith(PROPOSAL_FETCH_TIMEOUT);
}

/**
 * `read()`, or a rejection once `timeoutMs` has passed. The read itself is not
 * cancelled; its late result is ignored.
 *
 * The rejection carries the word "timeout", which is what the home screen's
 * catch already matches on to choose between its network message and its
 * generic one, so a bounded-out load reads as "check your connection" rather
 * than as an unexplained failure.
 */
export function boundedProposalFetch<T>(
  read: () => Promise<T>,
  id: string,
  timeoutMs: number = PROPOSAL_FETCH_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve().then(read),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `${PROPOSAL_FETCH_TIMEOUT} proposal ${id} did not answer within ${timeoutMs / 1000} s`,
            ),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
