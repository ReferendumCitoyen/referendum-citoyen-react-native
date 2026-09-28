/**
 * No fragment of a document identifier, and no run of chip bytes, may reach an
 * error report (wave 4a item 1, wave 4b M1bis and C2).
 *
 * Two leaks motivated this file, and they leaked for the same structural
 * reason: the redactor works on labelled values and on long opaque runs, so a
 * SHORT slice of something sensitive, or a long one broken up by commas, walks
 * straight through it.
 *
 *   1. `Passport <12 hex>… not in DB` and `passport <8 hex>…` in a console
 *      warning. Twelve hex characters are below every length threshold the
 *      redactor uses, and `passportHash` is the StateKeeper lookup key: a
 *      report sent from the voter's own address tied that address to an
 *      on-chain registration meant to be pseudonymous.
 *   2. The SDK patch's `dg1 first16=[80,60,70,…]`. The label glued to the `=`
 *      is `first16`, not `dg1`, and one-to-three-digit bytes separated by
 *      commas match neither the digit rule nor the hex and base64 rules.
 *
 * Both are fixed at the source: no document identifier is built into a message
 * at all, and the SDK line logs a length. The redactor is hardened behind them
 * so the NEXT line of that shape is caught rather than shipped, which is what
 * these tests pin. An Error's text reaches the emailed report through
 * `formatError` AND, in release, the system log (utils/logger.ts), so a miss
 * here is two leaks, not one.
 */
import fs from 'fs';
import path from 'path';
import { formatError, formatContext } from '@/utils/error-reporter';
import { isSensitiveLabel, redact } from '@/utils/logger';

jest.mock('expo-file-system', () => ({}), { virtual: true });
jest.mock('expo-mail-composer', () => ({}), { virtual: true });

/** A real-shaped SHA-256, and the prefixes the old messages carried. */
const PASSPORT_HASH = 'a3f91c4e77bd0215'.repeat(4);
const PREFIX_12 = PASSPORT_HASH.slice(0, 12);
const PREFIX_8 = PASSPORT_HASH.slice(0, 8);

/**
 * The mechanical half: no source line outside a `__DEV__` guard may splice a
 * slice of a document hash into a string. This is what actually failed before
 * the fix, at utils/passport-key-db.ts:249,415,460 and utils/identity.ts:260,331.
 */
describe('no source line splices a document hash into a message', () => {
  const ROOT = path.resolve(__dirname, '..');
  const DIRS = ['utils', 'app', 'components', 'hooks', 'contexts', 'constants'];
  // The values that identify a document or its holder on chain. A build
  // commit hash or a vote-result array is not one of them.
  const IDENTIFYING = [
    'passportHash', 'documentHash', 'docHash', 'dgCommit', 'identityKey',
    'personKey', 'nullifier', 'privateKey', 'secretKey', 'skIdentity',
    'docNumber', 'documentNumber', 'mrzKey',
  ];
  const SLICE_RE = new RegExp(
    `\\b(?:${IDENTIFYING.join('|')})\\b[^\\n;]{0,40}\\.slice\\(\\s*0\\s*,`,
  );

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it('finds none, except the one that is behind __DEV__ and says why', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of walk(full)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!SLICE_RE.test(line)) return;
          // The one allowed site: app/voting-flow.tsx logs the pair under
          // __DEV__ and documents exactly why (a stable per-user fingerprint
          // in logcat). Anything else is a leak into the emailed report.
          const window = lines.slice(Math.max(0, i - 8), i).join('\n');
          if (window.includes('__DEV__')) return;
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no document identifier is ever built into a message', () => {
  // The three throw sites of utils/passport-key-db.ts and the two console
  // warnings of utils/identity.ts, as they now read.
  const MESSAGES = [
    'Document already in DB (entry count 2)',
    'Document not in DB (entry count 2)',
    '[identity] stored BJJ sk (stored entry) is >= 2^253 — vote circuit will assert.',
    '[identity] stored BJJ sk (inherited from the passport entry) is >= 2^253',
  ];

  it.each(MESSAGES)('carries no hash fragment: %s', (message) => {
    const reported = formatError(new Error(message));
    expect(reported).not.toContain(PREFIX_8);
    expect(reported).not.toContain(PREFIX_12);
    expect(reported).not.toMatch(/[a-fA-F0-9]{8,}/);
  });

  it('still says enough to diagnose: the store and the row count survive', () => {
    const reported = formatError(new Error('Document not in DB (entry count 2)'));
    expect(reported).toContain('not in DB');
    expect(reported).toContain('entry count 2');
  });
});

describe('a hash fragment that did get into a message is masked anyway', () => {
  // Defence in depth: the source is fixed, but a future caller may build one.
  it('masks a labelled short prefix', () => {
    expect(redact(`passportHash=${PREFIX_12}`)).not.toContain(PREFIX_12);
    expect(redact(`passport_hash: ${PREFIX_8}`)).not.toContain(PREFIX_8);
  });

  it('knows that a document label is sensitive whatever its spelling', () => {
    for (const label of ['passportHash', 'documentNumber', 'docNumber', 'expirationDate']) {
      expect(isSensitiveLabel(label)).toBe(true);
    }
  });

  it('keeps a full-length hash masked, as it always did', () => {
    expect(formatError(new Error(`at ${PASSPORT_HASH}`))).not.toContain(PASSPORT_HASH);
  });
});

describe('chip bytes cannot reach a report through a prefix label', () => {
  // The exact line the SDK patch used to emit, byte values included.
  const DG1_BYTES = [80, 60, 70, 82, 65, 68, 85, 80, 79, 78, 84, 60, 60, 74, 69, 65];
  const OLD_SDK_LINE = `[SDK][REG][PROOF] dg1 first16=[${DG1_BYTES.join(',')}] sk_len=64`;

  it('masks the labelled slice', () => {
    const out = redact(OLD_SDK_LINE);
    expect(out).not.toContain(DG1_BYTES.join(','));
  });

  it('masks a byte run whatever it is labelled, or not labelled at all', () => {
    for (const line of [
      `dump [${DG1_BYTES.join(',')}]`,
      `${DG1_BYTES.join(', ')}`,
      `head=[${DG1_BYTES.slice(0, 8).join(',')}]`,
    ]) {
      expect(redact(line)).not.toContain(DG1_BYTES.slice(0, 8).join(','));
    }
  });

  it('leaves short number lists alone: a byte run is eight or more', () => {
    expect(redact('sizes 1, 2, 3')).toContain('1, 2, 3');
  });

  it('closes the same door on the report side', () => {
    expect(formatError(new Error(OLD_SDK_LINE))).not.toContain(DG1_BYTES.join(','));
  });
});

describe('the report context allow-list holds the line too', () => {
  it('drops a document identifier handed to it as context', () => {
    const out = formatContext({
      passportHash: PASSPORT_HASH,
      docNumber: '210ABC12345',
    } as never);
    expect(out).not.toContain(PASSPORT_HASH);
    expect(out).not.toContain(PREFIX_12);
    expect(out).not.toContain('210ABC12345');
  });
});
