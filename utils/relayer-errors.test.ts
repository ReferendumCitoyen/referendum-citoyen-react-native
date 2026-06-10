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
