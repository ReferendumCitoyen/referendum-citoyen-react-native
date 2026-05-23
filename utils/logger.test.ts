import { redact } from './logger';

describe('redact', () => {
  it('redacts 64-hex strings (BJJ key, SHA-256, tx hash)', () => {
    const line = 'private key: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(redact(line)).toBe('private key: <hex64>');
  });

  it('redacts 0x-prefixed 40-hex wallet addresses', () => {
    expect(redact('to: 0xAbCdef0123456789AbCdef0123456789AbCdef01')).toBe('to: <addr>');
  });

  it('redacts 0x-prefixed 64-hex hashes', () => {
    const h = '0x' + 'a'.repeat(64);
    expect(redact(`hash: ${h}`)).toBe('hash: <hex64>');
  });

  it('redacts whole-line MRZ rows', () => {
    expect(redact('P<FRADUPONT<<JEAN<<<<<<<<<<<<<<<<<<<<<<<<<<<')).toBe('<mrz>');
  });

  it('does NOT redact short MRZ-like fragments inside other text', () => {
    expect(redact('header: P<FRA')).toBe('header: P<FRA');
  });

  it('redacts labelled PII fields', () => {
    expect(redact('passportNumber: 12AB34567')).toMatch(/passportNumber:<redacted>/);
    expect(redact('"surname":"DUPONT"')).toMatch(/"surname":<redacted>/);
    expect(redact('dateOfBirth=1990-01-01')).toMatch(/dateOfBirth:<redacted>/);
  });

  it('redacts email addresses', () => {
    expect(redact('user contact: jean.dupont@example.com here')).toBe('user contact: <email> here');
  });

  it('redacts 8+ consecutive digits', () => {
    expect(redact('phone 0612345678 call')).toBe('phone <digits> call');
    expect(redact('epoch 1716471234 ms')).toBe('epoch <digits> ms');
  });

  it('does NOT redact short digit sequences (HTTP codes, small ints)', () => {
    expect(redact('status 404 retry 3 times')).toBe('status 404 retry 3 times');
  });

  it('leaves clean text unchanged', () => {
    expect(redact('[FreedomTool] starting registration')).toBe('[FreedomTool] starting registration');
  });
});
