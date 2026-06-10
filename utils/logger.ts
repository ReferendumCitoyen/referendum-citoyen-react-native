import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { getAppVersion } from './appVersion';

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
  // `birthDate` covers the JSX prop name used by Step5 / Step7;
  // `dateOfBirth` covers the SDK / ICAO field name.
  'birthDate',
  'expiryDate',
  'nationality',
  // `citizenship` is the 3-letter country code (FRA, CHE, …). 3 chars
  // bypasses the digit-length filter; pattern-match the label so it
  // never lands in the ring buffer regardless of the call site.
  // `issuingCountry` covers the MRZ field name; `citizenshipMask`
  // covers the Step11 hex-encoded form. All three are belt-and-braces
  // — the call sites that emit them are now also __DEV__-gated.
  'citizenship(?:Mask)?',
  'issuingCountry',
  'personalNumber',
].join('|');

const PATTERNS: Array<[RegExp, string]> = [
  // Order matters: 0x+64hex before 0x+40hex so the longer match wins.
  [/0x[a-fA-F0-9]{64}\b/g, '<hex64>'],
  [/0x[a-fA-F0-9]{40}\b/g, '<addr>'],
  [/\b[a-fA-F0-9]{64}\b/g, '<hex64>'],
  [/\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '<email>'],
  [
    new RegExp(`((?:${PII_LABELS}))(['"]?)\\s*[:=]\\s*(?:['"])?[^,}"'\\s]+`, 'g'),
    (_m: string, label: string, closingQuote: string) => label + closingQuote + ':<redacted>',
  ] as unknown as [RegExp, string],
  [/\b\d{8,}\b/g, '<digits>'],
  // Catch-all for any remaining hex run >=32 chars. The `\b…{64}\b` patterns
  // above only match when a word boundary sits exactly at the 64-char mark, so
  // a continuous blob longer than that (e.g. a full APDU TX/RX transcript)
  // slips through. Ordered last so the more specific <hex64>/<addr>/<digits>
  // labels win wherever they apply; anything left over is masked to <hex>.
  [/(?:0x)?[a-fA-F0-9]{32,}/g, '<hex>'],
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
    // Use getAppVersion() so the running OTA patch is included (e.g. "1.0.4"),
    // not just the baked-in native version. Native build number is kept as a
    // tiebreaker — two OTAs with the same patch could ship on different binaries.
    `App     : ${getAppVersion()} (build ${Application.nativeBuildVersion ?? '?'})`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `Locale  : ${typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : '?'}`,
    `Network : ${network ?? '?'}`,
    `Time    : ${new Date().toISOString()}`,
  ];
  return lines.join('\n');
}
