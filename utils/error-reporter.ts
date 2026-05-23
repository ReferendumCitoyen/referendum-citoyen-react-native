import * as FileSystem from 'expo-file-system/legacy';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as Application from 'expo-application';
import i18n from 'i18next';
import { snapshotBuffer, formatSessionHeader, LogEntry, redact } from './logger';
import { ERROR_REPORT_EMAIL } from '@/constants/urls';

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

export interface ReportContext {
  step?: number;
  network?: string | null;
  [key: string]: unknown;
}

export interface PreparedReport {
  uri: string;
  errorMessage: string;
}

// Per-line redaction so stack traces and multi-line messages have every
// line scrubbed, not just the first. The buffer entries already arrive
// redacted via the console interceptor, but the error/context blocks below
// come straight from the caller and MUST be filtered before write.
function redactMultiline(s: string): string {
  return s.split('\n').map(redact).join('\n');
}

export function formatError(err: unknown): string {
  if (err == null) return '<no error object>';
  if (typeof err === 'string') return redactMultiline(err);
  if (err instanceof Error) {
    const stack = (err.stack ?? '').split('\n').slice(0, 30).join('\n');
    return redactMultiline(`${err.name}: ${err.message}\n${stack}`);
  }
  try {
    return redactMultiline(JSON.stringify(err));
  } catch {
    return redactMultiline(String(err));
  }
}

export function formatContext(ctx?: ReportContext): string {
  if (!ctx) return '<none>';
  return Object.entries(ctx)
    .map(([k, v]) => `${k}: ${redact(typeof v === 'string' ? v : JSON.stringify(v))}`)
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
