# Diagnostic Logging & Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-triggered error reporting flow. When the app hits an unexpected error, surface a "Envoyer un rapport d'erreur" button that opens a prefilled mail composer to `alexis+referendum@roussel-zeter.eu` with a redacted, time-windowed (5 min) log buffer attached as a `.txt`.

**Architecture:** Always-on, in-memory-only ring buffer of redacted console output (5-minute retention). No file I/O during normal operation. On error, an `ErrorReportContext` snapshots the buffer; on user tap, the snapshot is written to `${FileSystem.cacheDirectory}error-report-<ts>.txt` and shared via `expo-mail-composer` (fallback: `expo-sharing`). A root React `ErrorBoundary` catches uncaught render-tree errors. Predictable errors (passport expired, already voted, etc.) are classified via `isExpectedError()` and do **not** show the button.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript strict, `expo-file-system`, `expo-mail-composer`, `expo-sharing`, `expo-application` (already a dep), Jest with `jest-expo` preset.

**Spec:** `docs/superpowers/specs/2026-05-23-diagnostic-logging-design.md`

---

## File Structure

**Create:**
- `utils/logger.ts` — Console interception, in-memory ring buffer, redaction, snapshot. Self-installing on first import. Idempotent.
- `utils/logger.test.ts` — Unit tests for `redact()`, ring buffer eviction (by time + by count), `snapshotBuffer()`.
- `utils/error-reporter.ts` — `isExpectedError()`, `prepareErrorReport()`, `sendErrorReport()`. File I/O only here.
- `utils/error-reporter.test.ts` — Unit tests for `isExpectedError()` classification.
- `contexts/ErrorReportContext.tsx` — Provider + `useErrorReporter()` hook. Stores `pendingReport` snapshot taken at error time.
- `components/RootErrorBoundary.tsx` — React error boundary at app root; fallback UI with the report button.
- `components/ErrorReportButton.tsx` — Reusable button. Calls `useErrorReporter().sendPending()` and renders only when `pendingReport != null`.

**Modify:**
- `app/_layout.tsx` — Import logger as first line; wrap providers in `RootErrorBoundary` + `ErrorReportProvider`.
- `components/voting-modal/Step9Error.tsx` — Accept `error?: unknown`; conditionally render the report button when `!isExpectedError(error)`.
- `components/voting-modal/Step12Error.tsx` — Same treatment.
- `app/voting-flow.tsx` — Track the actual error (`Error` or string) alongside `verificationResult`/`voteErrorReason`; pass to the error components; call `reportError()` from `useErrorReporter()` when transitioning to error state.
- `constants/urls.ts` — Add `ERROR_REPORT_EMAIL`.
- `locales/fr.json`, `locales/en.json` — Add `errorReport.*` keys.
- `package.json` — Add `expo-file-system`, `expo-mail-composer`, `expo-sharing`.

**Important:** the codebase has only two locales (`fr`, `en`) per `locales/index.ts:14-25` — not seven as the spec mentioned. Touch only those two.

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npx expo install expo-file-system expo-mail-composer expo-sharing
```

Expected: three new entries in `package.json` `dependencies`, all pinned to Expo SDK 54-compatible versions (`~19.x`, `~14.x`, `~14.x` respectively at time of writing — let `expo install` pick the right one).

- [ ] **Step 2: Verify install**

Run:
```bash
node -e "console.log(require('./package.json').dependencies['expo-file-system'], require('./package.json').dependencies['expo-mail-composer'], require('./package.json').dependencies['expo-sharing'])"
```

Expected: three non-empty version strings.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add expo-file-system, expo-mail-composer, expo-sharing for error reports"
```

---

## Task 2: Redaction filter (TDD)

**Files:**
- Create: `utils/logger.ts`
- Create: `utils/logger.test.ts`

- [ ] **Step 1: Write the failing tests for `redact()`**

Create `utils/logger.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: FAIL with `Cannot find module './logger'`.

- [ ] **Step 3: Implement `redact()`**

Create `utils/logger.ts`:

```ts
// Best-effort PII redaction. Applied at insert time so the in-memory buffer
// itself never holds personally identifiable information. Not a security
// guarantee — see docs/superpowers/specs/2026-05-23-diagnostic-logging-design.md.

const PII_LABELS = [
  'passport(?:Number)?',
  'document(?:Number)?',
  'surname',
  'givenNames',
  'firstName',
  'lastName',
  'dateOfBirth',
  'dateOfExpiry',
  'nationality',
  'personalNumber',
].join('|');

const PATTERNS: Array<[RegExp, string]> = [
  // Order matters: 0x+64hex before 0x+40hex so the longer match wins.
  [/0x[a-fA-F0-9]{64}\b/g, '<hex64>'],
  [/0x[a-fA-F0-9]{40}\b/g, '<addr>'],
  [/\b[a-fA-F0-9]{64}\b/g, '<hex64>'],
  [/\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '<email>'],
  [
    new RegExp(`(?:${PII_LABELS})["']?\\s*[:=]\\s*["']?[^,}"'\\s]+`, 'g'),
    (m: string) => m.match(/^[a-zA-Z]+/)![0] + ':<redacted>',
  ] as unknown as [RegExp, string],
  [/\b\d{8,}\b/g, '<digits>'],
];

export function redact(line: string): string {
  // Whole-line MRZ: 30-44 chars of A-Z, 0-9, < only.
  if (/^[A-Z0-9<]{30,44}$/.test(line)) return '<mrz>';
  let out = line;
  for (const [re, repl] of PATTERNS) {
    out = typeof repl === 'function' ? out.replace(re, repl as any) : out.replace(re, repl);
  }
  return out;
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: PASS, all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add utils/logger.ts utils/logger.test.ts
git commit -m "feat(logger): redact PII patterns from log lines"
```

---

## Task 3: Ring buffer with time + count eviction (TDD)

**Files:**
- Modify: `utils/logger.ts`
- Modify: `utils/logger.test.ts`

- [ ] **Step 1: Append failing tests for the ring buffer**

Append to `utils/logger.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests, confirm they fail**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: FAIL with `__testing` undefined.

- [ ] **Step 3: Extend `utils/logger.ts` with the buffer**

Append to `utils/logger.ts`:

```ts
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export interface LogEntry { t: number; level: LogLevel; msg: string }

const RETENTION_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;

const buffer: LogEntry[] = [];

function evict() {
  const cutoff = Date.now() - RETENTION_MS;
  while (buffer.length > 0 && buffer[0].t < cutoff) buffer.shift();
  while (buffer.length > MAX_ENTRIES) buffer.shift();
}

function push(level: LogLevel, msg: string) {
  buffer.push({ t: Date.now(), level, msg: redact(msg) });
  evict();
}

export function snapshotBuffer(): readonly LogEntry[] {
  evict();
  return buffer.slice();
}

// Test-only hooks. Not for production import sites.
export const __testing = {
  push,
  snapshot: snapshotBuffer,
  reset: () => { buffer.length = 0; },
};
```

- [ ] **Step 4: Run tests, confirm they pass**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: PASS, all 14 tests green.

- [ ] **Step 5: Commit**

```bash
git add utils/logger.ts utils/logger.test.ts
git commit -m "feat(logger): time-windowed ring buffer with redaction at insert"
```

---

## Task 4: Console interception + format helpers (TDD)

**Files:**
- Modify: `utils/logger.ts`
- Modify: `utils/logger.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `utils/logger.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests, confirm they fail**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: FAIL — `install`, `uninstall`, `formatArgs` undefined.

- [ ] **Step 3: Implement install / uninstall / formatArgs**

Append to `utils/logger.ts`:

```ts
const LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
const originals: Partial<Record<LogLevel, (...a: unknown[]) => void>> = {};
let installed = false;

export function formatArgs(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
      try {
        return JSON.stringify(arg, circularSafeReplacer(3));
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function circularSafeReplacer(maxDepth: number) {
  const seen = new WeakSet<object>();
  const depths = new WeakMap<object, number>();
  return function (this: unknown, key: string, value: unknown) {
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    const parentDepth =
      typeof this === 'object' && this !== null && depths.has(this as object)
        ? depths.get(this as object)!
        : 0;
    const myDepth = parentDepth + 1;
    depths.set(value, myDepth);
    if (myDepth > maxDepth) return '<...>';
    return value;
  };
}

export function install(): void {
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    originals[level] = console[level].bind(console);
    (console as any)[level] = (...args: unknown[]) => {
      try {
        push(level, formatArgs(args));
      } catch {
        // Never let logging crash the app.
      }
      originals[level]!(...args);
    };
  }
}

export function uninstall(): void {
  if (!installed) return;
  installed = false;
  for (const level of LEVELS) {
    if (originals[level]) (console as any)[level] = originals[level]!;
    delete originals[level];
  }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add utils/logger.ts utils/logger.test.ts
git commit -m "feat(logger): intercept console.* into the redacted buffer"
```

---

## Task 5: Periodic sweep + session header helper

**Files:**
- Modify: `utils/logger.ts`

- [ ] **Step 1: Add `startSweep` / `stopSweep` and `formatSessionHeader`**

Append to `utils/logger.ts`:

```ts
import { Platform } from 'react-native';
import * as Application from 'expo-application';

let sweepHandle: ReturnType<typeof setInterval> | null = null;
const SWEEP_MS = 30 * 1000;

export function startSweep(): void {
  if (sweepHandle != null) return;
  sweepHandle = setInterval(() => {
    // evict() is internal; trigger it via a no-op snapshot.
    snapshotBuffer();
  }, SWEEP_MS);
}

export function stopSweep(): void {
  if (sweepHandle != null) {
    clearInterval(sweepHandle);
    sweepHandle = null;
  }
}

export function formatSessionHeader(network: string | null): string {
  const lines = [
    `App     : ${Application.nativeApplicationVersion ?? '?'} (build ${Application.nativeBuildVersion ?? '?'})`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `Locale  : ${typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : '?'}`,
    `Network : ${network ?? '?'}`,
    `Time    : ${new Date().toISOString()}`,
  ];
  return lines.join('\n');
}
```

- [ ] **Step 2: Smoke-test from the existing test file**

Append to `utils/logger.test.ts`:

```ts
import { startSweep, stopSweep, formatSessionHeader } from './logger';

describe('sweep + header', () => {
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
});
```

- [ ] **Step 3: Run tests**

Run:
```bash
npm test -- utils/logger.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add utils/logger.ts utils/logger.test.ts
git commit -m "feat(logger): periodic sweep + session header helper"
```

---

## Task 6: Wire the logger into the app entry

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Add the import + install call**

In `app/_layout.tsx`, make these two lines the very first imports (above the existing `'@/polyfills'`):

```ts
import { install as installLogger, startSweep } from '@/utils/logger';
installLogger();
startSweep();
```

So the file's top now reads:

```ts
import { install as installLogger, startSweep } from '@/utils/logger';
installLogger();
startSweep();
import '@/polyfills';
import 'react-native-reanimated';
// ...rest unchanged
```

- [ ] **Step 2: Smoke-test that the app still builds**

Run:
```bash
npm run lint
```

Expected: no new errors.

Run:
```bash
npm test
```

Expected: existing 127 tests still pass + the new logger tests.

- [ ] **Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(logger): install console interception at app entry"
```

---

## Task 7: Error classification — `isExpectedError` (TDD)

**Files:**
- Create: `utils/error-reporter.ts`
- Create: `utils/error-reporter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `utils/error-reporter.test.ts`:

```ts
import { isExpectedError } from './error-reporter';

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
```

- [ ] **Step 2: Run tests, confirm they fail**

Run:
```bash
npm test -- utils/error-reporter.test.ts
```

Expected: FAIL with `Cannot find module './error-reporter'`.

- [ ] **Step 3: Implement `isExpectedError`**

Create `utils/error-reporter.ts`:

```ts
// Errors that the app already explains to the user and that do not benefit
// from a developer report. Extend the list as new predictable failure modes
// are added — see docs/superpowers/specs/2026-05-23-diagnostic-logging-design.md.
const EXPECTED_PATTERNS: RegExp[] = [
  // NFC / e-document — strings match the translation table in
  // modules/e-document/index.ts. Case-insensitive.
  /passeport\s+expir/i,
  /passport\s+expired/i,
  /CAN\s+ou\s+MRZ/i,
  /BAC\s+failed/i,
  /aucun\s+document/i,
  /lecture\s+annul/i,
  /chip\s+not\s+detected/i,
  // Contract reverts
  /already\s+voted/i,
  /proposal\s+closed/i,
  /proposal\s+not\s+active/i,
  /nullifier\s+already\s+used/i,
  // Network
  /network\s+request\s+failed/i,
  /\boffline\b/i,
  // Cancellation
  /aborted/i,
  /AbortError/i,
  /cancell?ed/i,
];

function messageOf(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const m = (err as Record<string, unknown>).message;
    return typeof m === 'string' ? m : '';
  }
  return '';
}

export function isExpectedError(err: unknown): boolean {
  const msg = messageOf(err);
  if (!msg) return false;
  return EXPECTED_PATTERNS.some((p) => p.test(msg));
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run:
```bash
npm test -- utils/error-reporter.test.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add utils/error-reporter.ts utils/error-reporter.test.ts
git commit -m "feat(error-reporter): classify predictable vs unknown errors"
```

---

## Task 8: Add the email constant

**Files:**
- Modify: `constants/urls.ts`

- [ ] **Step 1: Append the constant**

Edit `constants/urls.ts`, replacing:

```ts
export const CONTACT_EMAIL = 'referendumcitoyen@proton.me';
```

with:

```ts
export const CONTACT_EMAIL = 'referendumcitoyen@proton.me';

// Address used for developer error reports triggered from the in-app
// "Envoyer un rapport d'erreur" button. Separate from CONTACT_EMAIL so the
// public contact alias is unaffected if we move the dev mailbox.
export const ERROR_REPORT_EMAIL = 'alexis+referendum@roussel-zeter.eu';
```

- [ ] **Step 2: Commit**

```bash
git add constants/urls.ts
git commit -m "feat(error-reporter): add ERROR_REPORT_EMAIL constant"
```

---

## Task 9: i18n keys

**Files:**
- Modify: `locales/fr.json`
- Modify: `locales/en.json`

- [ ] **Step 1: Inspect current shape**

Run:
```bash
node -e "console.log(Object.keys(require('./locales/fr.json')))"
```

Note the top-level keys (e.g. `common`, `settings`, `voting`, …).

- [ ] **Step 2: Add `errorReport` block to `locales/fr.json`**

Add a top-level `errorReport` object (alphabetical placement preferred). The exact JSON to add:

```json
"errorReport": {
  "button": "Envoyer un rapport d'erreur",
  "subject": "Rapport d'erreur",
  "body": "Bonjour,\n\nL'application a rencontré une erreur inattendue. Le fichier joint contient des informations de diagnostic anonymisées qui aideront à corriger le problème.\n\nAucune donnée personnelle (numéro de passeport, nom, clé privée, etc.) n'est incluse dans ce rapport.\n\nMerci pour votre aide.\n\n— Application Référendum Citoyen, v{{version}} (build {{build}})",
  "shareDialogTitle": "Envoyer le rapport",
  "fallbackTitle": "Une erreur est survenue",
  "fallbackMessage": "L'application a rencontré un problème inattendu. Vous pouvez envoyer un rapport pour nous aider à le corriger."
}
```

- [ ] **Step 3: Add the same block to `locales/en.json`**

```json
"errorReport": {
  "button": "Send error report",
  "subject": "Error report",
  "body": "Hello,\n\nThe app encountered an unexpected error. The attached file contains anonymised diagnostic information to help fix the issue.\n\nNo personal data (passport number, name, private key, etc.) is included in this report.\n\nThank you for your help.\n\n— Référendum Citoyen app, v{{version}} (build {{build}})",
  "shareDialogTitle": "Send the report",
  "fallbackTitle": "Something went wrong",
  "fallbackMessage": "The app encountered an unexpected problem. You can send a report to help us fix it."
}
```

- [ ] **Step 4: Smoke-test JSON validity**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('locales/fr.json','utf8')); JSON.parse(require('fs').readFileSync('locales/en.json','utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add locales/fr.json locales/en.json
git commit -m "i18n: add errorReport.* keys (fr, en)"
```

---

## Task 10: `prepareErrorReport()` + `sendErrorReport()`

**Files:**
- Modify: `utils/error-reporter.ts`

- [ ] **Step 1: Add the snapshot/write/send functions**

Append to `utils/error-reporter.ts`:

```ts
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as Application from 'expo-application';
import i18n from 'i18next';
import { snapshotBuffer, formatSessionHeader, LogEntry } from './logger';
import { ERROR_REPORT_EMAIL } from '@/constants/urls';

export interface ReportContext {
  step?: number;
  network?: string | null;
  [key: string]: unknown;
}

export interface PreparedReport {
  uri: string;
  errorMessage: string;
}

function formatError(err: unknown): string {
  if (err == null) return '<no error object>';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const stack = (err.stack ?? '').split('\n').slice(0, 30).join('\n');
    return `${err.name}: ${err.message}\n${stack}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function formatContext(ctx?: ReportContext): string {
  if (!ctx) return '<none>';
  return Object.entries(ctx)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

function formatEntries(entries: readonly LogEntry[]): string {
  return entries
    .map((e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.msg}`)
    .join('\n');
}

async function cleanupOldReports(): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    const files = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      files
        .filter((f) => f.startsWith('error-report-') && f.endsWith('.txt'))
        .map((f) => FileSystem.deleteAsync(dir + f, { idempotent: true })),
    );
  } catch {
    // best-effort cleanup
  }
}

export async function prepareErrorReport(
  error: unknown,
  context?: ReportContext,
): Promise<PreparedReport> {
  await cleanupOldReports();
  const entries = snapshotBuffer();
  const body = [
    '=== Rapport d\'erreur ===',
    formatSessionHeader(context?.network ?? null),
    '',
    '--- Error ---',
    formatError(error),
    '',
    '--- Context ---',
    formatContext(context),
    '',
    `--- Logs (last 5 minutes, ${entries.length} entries) ---`,
    formatEntries(entries),
    '',
  ].join('\n');
  const uri = `${FileSystem.cacheDirectory}error-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  await FileSystem.writeAsStringAsync(uri, body, { encoding: FileSystem.EncodingType.UTF8 });
  return { uri, errorMessage: formatError(error).split('\n')[0] };
}

export async function sendErrorReport(uri: string): Promise<void> {
  const version = Application.nativeApplicationVersion ?? '?';
  const build = Application.nativeBuildVersion ?? '?';
  const subject = i18n.t('errorReport.subject', { defaultValue: "Rapport d'erreur" });
  const body = i18n.t('errorReport.body', { version, build, defaultValue: '' });

  if (await MailComposer.isAvailableAsync()) {
    await MailComposer.composeAsync({
      recipients: [ERROR_REPORT_EMAIL],
      subject,
      body,
      attachments: [uri],
    });
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'text/plain',
    dialogTitle: i18n.t('errorReport.shareDialogTitle', { defaultValue: 'Send the report' }),
  });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no new errors. (If `expo-file-system`'s `EncodingType` type was removed in the version we just installed, switch to `'utf8'` literal — both work at runtime.)

- [ ] **Step 3: Run lint**

Run:
```bash
npm run lint
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add utils/error-reporter.ts
git commit -m "feat(error-reporter): write snapshot file + mail/share delivery"
```

---

## Task 11: `ErrorReportContext` + `useErrorReporter` hook

**Files:**
- Create: `contexts/ErrorReportContext.tsx`

- [ ] **Step 1: Create the provider**

Create `contexts/ErrorReportContext.tsx`:

```tsx
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  prepareErrorReport,
  sendErrorReport,
  isExpectedError,
  ReportContext,
  PreparedReport,
} from '@/utils/error-reporter';

interface ErrorReportContextValue {
  pendingReport: PreparedReport | null;
  reportError: (err: unknown, context?: ReportContext) => Promise<void>;
  sendPending: () => Promise<void>;
  clearReport: () => void;
  isExpected: (err: unknown) => boolean;
}

const Ctx = createContext<ErrorReportContextValue | null>(null);

export function ErrorReportProvider({ children }: { children: React.ReactNode }) {
  const [pendingReport, setPendingReport] = useState<PreparedReport | null>(null);
  const inFlight = useRef(false);

  const reportError = useCallback(async (err: unknown, context?: ReportContext) => {
    // Log the error so it ends up in the snapshot itself.
    console.error('[error-report]', err);
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const report = await prepareErrorReport(err, context);
      setPendingReport(report);
    } catch (e) {
      // Reporting must never crash the app.
      console.warn('[error-report] failed to prepare report', e);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const sendPending = useCallback(async () => {
    if (!pendingReport) return;
    try {
      await sendErrorReport(pendingReport.uri);
    } catch (e) {
      console.warn('[error-report] send failed', e);
    }
  }, [pendingReport]);

  const clearReport = useCallback(() => setPendingReport(null), []);

  const value = useMemo<ErrorReportContextValue>(
    () => ({ pendingReport, reportError, sendPending, clearReport, isExpected: isExpectedError }),
    [pendingReport, reportError, sendPending, clearReport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useErrorReporter(): ErrorReportContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useErrorReporter must be used within ErrorReportProvider');
  return v;
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add contexts/ErrorReportContext.tsx
git commit -m "feat(error-reporter): React context + useErrorReporter hook"
```

---

## Task 12: `ErrorReportButton` component

**Files:**
- Create: `components/ErrorReportButton.tsx`

- [ ] **Step 1: Create the component**

Create `components/ErrorReportButton.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { useErrorReporter } from '@/contexts/ErrorReportContext';
import { ReportContext } from '@/utils/error-reporter';

interface Props {
  error: unknown;
  context?: ReportContext;
}

export const ErrorReportButton: React.FC<Props> = ({ error, context }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const { pendingReport, reportError, sendPending, isExpected } = useErrorReporter();
  const styles = makeStyles(colors);

  if (isExpected(error)) return null;

  // First tap: prepare the report (file is written, snapshot frozen).
  // Second tap (after pendingReport != null): open the mail composer.
  const onPress = async () => {
    if (pendingReport) {
      await sendPending();
    } else {
      await reportError(error, context);
      // The provider sets pendingReport then; user will see the same button
      // change label and tap again. The double-tap pattern keeps file I/O
      // off the render path.
    }
  };

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={styles.text}>
        {pendingReport ? t('errorReport.button') : t('errorReport.button')}
      </Text>
    </Pressable>
  );
};

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    button: {
      paddingVertical: Spacing.button.paddingVertical,
      paddingHorizontal: Spacing.button.paddingHorizontal,
      borderRadius: Spacing.button.radius,
      borderWidth: 1,
      borderColor: colors.secondary,
      alignItems: 'center',
      marginTop: Spacing.section.gap,
    },
    pressed: { opacity: 0.6 },
    text: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.secondary,
    },
  });
```

> **Note:** if `Spacing.button` / `Spacing.section` keys do not exist, replace with the closest existing keys from `constants/theme.ts` and add a one-line comment. The component shouldn't introduce new design tokens.

- [ ] **Step 2: Verify theme key names**

Run:
```bash
grep -n "button:\|section:\|paddingVertical\|paddingHorizontal\|radius:" constants/theme.ts | head -20
```

Adjust the `makeStyles` block to the keys you find. If unsure, use literal values (`paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 16`) and add a `// TODO: theme tokens` comment.

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/ErrorReportButton.tsx
git commit -m "feat(error-reporter): reusable ErrorReportButton component"
```

---

## Task 13: Root `RootErrorBoundary` with fallback UI

**Files:**
- Create: `components/RootErrorBoundary.tsx`

- [ ] **Step 1: Create the boundary**

Create `components/RootErrorBoundary.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useErrorReporter } from '@/contexts/ErrorReportContext';

interface State { error: unknown }

// Inner class component must be inside the provider tree so it can use the
// context via a render-prop child.
export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    // Log so it lands in the buffer; the report itself is prepared lazily
    // when the user taps the button.
    console.error('[RootErrorBoundary]', error);
  }

  render() {
    if (this.state.error != null) {
      return <Fallback error={this.state.error} reset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function Fallback({ error, reset }: { error: unknown; reset: () => void }) {
  const { t } = useTranslation();
  const { reportError, pendingReport, sendPending } = useErrorReporter();

  React.useEffect(() => {
    // Prepare the report eagerly — the user is staring at a broken screen.
    reportError(error, { source: 'RootErrorBoundary' });
  }, [error, reportError]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('errorReport.fallbackTitle')}</Text>
      <Text style={styles.message}>{t('errorReport.fallbackMessage')}</Text>
      {pendingReport && (
        <Pressable onPress={sendPending} style={styles.button}>
          <Text style={styles.buttonText}>{t('errorReport.button')}</Text>
        </Pressable>
      )}
      <Pressable onPress={reset} style={styles.button}>
        <Text style={styles.buttonText}>{t('common.retry', { defaultValue: 'Retry' })}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  message: { fontSize: 16, textAlign: 'center' },
  button: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, borderWidth: 1 },
  buttonText: { fontSize: 16 },
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/RootErrorBoundary.tsx
git commit -m "feat(error-reporter): root React error boundary with fallback UI"
```

---

## Task 14: Wire `ErrorReportProvider` + `RootErrorBoundary` into `app/_layout.tsx`

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Add imports**

Append to the import block in `app/_layout.tsx`:

```ts
import { ErrorReportProvider } from '@/contexts/ErrorReportContext';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
```

- [ ] **Step 2: Wrap the provider tree**

Inside `RootLayout()`, change the existing tree so `ErrorReportProvider` sits at the top of the stack (above all other providers — so `useErrorReporter` is callable everywhere) and `RootErrorBoundary` wraps the children (must be **inside** the provider so its Fallback can call `useErrorReporter`):

```tsx
return (
  <SafeAreaProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorReportProvider>
        <RootErrorBoundary>
          <CustomThemeProvider>
            <DevModeProvider>
              <NetworkProvider>
                <TermsProvider>
                  <ExtraProposalsProvider>
                    <RootLayoutNav />
                  </ExtraProposalsProvider>
                </TermsProvider>
              </NetworkProvider>
            </DevModeProvider>
          </CustomThemeProvider>
        </RootErrorBoundary>
      </ErrorReportProvider>
    </GestureHandlerRootView>
  </SafeAreaProvider>
);
```

- [ ] **Step 3: Smoke-test build**

Run:
```bash
npm run lint && npm test
```

Expected: no new lint errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(error-reporter): wire provider + boundary into app root"
```

---

## Task 15: Wire `Step9Error` to show the report button

**Files:**
- Modify: `components/voting-modal/Step9Error.tsx`
- Modify: `app/voting-flow.tsx`

- [ ] **Step 1: Extend `Step9Error` props**

Edit `components/voting-modal/Step9Error.tsx`:

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { ErrorReportButton } from '@/components/ErrorReportButton';

interface Step9ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  isPassportFlow?: boolean;
  error?: unknown;
}

const Step9Error: React.FC<Step9ErrorProps> = ({ containerWidth, onGoHome, onLayout, isPassportFlow = false, error }) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step9ErrorContainer}>
        <View style={stepSpecificStyles.step9ErrorContent}>
          <Text style={stepSpecificStyles.step9ErrorTitle}>
            {t('voting.step9ErrorTitle')}
          </Text>

          <Text style={stepSpecificStyles.step9ErrorDescription}>
            {t(`voting.step9ErrorDescription_${docSfx}`)}
          </Text>

          <LottieView
            source={require('@/assets/animations/error.json')}
            style={stepSpecificStyles.step9ErrorAnimation}
            autoPlay
            loop={false}
          />

          {error != null && <ErrorReportButton error={error} context={{ step: 9, isPassportFlow }} />}
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step9ErrorButton}
          activeOpacity={0.8}
          onPress={onGoHome || (() => console.log('Go home'))}
        >
          <Text style={stepSpecificStyles.step9ErrorButtonText}>{t('common.backToHome')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step9Error;
```

- [ ] **Step 2: Capture and pass the error in `app/voting-flow.tsx`**

In `app/voting-flow.tsx`, near line 53 next to `verificationResult`, add:

```ts
const [verificationError, setVerificationError] = useState<unknown>(null);
```

Extend the `handleVerificationError` callback (currently line 454) to take an optional `error: unknown` parameter and store it:

```ts
const handleVerificationError = useCallback((_message?: string, fatal?: boolean, error?: unknown) => {
  if (fatal) return;
  setVerificationError(error ?? new Error(_message ?? 'Unknown verification error'));
  setVerificationResult('error');
  setTimeout(() => handleNext(), 1500);
}, [handleNext]);
```

Find the call site at line 623 (`onError={handleVerificationError}`). The caller is `Step7` — read it to find where it calls `onError(...)`:

```bash
grep -n "onError" components/voting-modal/Step7*.tsx
```

For each `onError(message)` call there, change it to `onError(message, false, caughtErr)` where `caughtErr` is the variable from the surrounding `catch (caughtErr)`. If the catch block doesn't declare a variable today (e.g. `catch {}`), name it `catch (caughtErr)` and pass it through.

Reset `verificationError` to `null` wherever `setVerificationResult(null)` is called (line ~257):

```ts
setVerificationResult(null);
setVerificationError(null);
```

Wire the new prop in the `<Step9Error ... />` use site (line ~694):

```tsx
{verificationResult === 'error' && (
  <Step9Error
    containerWidth={containerWidth}
    onGoHome={handleClose}
    isPassportFlow={isPassportFlow}
    error={verificationError}
  />
)}
```

- [ ] **Step 3: Smoke-test**

Run:
```bash
npm run lint && npm test
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/voting-modal/Step9Error.tsx app/voting-flow.tsx
git commit -m "feat(error-reporter): show report button on Step9Error for unexpected errors"
```

---

## Task 16: Wire `Step12Error` to show the report button

**Files:**
- Modify: `components/voting-modal/Step12Error.tsx`
- Modify: `app/voting-flow.tsx`

- [ ] **Step 1: Extend `Step12Error` props**

Edit `components/voting-modal/Step12Error.tsx`:

```tsx
import { ErrorReportButton } from '@/components/ErrorReportButton';

interface Step12ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  errorReason?: string | null;
  error?: unknown;
}

// ...inside the component, after the LottieView:
{error != null && <ErrorReportButton error={error} context={{ step: 12, reason: errorReason ?? null }} />}
```

(Add `error` to the destructured prop list.)

- [ ] **Step 2: Capture and pass the error in `app/voting-flow.tsx`**

Around line 529 there is `const [voteErrorReason, setVoteErrorReason] = useState<string | null>(null);`. Add a sibling:

```ts
const [voteError, setVoteError] = useState<unknown>(null);
```

Extend `handleStep11Error` (line 530) to take an optional error and store it:

```ts
const handleStep11Error = useCallback((reason?: string, error?: unknown) => {
  setVoteErrorReason(reason || null);
  setVoteError(error ?? new Error(reason ?? 'Unknown vote error'));
  setVoteSubmissionResult('error');
  // ...rest unchanged
}, [...]);
```

Find every caller of `handleStep11Error` (likely in Step11 / the vote submission handler) and update it to pass the caught error as the second argument. Use:

```bash
grep -n "handleStep11Error\|onError" app/voting-flow.tsx components/voting-modal/Step11*.tsx utils/mainnet-vote-flow.ts
```

Reset `voteError` to `null` wherever `setVoteErrorReason(null)` is called.

Wire the prop on the `<Step12Error ... />` use site (line ~684):

```tsx
<Step12Error
  key="s12e"
  containerWidth={containerWidth}
  onGoHome={handleClose}
  errorReason={voteErrorReason}
  error={voteError}
/>
```

Reset `voteError` to `null` wherever `setVoteErrorReason(null)` is called.

- [ ] **Step 3: Smoke-test**

Run:
```bash
npm run lint && npm test
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/voting-modal/Step12Error.tsx app/voting-flow.tsx
git commit -m "feat(error-reporter): show report button on Step12Error for unexpected errors"
```

---

## Task 17: Manual end-to-end verification

**Files:** none modified — observation only.

- [ ] **Step 1: Inject a synthetic unexpected error**

Temporarily edit `app/voting-flow.tsx` in the vote-submission handler to throw before contract interaction:

```ts
throw new Error('synthetic unexpected error for report test');
```

- [ ] **Step 2: Launch the app**

Run:
```bash
npm start
```

Then run on a device or emulator (`i` for iOS, `a` for Android). Walk through the voting flow until the synthetic throw fires.

- [ ] **Step 3: Verify the button is shown**

Expected: Step12Error screen shows the existing message + "Envoyer un rapport d'erreur" button below.

- [ ] **Step 4: Tap the button, then tap again**

Expected: first tap prepares the report (no visible change other than the button becoming "active"); second tap opens the OS mail composer with:
- To: `alexis+referendum@roussel-zeter.eu`
- Subject: `Rapport d'erreur`
- Body: the French template with version + build substituted
- Attachment: `error-report-<ts>.txt`

- [ ] **Step 5: Open the attachment and grep for PII**

Save the .txt locally. From a terminal:

```bash
grep -E '(\b[a-fA-F0-9]{64}\b|0x[a-fA-F0-9]{40}|^[A-Z0-9<]{30,44}$|[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,})' error-report-*.txt
```

Expected: no matches. (Or only `<email>` / `<hex64>` / `<addr>` / `<mrz>` placeholders. The recipient address in the email body is not in the attachment.)

- [ ] **Step 6: Test the expected-error path**

Replace the synthetic throw with:

```ts
throw new Error('already voted');
```

Walk to Step12Error again. Expected: button is **not** rendered.

- [ ] **Step 7: Test the no-mail-client fallback (Android emulator)**

On an Android emulator with no mail client installed, tap the button. Expected: the OS share sheet appears with the .txt attached; user can pick Drive / Messages / etc.

- [ ] **Step 8: Remove the synthetic throws**

Revert `app/voting-flow.tsx` to its pre-test state. Verify with:

```bash
git diff app/voting-flow.tsx
```

Expected: only the legitimate `setVoteError` / `setVerificationError` wiring, no synthetic throws.

- [ ] **Step 9: Commit nothing**

This task is verification only — no code commit at the end.

---

## Task 18: Final sanity sweep

**Files:** none modified.

- [ ] **Step 1: Run full test suite**

Run:
```bash
npm test
```

Expected: 127 baseline + new logger tests + new error-reporter tests all green.

- [ ] **Step 2: Run lint**

Run:
```bash
npm run lint
```

Expected: 0 errors. (Warnings from pre-existing `any` / `console.log` are acceptable.)

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Confirm the branch state**

Run:
```bash
git log --oneline develop..HEAD
```

Expected: a clean chain of feat/chore/i18n commits from Task 1 through Task 16, all on `feat/logs` (or whichever branch you started on).

- [ ] **Step 5: Open a PR**

Use the `gh pr create` workflow described in the repo's instructions. Title:

```
feat: in-app error reporting with redacted log attachment
```

Body should reference the spec at `docs/superpowers/specs/2026-05-23-diagnostic-logging-design.md`.

---

## Notes for the implementer

- **Order matters.** The redaction filter in Task 2 is the foundation: if it has gaps, every subsequent task ships those gaps to disk. Take the time to add patterns if you spot a leak during manual testing in Task 17.
- **Double-tap UX.** The two-tap pattern in `ErrorReportButton` (first tap prepares, second tap sends) is deliberate to keep file I/O off the render path. If product feedback wants single-tap, move `prepareErrorReport` into a `useEffect` that fires when the error component mounts (eagerly prepares) and have the button only call `sendPending`. The `RootErrorBoundary` Fallback already uses this eager pattern.
- **The Step9 / Step12 distinction.** Step9 covers registration / NFC failures (no `errorReason` shown today); Step12 covers vote-submission failures (has `errorReason`). Both need the report button. Treat them symmetrically.
- **Don't touch `modules/e-document/index.ts`.** Its existing French translation table determines what reaches Step9 as a string. Those strings are matched by `isExpectedError` patterns. Adding to the translation table without updating `EXPECTED_PATTERNS` will quietly start surfacing the button on previously-suppressed errors — that's a *safe* drift, but worth flagging.
- **Locales:** spec mentioned seven locales; the codebase ships two (`fr`, `en`). The plan reflects the actual codebase.
