import { isExpectedError, formatError, formatContext, reportEnvelope } from './error-reporter';

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

// 2.0.2 item 1 (k): formatContext redacted the value alone and prefixed the
// field name afterwards, so a field named `can` escaped the label rule. The
// context is now an allow-list of technical fields.
describe('formatContext allow-list', () => {
  it('writes the technical fields', () => {
    const out = formatContext({ step: 7, network: 'mainnet', isPassportFlow: false, docType: 'idCard' });
    expect(out).toContain('step: 7');
    expect(out).toContain('network: mainnet');
    expect(out).toContain('isPassportFlow: false');
    expect(out).toContain('docType: idCard');
  });

  it('never writes a field that is not on the list, whatever it holds', () => {
    const out = formatContext({
      step: 9,
      can: '123456',
      txHash: '0xabcdef0123456789abcdef0123456789abcdef01',
      payload: { email: 'a@b.co' },
      proposalId: '73',
    });
    expect(out).not.toContain('123456');
    expect(out).not.toContain('abcdef0123456789');
    expect(out).not.toContain('a@b.co');
    expect(out).not.toContain('73');
    expect(out).not.toMatch(/\bcan\b/);
    expect(out).toContain('(4 other fields not included)');
  });

  it('drops a non-primitive value even under an allowed name', () => {
    expect(formatContext({ reason: { can: '123456' } as unknown as string })).not.toContain('123456');
  });

  it('redacts an allowed string value with its label', () => {
    const out = formatContext({ reason: 'relayer said can: 123456 and 0xabcdef0123456789abcdef0123456789abcdef01' });
    expect(out).not.toContain('123456');
    expect(out).toContain('<addr>');
  });

  it('returns "<none>" for undefined context', () => {
    expect(formatContext(undefined)).toBe('<none>');
  });
});

// Step 7 refuses two states before any proof is built (project decision,
// 2026-09-09). The
// message that reaches the reporter is the French one the user read, so these
// pin which of the two offers a report button and which does not.
describe('the Step 7 one-document refusals', () => {
  const alreadyVoted = new Error(
    '[VOTE_INELIGIBLE] Vous avez déjà voté sur cette question.',
  );
  const secondDocument = new Error(
    '[VOTE_INELIGIBLE] Vous avez déjà voté avec votre passeport. ' +
      'Un seul document par personne : continuez avec votre passeport.',
  );

  it('asks for no report when the user has simply already voted', () => {
    expect(isExpectedError(alreadyVoted)).toBe(true);
  });

  it('still offers a report on the second-document refusal', () => {
    expect(isExpectedError(secondDocument)).toBe(false);
  });
});

describe('the report subject', () => {
  // Deliberately loose on the flavour and the translated words — neither
  // resolves in jest — and strict on the shape the Proton inbox filters on:
  // two leading brackets, flavour then platform.
  it('names the platform in its own bracket, after the flavour', () => {
    expect(reportEnvelope('error', '2.0.1', '25').subject).toMatch(
      /^\[[^\]]+\]\[(iOS|Android)\] /,
    );
  });

  it('does the same for a successful vote', () => {
    expect(reportEnvelope('success', '2.0.1', '25').subject).toMatch(
      /^\[[^\]]+\]\[(iOS|Android)\] /,
    );
  });

  it('keeps the version and build at the end, where they were', () => {
    expect(reportEnvelope('error', '2.0.1', '25').subject).toContain('v2.0.1 (build 25)');
  });
});
