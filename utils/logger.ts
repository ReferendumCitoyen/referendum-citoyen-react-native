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
    new RegExp(`((?:${PII_LABELS}))(['"]?)\\s*[:=]\\s*(?:['"])?[^,}"'\\s]+`, 'g'),
    (_m: string, label: string, closingQuote: string) => label + closingQuote + ':<redacted>',
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
