import { isServiceUnavailableError } from './relayer-errors';

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
    // nginx 502 from the vote relayer (report 2026-06-11T08-21-36)
    expect(
      isServiceUnavailableError(
        new Error('[submitVote] relayer 502 : <html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n'),
      ),
    ).toBe(true);
    // ethers RPC-level 502 (report 2026-06-11T08-28-00)
    expect(
      isServiceUnavailableError(
        new Error('server response 502  (request={  }, response={  }, error=null, info={ "requestUrl": "https://l2.rarimo.com" })'),
      ),
    ).toBe(true);
    // registration relayer 504 (report 2026-06-11T08-48-51)
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
