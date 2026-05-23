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
