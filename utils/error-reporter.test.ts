import { isExpectedError, formatError, formatContext } from './error-reporter';

describe('isExpectedError', () => {
  it.each([
    ['Passeport expiré'],
    ['passport expired'],
    ['CAN ou MRZ incorrect'],
    ['BAC failed'],
    ['Aucun document détecté'],
    ['Lecture annulée par l\'utilisateur'],
    ['already voted'],
    ['Proposal closed'],
    ['proposal not active'],
    ['Nullifier already used'],
    ['Network request failed'],
    ['offline'],
    ['AbortError: aborted'],
    ['User cancelled'],
  ])('classifies %p as expected', (msg) => {
    expect(isExpectedError(new Error(msg))).toBe(true);
  });

  it.each([
    ['UnsatisfiedLinkError: dlopen failed'],
    ['Cannot read properties of undefined'],
    ['TypeError: not iterable'],
    ['proof generation failed: array length mismatch'],
    [''],
  ])('classifies %p as unexpected', (msg) => {
    expect(isExpectedError(new Error(msg))).toBe(false);
  });

  it('accepts plain strings', () => {
    expect(isExpectedError('already voted')).toBe(true);
    expect(isExpectedError('boom')).toBe(false);
  });

  it('accepts unknown shape and returns false', () => {
    expect(isExpectedError(undefined)).toBe(false);
    expect(isExpectedError(null)).toBe(false);
    expect(isExpectedError(42)).toBe(false);
  });
});

// Caught by the on-device smoke test 2026-05-23: formatError dumped err.message
// + stack verbatim into the report file, bypassing the buffer's redaction.
// These tests pin the per-line redact() call so the leak can't reappear.
describe('formatError redaction', () => {
  it('redacts wallet, hex64, email, 8+ digits in Error.message', () => {
    const err = new Error(
      'wallet 0xabcdef0123456789abcdef0123456789abcdef01 hash 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef email a@b.co phone 0612345678',
    );
    const out = formatError(err);
    expect(out).not.toContain('0xabcdef0123456789abcdef0123456789abcdef01');
    expect(out).not.toContain('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    expect(out).not.toContain('a@b.co');
    expect(out).not.toContain('0612345678');
    expect(out).toContain('<addr>');
    expect(out).toContain('<hex64>');
    expect(out).toContain('<email>');
    expect(out).toContain('<digits>');
  });

  it('redacts every line of a multi-line stack', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at frame1 (0xabcdef0123456789abcdef0123456789abcdef01)\n    at frame2 (a@b.co)';
    const out = formatError(err);
    expect(out).not.toContain('0xabcdef0123456789abcdef0123456789abcdef01');
    expect(out).not.toContain('a@b.co');
  });

  it('redacts plain string errors', () => {
    expect(formatError('phone 0612345678')).toBe('phone <digits>');
  });

  it('redacts JSON-stringified non-Error objects', () => {
    expect(formatError({ wallet: '0xabcdef0123456789abcdef0123456789abcdef01' })).toContain('<addr>');
  });
});

describe('formatContext redaction', () => {
  it('redacts string values', () => {
    expect(formatContext({ step: 9, txHash: '0xabcdef0123456789abcdef0123456789abcdef01' }))
      .toContain('<addr>');
  });

  it('redacts JSON-stringified object values', () => {
    const out = formatContext({ payload: { email: 'a@b.co' } });
    expect(out).toContain('<email>');
    expect(out).not.toContain('a@b.co');
  });

  it('returns "<none>" for undefined context', () => {
    expect(formatContext(undefined)).toBe('<none>');
  });
});
