import { isServiceUnavailableError, isTerminalVoteError } from './relayer-errors';
import { isExpectedError } from './error-reporter';
import { classifyVoteError, VOTE_ERROR_TABLE } from './vote-error-table';

describe('isServiceUnavailableError', () => {
  it('matches registration relayer 5xx (the reported outage)', () => {
    expect(
      isServiceUnavailableError(
        new Error('[registerViaNoir] relayer 500 : {"errors":[{"title":"Internal Server Error","status":"500"}]}'),
      ),
    ).toBe(true);
    expect(
      isServiceUnavailableError(
        new Error('[csca-bootstrap] relayer 503: {"errors":[{"title":"Service Unavailable"}]}'),
      ),
    ).toBe(true);
    expect(isServiceUnavailableError(new Error('HTTP error 502: bad gateway'))).toBe(true);
  });

  it('matches a JSON "Internal Server Error" body even without a parsed status', () => {
    expect(isServiceUnavailableError(new Error('relayer failed: Internal Server Error'))).toBe(true);
  });

  it('matches the real Step11 vote-path failures from the 2026-06-11 outage', () => {
    // nginx 502 from the vote relayer, during that outage
    expect(
      isServiceUnavailableError(
        new Error('[submitVote] relayer 502 : <html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n'),
      ),
    ).toBe(true);
    // ethers RPC-level 502, minutes later
    expect(
      isServiceUnavailableError(
        new Error('server response 502  (request={  }, response={  }, error=null, info={ "requestUrl": "https://l2.rarimo.com" })'),
      ),
    ).toBe(true);
    // registration relayer 504, later in the same outage
    expect(isServiceUnavailableError(new Error('[registerViaNoir] relayer 504 : <html>'))).toBe(true);
  });

  it('does NOT swallow the TD1 relayer 400 "failed to estimate gas" (a 4xx, handled elsewhere)', () => {
    expect(
      isServiceUnavailableError(
        new Error('[SDK] sendProposalRequest failed: 400 : {"error":"Execution reverted","field":"failed to estimate gas"}'),
      ),
    ).toBe(false);
  });

  it('matches network/transport failures (fetch throws before any HTTP status)', () => {
    expect(isServiceUnavailableError(new Error('Network request failed'))).toBe(true);
    expect(isServiceUnavailableError(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isServiceUnavailableError(new Error('The request timed out.'))).toBe(true);
  });

  it('matches the Step7 registration-confirmation timeout (was auto-advancing to a doomed vote)', () => {
    expect(
      isServiceUnavailableError(
        new Error('[Step7] Registration confirmation timed out after 63s. Please retry the vote in a moment.'),
      ),
    ).toBe(true);
  });

  it('does NOT match logic/eligibility errors (those are permanent, handled separately)', () => {
    expect(isServiceUnavailableError(new Error('[VOTE_INELIGIBLE] Vous vous êtes enregistré après la date limite.'))).toBe(false);
    expect(isServiceUnavailableError(new Error('[CSCA_MISSING] Le certificat racine…'))).toBe(false);
    expect(isServiceUnavailableError(new Error('relayer 400: cannot be blank'))).toBe(false);
    expect(isServiceUnavailableError(new Error('existence=false. The identity is not yet registered'))).toBe(false);
  });

  it('handles null/undefined/non-Error inputs safely', () => {
    expect(isServiceUnavailableError(null)).toBe(false);
    expect(isServiceUnavailableError(undefined)).toBe(false);
    expect(isServiceUnavailableError('')).toBe(false);
  });
});

/**
 * The reason the report button was vanishing on registration/vote failures:
 * `isServiceUnavailableError` and `isExpectedError` OVERLAP on transport
 * strings. A dropped connection during registration is "service unavailable"
 * (so the screen explains it) AND "expected" (so ErrorReportButton hid itself)
 * — leaving a dead-end screen with no way to report. Step 7 and Step 12 now
 * pass `forceShow={isServiceUnavailableError(err)}` to override that. These
 * lock the overlap so a future edit to either predicate can't quietly re-open
 * the hole.
 */
describe('report-button visibility overlap (why forceShow exists)', () => {
  const err = (m: string) => new Error(m);

  it('a transport failure is BOTH service-unavailable and expected — the trap', () => {
    const e = err('Network request failed');
    expect(isServiceUnavailableError(e)).toBe(true);
    // isExpectedError would hide the button; forceShow = the left side is what
    // rescues it at the terminal steps.
    expect(isExpectedError(e)).toBe(true);
  });

  it('a genuine relayer 5xx is service-unavailable but NOT expected — button always showed', () => {
    const e = err('relayer 500 : internal');
    expect(isServiceUnavailableError(e)).toBe(true);
    expect(isExpectedError(e)).toBe(false);
  });

  it('a self-explanatory error is neither, so forceShow never fires for it', () => {
    const e = err('Passeport expiré');
    expect(isServiceUnavailableError(e)).toBe(false);
    expect(isExpectedError(e)).toBe(true); // stays suppressed, correctly
  });

  it('forceShow decision: forceShow || !expected shows exactly the right set', () => {
    const decide = (m: string) => {
      const e = err(m);
      const forceShow = isServiceUnavailableError(e);
      return forceShow || !isExpectedError(e);
    };
    expect(decide('Network request failed')).toBe(true); // rescued
    expect(decide('relayer 500 : internal')).toBe(true); // already shown
    expect(decide('Passeport expiré')).toBe(false); // still suppressed
    expect(decide('scan cancelled')).toBe(false); // still suppressed
  });
});

describe('isTerminalVoteError', () => {
  it('is terminal for the already-voted messages Step11 shows', () => {
    // The exact strings from locales/*.json — Step11 passes the translated
    // sentence as `reason` with no error object.
    expect(
      isTerminalVoteError(
        "Le propriétaire de cette carte d'identité a déjà voté ou nous a informé qu'il refuse de voter",
      ),
    ).toBe(true);
    expect(
      isTerminalVoteError('The owner of this passport has already voted or has told us they refuse to vote'),
    ).toBe(true);
    expect(isTerminalVoteError('Vous avez déjà voté sur cette question')).toBe(true);
  });

  it('is terminal for contract states a retry cannot change', () => {
    expect(isTerminalVoteError(null, new Error('nullifier already used'))).toBe(true);
    expect(isTerminalVoteError(null, new Error('proposal closed'))).toBe(true);
    expect(isTerminalVoteError(null, new Error('proposal not active'))).toBe(true);
  });

  // 2.0.1 asserted "a 400 is retryable" here, full stop. R6 (21/09): a 400 is
  // terminal only when the cause is established locally, and that decision
  // now lives in the error table, by code; the opaque 400 keeps its Retry.
  it('the relayer 400: retryable when opaque, terminal when the rule fails locally', () => {
    const err = new Error('relayer 400 : {"error":"Execution reverted","field":"failed to estimate gas"}');
    expect(isTerminalVoteError(null, err)).toBe(false);
    const opaque = classifyVoteError(err);
    expect(opaque).toBe('rejected-opaque');
    expect(VOTE_ERROR_TABLE[opaque].retryable).toBe(true);
    // A card proof sent to the passport contract (#54 after #73).
    const local = classifyVoteError(err, { localIneligibility: 'wrong-document' });
    expect(local).toBe('unsupported-document');
    expect(VOTE_ERROR_TABLE[local].retryable).toBe(false);
    // The question was closed by the index in the meantime.
    expect(VOTE_ERROR_TABLE[classifyVoteError(err, { localIneligibility: 'closed' })].retryable).toBe(false);
  });

  it('no global [VOTE_INELIGIBLE] rule: an unmapped marker is not terminal by text alone', () => {
    expect(isTerminalVoteError(null, new Error('[VOTE_INELIGIBLE] something new'))).toBe(false);
  });

  it('is NOT terminal for transport and relayer failures', () => {
    expect(isTerminalVoteError(null, new Error('Network request failed'))).toBe(false);
    expect(isTerminalVoteError(null, new Error('[submitVote] relayer 500 : Internal Server Error'))).toBe(false);
    expect(isTerminalVoteError("Votre vote n'a pas été enregistré")).toBe(false);
  });

  it('is terminal for the voting-window and eligibility refusals', () => {
    // FreedomTool.verify's own throws
    expect(isTerminalVoteError(null, new Error('Voting has ended.'))).toBe(true);
    expect(isTerminalVoteError(null, new Error('Voting has not started.'))).toBe(true);
    expect(isTerminalVoteError('Le vote est terminé.')).toBe(true);
    expect(isTerminalVoteError("Le vote n'a pas encore commencé.")).toBe(true);
    // Eligibility, verbatim from utils/mrz-date-bounds.ts
    expect(
      isTerminalVoteError(
        '[VOTE_INELIGIBLE] Ce scrutin est réservé aux personnes majeures : la date de naissance lue sur le document',
      ),
    ).toBe(true);
    expect(
      isTerminalVoteError(
        '[VOTE_INELIGIBLE] Ce scrutin est réservé aux citoyens français : la nationalité lue sur le document',
      ),
    ).toBe(true);
  });

  it('defaults to retryable when there is nothing to classify', () => {
    expect(isTerminalVoteError()).toBe(false);
    expect(isTerminalVoteError(null, undefined)).toBe(false);
    expect(isTerminalVoteError('')).toBe(false);
  });
});
