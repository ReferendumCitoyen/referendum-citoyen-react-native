import { redact, isSensitiveLabel } from './logger';

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

  it('redacts a continuous hex blob longer than 64 chars (APDU transcript)', () => {
    const blob = 'a1b2c3d4'.repeat(20); // 160 hex chars, no internal word boundary
    expect(redact(`[RX] ${blob} (SW: 9000)`)).toBe('[RX] <hex> (SW: 9000)');
  });

  it('redacts a 500-char continuous hex string', () => {
    const hex = 'deadbeef'.repeat(63); // 504 hex chars
    expect(redact(hex)).toBe('<hex>');
  });

  it('still prefers the specific <hex64>/<addr> labels where they apply', () => {
    const h = 'a'.repeat(64);
    expect(redact(`key: ${h}`)).toBe('key: <hex64>');
    expect(redact('to: 0xAbCdef0123456789AbCdef0123456789AbCdef01')).toBe('to: <addr>');
  });

  it('does NOT redact short hex (<32 chars)', () => {
    expect(redact('color #aabbcc and id deadbeef')).toBe('color #aabbcc and id deadbeef');
  });

  it('leaves clean text unchanged', () => {
    expect(redact('[FreedomTool] starting registration')).toBe('[FreedomTool] starting registration');
  });
});

import { __testing, loggableTxHash, LOG_RETENTION_MINUTES, MAX_LOG_ENTRIES } from './logger';

// A registration attempt outlives a 5-minute window: the 2026-09-08 reports
// arrived with their opening lines already evicted. The window is pinned so a
// later "tidy" cannot quietly shrink it, and the report header reads the same
// constant, so the two cannot disagree.
describe('retention window', () => {
  it('keeps 20 minutes of logs', () => {
    expect(LOG_RETENTION_MINUTES).toBe(20);
  });
});

describe('ring buffer', () => {
  beforeEach(() => __testing.reset());

  it('evicts entries older than the retention window on push', () => {
    const now = 1_000_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    __testing.push('log', 'first');
    jest.spyOn(Date, 'now').mockReturnValue(now + (LOG_RETENTION_MINUTES - 1) * 60 * 1000);
    __testing.push('log', 'still inside');
    jest.spyOn(Date, 'now').mockReturnValue(now + (LOG_RETENTION_MINUTES + 1) * 60 * 1000);
    __testing.push('log', 'second');
    const entries = __testing.snapshot();
    expect(entries.map((e) => e.msg)).toEqual(['still inside', 'second']);
  });

  it('caps at MAX_LOG_ENTRIES (oldest dropped)', () => {
    for (let i = 0; i < MAX_LOG_ENTRIES + 50; i++) __testing.push('log', `m${i}`);
    const entries = __testing.snapshot();
    expect(entries.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES);
    expect(entries[0].msg).toBe('m50');
    expect(entries[entries.length - 1].msg).toBe(`m${MAX_LOG_ENTRIES + 49}`);
  });

  it('masks a registration transaction hash at push time', () => {
    const h = '0x' + 'ab'.repeat(32);
    __testing.push('log', `[csca-bootstrap] relayer accepted ${loggableTxHash(h)}`);
    expect(__testing.snapshot()[0].msg).toBe('[csca-bootstrap] relayer accepted tx:<hex64>');
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

  // 2.0.2 item 1 (l): the system log (Xcode, logcat) used to get the raw
  // arguments while only the report was filtered.
  it('passes only the redacted line to the native console in a release build', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const g = global as unknown as { __DEV__: boolean };
    const wasDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      install();
      console.log('can:', '123456', { passport: { number: 'X1234567' } });
      expect(spy).toHaveBeenCalledTimes(1);
      const passed = spy.mock.calls[0];
      expect(passed).toHaveLength(1);
      expect(String(passed[0])).not.toContain('123456');
      expect(String(passed[0])).not.toContain('X1234567');
    } finally {
      g.__DEV__ = wasDev;
      uninstall();
      spy.mockRestore();
    }
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

import { startSweep, stopSweep, formatSessionHeader, registerPublicAddress } from './logger';

describe('sweep + header', () => {
  afterEach(() => stopSweep());

  it('start/stop is idempotent', () => {
    startSweep();
    startSweep(); // no error, no second interval
    stopSweep();
    stopSweep();
  });

  it('formatSessionHeader includes platform + network', () => {
    const h = formatSessionHeader('testnet');
    expect(h).toContain('Platform:');
    expect(h).toContain('Network : testnet');
  });

  // Several reported failures are model-specific rather than OS-specific, so a
  // report that only says "ios 26.5" can't distinguish them. Pinned because the
  // line is easy to drop in a refactor and its absence is invisible until the
  // next report arrives without it.
  it('formatSessionHeader includes the device model', () => {
    expect(formatSessionHeader(null)).toContain('Device  :');
  });

  // Beta and production are separate installs with separate key stores, so the
  // same document registers under different keys in each. Without this a report
  // cannot say which app it came from.
  it('formatSessionHeader names the bundle', () => {
    expect(formatSessionHeader(null)).toContain('Bundle  :');
  });

  // A report read without these is misleading rather than merely incomplete:
  // a "vote succeeded" from a MOCK_BACKEND build means nothing.
  it('formatSessionHeader reports the build flags that change behaviour', () => {
    const h = formatSessionHeader(null);
    expect(h).toContain('MOCK_BACKEND=');
    expect(h).toContain('TD1_HEAVY_REGISTER=');
  });
});

// DPIA R5 #6 — the acceptance criterion is a manual check that a mailed error
// report carries no DG1, SOD, CAN, MRZ or long hex transcript. That check runs
// once, by hand, on a release build. These cases pin the redaction half of it
// so a later edit cannot quietly undo the result, using the shapes a real
// French passport (TD3) and ID card (TD1) actually produce.
describe('R5 leak cases', () => {
  it('redacts an MRZ that is not the whole line', () => {
    // app/passport-test.tsx logs `MRZ match n/2 - ${mrzKey}`. The prefix used
    // to defeat the whole-line rule, leaking document number, DOB and expiry.
    expect(redact('MRZ match 2/2 - P<FRADUPONT<<JEAN<<<<<<<<<<<<<<<<<<<<<<<<<<<'))
      .toBe('MRZ match 2/2 - <mrz>');
  });

  it('redacts a 3-line TD1 MRZ logged as one joined string', () => {
    const joined =
      'IDFRAX4RTBPFN64<<<<<<<<<<<<<<<9203159M3011159FRA<<<<<<<<<<<8DUPONT<<JEAN<<<<<<<<<<<<<<<<<';
    expect(redact(joined)).toBe('<mrz>');
  });

  it('redacts a labelled CAN — the CNIe access credential', () => {
    expect(redact('PACE key: can: 123456')).toBe('PACE key: can:<redacted>');
  });

  it('redacts base64 chip bytes, which the hex rules do not reach', () => {
    expect(redact('dg1=YUNQPEZSQURVUE9OVDw8SkVBTjw8PDw8PDw8PDw8PDw8'))
      .toBe('dg1:<redacted>');
  });

  it('redacts a full APDU transcript', () => {
    const apdu = '6382a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
    expect(redact(`[RX] ${apdu} (SW: 9000)`)).toBe('[RX] <hex> (SW: 9000)');
  });

  // The other half of the trade: redaction that ate real diagnostics would be
  // its own failure, so the shapes that must survive are pinned too.
  it('leaves ordinary diagnostics alone', () => {
    expect(redact('scan: started, retry 2')).toBe('scan: started, retry 2');
    expect(redact('[Step6] scanDocument called')).toBe('[Step6] scanDocument called');
    expect(redact('Z_NOIR_PASSPORT_1_256_1_6_960_248_NA registered'))
      .toBe('Z_NOIR_PASSPORT_1_256_1_6_960_248_NA registered');
    expect(redact('BUILD SUCCESSFUL in 4s')).toBe('BUILD SUCCESSFUL in 4s');
  });
});


// The redactor masked every 0x+40hex, including the contract addresses a
// failed transaction needs to name. Users hold no EOA in this app — their
// identity is a 64-hex profile key, masked by a separate rule — so blanket
// address masking bought no privacy and cost real diagnosis.
describe('contract-address allowlist', () => {
  it('keeps a configured contract address readable', () => {
    // Registration2 on Mainnet, from constants/rarime-config.ts.
    const line = redact('destination=0x11BB4B14AA6e4b836580F3DBBa741dD89423B971');
    expect(line).toContain('0x11BB4B14AA6e4b836580F3DBBa741dD89423B971');
  });

  it('still masks an address that is not a known contract', () => {
    expect(redact('to=0x1111111111111111111111111111111111111111')).toContain('<addr>');
  });

  it('matches the allowlist case-insensitively', () => {
    const addr = '0x11bb4b14aa6e4b836580f3dbba741dd89423b971';
    // Asserts the address SURVIVES, not merely that '<addr>' is absent — the
    // weaker form passed while the catch-all hex rule was masking it to <hex>.
    expect(redact(`dest=${addr}`)).toContain(addr);
  });

  it('honours an address registered at runtime', () => {
    const addr = '0x2222222222222222222222222222222222222222';
    expect(redact(`c=${addr}`)).toContain('<addr>');
    registerPublicAddress(addr);
    expect(redact(`c=${addr}`)).toContain(addr);
  });

  it('ignores a non-address passed to registerPublicAddress', () => {
    registerPublicAddress('not-an-address');
    registerPublicAddress(null);
    expect(redact('to=0x3333333333333333333333333333333333333333')).toContain('<addr>');
  });

  // The allowlist must not become a hole for the thing the redactor exists for.
  it('does not let a 64-hex profile key through', () => {
    // `sk` is now a personal label, so the label rule takes it first.
    expect(redact('sk=' + 'a'.repeat(64))).not.toContain('a'.repeat(64));
    expect(redact('key ' + 'a'.repeat(64))).toContain('<hex64>');
  });
});

// 2.0.2 item 1 (k): the label rule needed the label to be exactly one word of
// a list and the value to be one token. Compound labels, quoted values with
// spaces and nested objects went through.
describe('labelled values in any shape', () => {
  it.each([
    ['canNumber: 123456', '123456'],
    ['userCAN=123456', '123456'],
    ['{"can":"123456"}', '123456'],
    ["access_key: '123456'", '123456'],
    ['accessKey=123456', '123456'],
    ['{"data":{"can":"123456"}}', '123456'],
    ['passport: {"number":"X1234567","surname":"DUPONT"}', 'X1234567'],
    ['passport: {"number":"X1234567","surname":"DUPONT"}', 'DUPONT'],
    ['"surname":"DE LA FONTAINE"', 'FONTAINE'],
    ['document_number: X1234567', 'X1234567'],
    ['holder: { givenNames: ["JEAN", "PIERRE"] }', 'PIERRE'],
    ['dg11=QUJDREVGR0g=', 'QUJDREVGR0g'],
    ['sod: AbC+/dEf', 'AbC+/dEf'],
    ['?can=123456&next=1', '123456'],
  ])('%p loses %p', (line, secret) => {
    expect(redact(line)).not.toContain(secret);
  });

  it('keeps technical fields next to a personal label', () => {
    expect(redact('documentType: I, dg1Length: 95, isPassportFlow: true'))
      .toBe('documentType: I, dg1Length: 95, isPassportFlow: true');
    expect(redact('scanMs: 3000 scan: started')).toBe('scanMs: 3000 scan: started');
    expect(redact('passportStatus: NOT_REGISTERED')).toBe('passportStatus: NOT_REGISTERED');
  });

  it('keeps the rest of the line after a redacted value', () => {
    expect(redact('can: 123456, step: 6')).toBe('can:<redacted>, step: 6');
  });

  it('isSensitiveLabel splits words instead of matching substrings for short labels', () => {
    expect(isSensitiveLabel('can')).toBe(true);
    expect(isSensitiveLabel('userCan')).toBe(true);
    expect(isSensitiveLabel('scan')).toBe(false);
    expect(isSensitiveLabel('canceled')).toBe(false);
    expect(isSensitiveLabel('dateOfBirth')).toBe(true);
    expect(isSensitiveLabel('citizenshipWhitelist')).toBe(false);
  });
});

describe('per-install identifiers and base64', () => {
  it('masks an iOS container UUID', () => {
    expect(redact('at /var/mobile/Containers/Data/Application/1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D/cache'))
      .toBe('at /var/mobile/Containers/Data/Application/<uuid>/cache');
  });

  it('masks an Android install path', () => {
    const out = redact('dlopen failed: /data/app/~~Xy9Qk3_abc==/fr.referendumcitoyen-Zk2==/lib/arm64/x.so: not found');
    expect(out).not.toContain('Xy9Qk3');
    expect(out).toContain('/data/app/<path>');
  });

  it('masks an unlabelled base64 run', () => {
    expect(redact('bytes YUNQPEZSQURVUE9OVDw8SkVBTjw8PDw8PDw8PDw8PDw8PDw8 end')).toBe('bytes <b64> end');
  });

  it('keeps a known contract address through the base64 rule', () => {
    expect(redact('dest=0x11BB4B14AA6e4b836580F3DBBa741dD89423B971'))
      .toContain('0x11BB4B14AA6e4b836580F3DBBa741dD89423B971');
  });
});

// A registration tx hash next to the sender's address would tie them to their
// on-chain registration. These pin that nothing rides through the `tx:`
// marker.
describe('transaction hashes are masked', () => {
  const hash = '0x' + '0123456789abcdef'.repeat(4);

  it('masks a hash passed through loggableTxHash', () => {
    expect(redact(`relayer accepted ${loggableTxHash(hash)}`)).toBe('relayer accepted tx:<hex64>');
    expect(loggableTxHash(hash)).not.toContain(hash);
  });

  it('masks a hash written with the old tx: marker by hand', () => {
    expect(redact(`registerViaNoir submitted tx:${hash}`)).toBe('registerViaNoir submitted tx:<hex64>');
    expect(redact(`tx:${hash} (C_RSA_2048)`)).toBe('tx:<hex64> (C_RSA_2048)');
  });

  it('masks two hashes and a key on one line', () => {
    const other = '0x' + 'e'.repeat(64);
    const sk = 'f'.repeat(64);
    expect(redact(`tx:${hash} then tx:${other} sk=${sk}`)).not.toMatch(/[0-9a-f]{40}/);
  });

  it('still masks the same hash when it is not labelled', () => {
    expect(redact(`tx_hash=${hash}`)).toBe('tx_hash=<hex64>');
  });

  it('keeps the other labels as they were', () => {
    expect(redact('tx:' + 'a'.repeat(64))).toBe('tx:<hex64>');
    expect(redact('tx:0x' + 'a'.repeat(70))).toBe('tx:<hex>');
    expect(redact('tx:0x' + '1'.repeat(40))).toBe('tx:<addr>');
  });
});
