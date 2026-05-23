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
