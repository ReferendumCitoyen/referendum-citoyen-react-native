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

import { __testing } from './logger';

describe('ring buffer', () => {
  beforeEach(() => __testing.reset());

  it('evicts entries older than RETENTION_MS on push', () => {
    const now = 1_000_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    __testing.push('log', 'first');
    jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000); // 6 min later
    __testing.push('log', 'second');
    const entries = __testing.snapshot();
    expect(entries.map((e) => e.msg)).toEqual(['second']);
  });

  it('caps at MAX_ENTRIES (oldest dropped)', () => {
    for (let i = 0; i < 2050; i++) __testing.push('log', `m${i}`);
    const entries = __testing.snapshot();
    expect(entries.length).toBeLessThanOrEqual(2000);
    expect(entries[0].msg).toBe('m50');
    expect(entries[entries.length - 1].msg).toBe('m2049');
  });

  it('snapshot returns a frozen copy (does not reflect later pushes)', () => {
    __testing.push('log', 'a');
    const snap = __testing.snapshot();
    __testing.push('log', 'b');
    expect(snap.map((e) => e.msg)).toEqual(['a']);
  });

  it('redacts at push time', () => {
    __testing.push('log', 'key 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    expect(__testing.snapshot()[0].msg).toBe('key <hex64>');
  });
});

import { install, uninstall, formatArgs } from './logger';

describe('install / uninstall', () => {
  beforeEach(() => __testing.reset());
  afterEach(() => uninstall());

  it('captures console.log into the buffer', () => {
    install();
    console.log('hello');
    const snap = __testing.snapshot();
    expect(snap.some((e) => e.level === 'log' && e.msg.includes('hello'))).toBe(true);
  });

  it('still calls the original console method', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    install();
    console.log('through');
    expect(spy).toHaveBeenCalledWith('through');
    spy.mockRestore();
  });

  it('is idempotent (install twice does not double-capture)', () => {
    install();
    install();
    console.log('once');
    const count = __testing.snapshot().filter((e) => e.msg.includes('once')).length;
    expect(count).toBe(1);
  });
});

describe('formatArgs', () => {
  it('joins primitives with spaces', () => {
    expect(formatArgs(['a', 1, true])).toBe('a 1 true');
  });

  it('JSON.stringify-s objects', () => {
    expect(formatArgs([{ a: 1 }])).toBe('{"a":1}');
  });

  it('handles circular references safely', () => {
    const o: any = { a: 1 };
    o.self = o;
    expect(() => formatArgs([o])).not.toThrow();
    expect(formatArgs([o])).toContain('"a":1');
  });

  it('caps object depth at 3', () => {
    const o = { a: { b: { c: { d: { e: 'too-deep' } } } } };
    expect(formatArgs([o])).not.toContain('too-deep');
  });
});
