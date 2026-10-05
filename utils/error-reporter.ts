import * as FileSystem from 'expo-file-system/legacy';
import { isBetaBuild } from '@/constants/app-flavour';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as Application from 'expo-application';
import i18n from 'i18next';
import {
  snapshotBuffer,
  formatSessionHeader,
  appFlavourLabel,
  platformLabel,
  LogEntry,
  redact,
  LOG_RETENTION_MINUTES,
  formatEntriesRelative,
  minuteStamp,
  currentPurgeGeneration,
  onVoteTracePurged,
  readPreviousSessionLog,
  clearPreviousSessionLog,
  sanitizeTailForReport,
} from './logger';
import { ERROR_REPORT_EMAIL } from '@/constants/urls';
import { documentOfLastVote, formatArtifactsJson, hasArtifacts } from '@/utils/vote-artifacts';
import { confirmReportConsent, notifyReportExpired } from '@/utils/report-consent';

// Errors that the app already explains to the user and that do not benefit
// from a developer report. Extend the list as new predictable failure modes
// are added.
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
  // The same state, now also refused on Step 7 before the proof instead of only
  // on Step 11 after it. What reaches the reporter there is the French sentence
  // the user read, which the English pattern above never matches. Deliberately
  // narrow: the second-document refusal next to it ("un seul document par
  // personne") is new logic, and we DO want a report if it ever fires on
  // someone it should not have.
  /déjà\s+voté\s+sur\s+cette\s+question/i,
  // Bound to another key after the one re-read (dossier 2.0.2, item 14 e):
  // the app already says what to do, and the restart button is the next step.
  /\[REGISTERED_WITH_OTHER_KEY\]/,
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

export type ReportKind = 'error' | 'success';

export interface PreparedReport {
  /** The main text report. Always the first attachment. */
  uri: string;
  errorMessage: string;
  /** Every file to attach: the text report, plus the unredacted vote
   *  artifacts JSON when a registration or vote happened this session. */
  attachments: string[];
  kind: ReportKind;
  /** The vote-trace purge generation the report was built under
   *  (utils/logger.ts). A report older than the last purge may hold the
   *  purged vote lines and is never sent. Absent on the legacy string form. */
  generation?: number;
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

/**
 * The context fields a report may carry: technical, named here one by one.
 *
 * An allow-list, not a filter: redacting the VALUE alone, with the field name
 * prefixed afterwards, would hide `can: 123456` from the label rules. A field that is not on this list is not
 * written at all, whatever it holds; a value that is not a plain string,
 * number or boolean is not written either. `proposalId` is deliberately
 * absent: on the success screen it names the question just voted, next to
 * the sender's address (item 1 f).
 */
const CONTEXT_ALLOW_LIST = new Set([
  'step',
  'network',
  'source',
  'isPassportFlow',
  'docType',
  'platform',
  'reason',
]);
const CONTEXT_VALUE_MAX = 300;

export function formatContext(ctx?: ReportContext): string {
  if (!ctx) return '<none>';
  const lines: string[] = [];
  let omitted = 0;
  for (const [k, v] of Object.entries(ctx)) {
    if (!CONTEXT_ALLOW_LIST.has(k)) {
      omitted++;
      continue;
    }
    if (v === null || v === undefined) {
      lines.push(`${k}: ${String(v)}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${String(v)}`);
    } else if (typeof v === 'string') {
      // Redacted as the whole `key: value` line, so a label rule sees both.
      lines.push(redactMultiline(`${k}: ${v.slice(0, CONTEXT_VALUE_MAX)}`));
    } else {
      omitted++;
    }
  }
  if (omitted > 0) lines.push(`(${omitted} other field${omitted > 1 ? 's' : ''} not included)`);
  return lines.length > 0 ? lines.join('\n') : '<none>';
}

function formatEntries(entries: readonly LogEntry[]): string {
  return formatEntriesRelative(entries);
}

/** One line at the end of every report file (item 1 g). The mail body says
 *  the same (errorReport.body). */
const REPORT_FOOTER =
  "--- Note ---\nCe rapport contient des informations techniques sur le téléphone " +
  "(modèle, système, mémoire et espace libre arrondis) et le déroulement de l'application, " +
  "sans la carte, le CAN ni le vote. Le message et l'adresse de l'expéditeur sont " +
  'supprimés après traitement.';

/**
 * File-name stamp: to the hour, like the header (2026-09-22T10Z).
 *
 * The attachment name travels with the mail, so leaving the minute here would
 * have handed back exactly what the header stopped carrying.
 */
function fileStamp(): string {
  return minuteStamp().replace(/:/g, '-');
}

/**
 * Free disk space, as its own line because it can't live in the (synchronous)
 * session header.
 *
 * Storage exhaustion is a whole failure class here — the trusted setup and the
 * query zkey together pull down the better part of a gigabyte, and
 * `isStorageFullError` exists precisely because ENOSPC and witnesscalc OOM
 * arrive disguised as unrelated errors. One number settles it instead of
 * asking the tester to check their phone.
 *
 * Banded above 10 GB, and the June parity review (D-1, 22/09) is why. June
 * carried no disk line at all, so every value here is data June never sent.
 * A figure to the GB over a 0 to 512 GB range is ~500 distinguishable values
 * that drift slowly: next to Device, Memory and Platform it linked two reports
 * from the same phone, which is exactly the re-identification this release is
 * meant to close. The diagnosis needs none of that precision, it needs to know
 * whether the download can land. So the range that decides that question stays
 * exact (0 to 10 GB, where ENOSPC and the OOM actually bite) and everything
 * above it collapses to four bands.
 *
 * Rounding below 10 GB is a floor, not a round-to-nearest: 9.7 GB reads
 * "9 GB free" rather than colliding with the "10-20 GB free" band, and a
 * report never claims more room than the phone had.
 */
export function freeDiskBand(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'unavailable';
  const gb = bytes / 1e9;
  if (gb < 0.5) return '0 GB free';
  if (gb < 10) return `${Math.max(1, Math.floor(gb))} GB free`;
  if (gb < 20) return '10-20 GB free';
  if (gb < 50) return '20-50 GB free';
  if (gb < 100) return '50-100 GB free';
  return '100+ GB free';
}

async function formatFreeDisk(): Promise<string> {
  try {
    return freeDiskBand(await FileSystem.getFreeDiskStorageAsync());
  } catch {
    return 'unavailable';
  }
}

async function cleanupOldReports(): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    const files = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      files
        .filter(
          (f) =>
            (f.startsWith('error-report-') || f.startsWith('vote-report-') || f.startsWith('vote-artifacts-')) &&
            (f.endsWith('.txt') || f.endsWith('.json')),
        )
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
  const generation = currentPurgeGeneration();
  const entries = snapshotBuffer();
  const freeDisk = await formatFreeDisk();
  const body = [
    '=== Rapport d\'erreur ===',
    formatSessionHeader(context?.network ?? null),
    `Disk    : ${freeDisk}`,
    '',
    '--- Error ---',
    formatError(error),
    '',
    '--- Context ---',
    formatContext(context),
    '',
    `--- Logs (last ${LOG_RETENTION_MINUTES} minutes, ${entries.length} entries) ---`,
    formatEntries(entries),
    '',
    REPORT_FOOTER,
    '',
  ].join('\n');
  const stamp = fileStamp();
  const uri = `${FileSystem.cacheDirectory}error-report-${stamp}.txt`;
  await FileSystem.writeAsStringAsync(uri, body, { encoding: FileSystem.EncodingType.UTF8 });
  // A failure AFTER a proof was generated — the chain refused it, say — is
  // exactly when the circuit author needs to see that proof. Attach it when
  // there is one (beta only); the body above stays redacted as before.
  const attachments = [uri, ...(await writeArtifactsAttachment(stamp))];
  return { uri, errorMessage: formatError(error).split('\n')[0], attachments, kind: 'error', generation };
}

/**
 * The report for a vote that WORKED. Same session log as the error report,
 * plus the unredacted registration and vote artifacts as a JSON attachment.
 *
 * Why this exists: a successful vote used to leave no trace anyone could
 * send — the log recorded sizes, the values were never written anywhere, and
 * only failures had a button — and the circuit author needs the working case
 * most of all.
 * The email body says what the attachment holds, and does not call it
 * anonymised, because the whole point is that it is not.
 */
export async function prepareSuccessReport(context?: ReportContext): Promise<PreparedReport> {
  await cleanupOldReports();
  const generation = currentPurgeGeneration();
  const entries = snapshotBuffer();
  const freeDisk = await formatFreeDisk();
  const body = [
    '=== Rapport de vote réussi ===',
    formatSessionHeader(context?.network ?? null),
    `Disk    : ${freeDisk}`,
    '',
    '--- Context ---',
    formatContext(context),
    '',
    hasArtifacts()
      ? '--- Artefacts ---\nPreuve de vote, signaux publics et paramètres d\'enregistrement : voir la pièce jointe JSON (non anonymisée).'
      : '--- Artefacts ---\n(aucune preuve enregistrée dans cette session)',
    '',
    `--- Logs (last ${LOG_RETENTION_MINUTES} minutes, ${entries.length} entries) ---`,
    formatEntries(entries),
    '',
    REPORT_FOOTER,
    '',
  ].join('\n');
  const stamp = fileStamp();
  const uri = `${FileSystem.cacheDirectory}vote-report-${stamp}.txt`;
  await FileSystem.writeAsStringAsync(uri, body, { encoding: FileSystem.EncodingType.UTF8 });
  const attachments = [uri, ...(await writeArtifactsAttachment(stamp))];
  return { uri, errorMessage: '', attachments, kind: 'success', generation };
}

/**
 * A report built from a PREVIOUS session's log tail, recovered off disk.
 *
 * Used when the app closed on someone mid-flow: the in-memory buffer went with
 * it, but utils/logger.ts had been mirroring the tail every few seconds, so the
 * last minutes survive. There is no error object to attach and no artifacts —
 * the store is memory too — so this is the log and a header saying where it
 * came from.
 *
 * `tail` is normally the text readPreviousSessionLog returns, already through
 * sanitizeTailForReport (vote flows removed, offsets, redaction). It is put
 * through that pass again here when it arrives raw, and redacted once more
 * line by line, so a caller that hands in raw text cannot bypass either:
 * before 2.0.2 this function pasted the file verbatim, kept hashes and clock
 * times included.
 *
 * Redaction alone was not enough for the clock times, which is what the June
 * parity review found (D-1, 22/09): redactMultiline scrubs hashes, labels and
 * addresses, but an absolute `2026-09-21T07:58:10.101Z` is none of those, so a
 * raw tail kept exactly the field that lets a report be lined up against an
 * on-chain event. Only sanitizeTailForReport turns those into offsets.
 */
function sanitizedTail(rawTail: string): string {
  // Idempotent: an already-sanitised tail is in `+MM:SS.mmm` form, which
  // sanitizeTailForReport does not parse, so it must not be run twice.
  if (/^\+\d{2,}:\d{2}\.\d{3} /m.test(rawTail)) return rawTail;
  return sanitizeTailForReport(rawTail) ?? '';
}

export async function prepareRecoveredSessionReport(rawTail: string): Promise<PreparedReport> {
  await cleanupOldReports();
  const generation = currentPurgeGeneration();
  const tail = redactMultiline(sanitizedTail(rawTail));
  const body = [
    "=== Rapport d'erreur (session précédente) ===",
    formatSessionHeader(null),
    '',
    '--- Context ---',
    "Journal récupéré après une fermeture inattendue de l'application. " +
      "Les lignes ci-dessous sont les dernières écrites avant l'arrêt ; " +
      "l'erreur elle-même n'a pas pu être capturée.",
    '',
    '--- Logs (previous session) ---',
    tail,
    '',
    REPORT_FOOTER,
    '',
  ].join('\n');
  const stamp = fileStamp();
  const uri = `${FileSystem.cacheDirectory}error-report-${stamp}.txt`;
  await FileSystem.writeAsStringAsync(uri, body, { encoding: FileSystem.EncodingType.UTF8 });
  return { uri, errorMessage: 'previous session', attachments: [uri], kind: 'error', generation };
}

/** The JSON attachment, or nothing when this session made no proof. Written
 *  straight from the artifact store — NOT through the redactor, which is why
 *  it exists on the beta app only: approved for test volunteers on test
 *  scrutins, never for a voter. */
async function writeArtifactsAttachment(stamp: string): Promise<string[]> {
  if (!isBetaBuild() || !hasArtifacts()) return [];
  try {
    const uri = `${FileSystem.cacheDirectory}vote-artifacts-${stamp}.json`;
    await FileSystem.writeAsStringAsync(uri, formatArtifactsJson(), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return [uri];
  } catch (e: any) {
    console.warn('[error-report] could not write the artifacts attachment:', e?.message ?? e);
    return [];
  }
}

/**
 * Subject and body for a report, by kind. Exported for the test: the success
 * subject has to name the document and must never reuse the error body, which
 * says the report holds no card, CAN or vote: the beta success attachment
 * holds the vote proof on purpose.
 */
export function reportEnvelope(kind: ReportKind, version: string, build: string): { subject: string; body: string } {
  const flavour = appFlavourLabel();
  const platform = platformLabel();
  if (kind === 'success') {
    const doc = documentOfLastVote();
    const docLabel =
      doc === 'passport'
        ? i18n.t('errorReport.successDocument_passport', { defaultValue: 'passeport' })
        : doc === 'idCard'
          ? i18n.t('errorReport.successDocument_idCard', { defaultValue: "carte d'identité" })
          : i18n.t('errorReport.successDocument_unknown', { defaultValue: 'document' });
    const base = i18n.t('errorReport.successSubject', { defaultValue: 'Vote réussi' });
    return {
      subject: `[${flavour}][${platform}] ${base} — ${docLabel} — v${version} (build ${build})`,
      body: i18n.t('errorReport.successBody', { version, build, defaultValue: '' }),
    };
  }
  // Flavour + platform + version in the SUBJECT so the inbox is triageable
  // without opening each mail: "[PROD][iOS] Rapport d'erreur — v2.0.1
  // (build 25)". Two separate brackets rather than one joined label, so a
  // filter on "[PROD]" written before the platform existed keeps matching.
  // The rest of the device/log detail is in the attachment's session header
  // (formatSessionHeader).
  const base = i18n.t('errorReport.subject', { defaultValue: "Rapport d'erreur" });
  return {
    subject: `[${flavour}][${platform}] ${base} — v${version} (build ${build})`,
    body: i18n.t('errorReport.body', { version, build, defaultValue: '' }),
  };
}

/**
 * Mail (or share) a prepared report. Accepts the bare text-report URI for the
 * callers that predate attachments and kinds; they get an error report with
 * one attachment, exactly as before.
 *
 * The ONE door every report goes out through, whoever calls it (the error
 * screens, the root error boundary, Settings' previous session, the beta
 * success button), so the consent screen is here and nowhere else: shown
 * every time, before the mail composer or the share sheet, with no "don't ask
 * again" (item 1 j). Resolves true when the report was handed to a transport,
 * false when the user cancelled (consent screen or mail composer) or the
 * report was built before a vote-trace purge. A false leaves everything as it
 * was: the caller must not consume what it was about to send.
 */
export async function sendErrorReport(report: PreparedReport | string): Promise<boolean> {
  const prepared: PreparedReport =
    typeof report === 'string'
      ? { uri: report, errorMessage: '', attachments: [report], kind: 'error' }
      : report;
  // Built from a buffer that still held a vote flow's lines, since purged.
  // Never sent; the caller builds a new one (ErrorReportContext drops its
  // pending report on the same signal).
  //
  // Refusing is right, staying silent was not: this returned false without a
  // word, the consent alert never appeared, and from the outside tapping
  // "Envoyer" simply did nothing, on a screen whose whole purpose is to send
  // something. Say what happened and what to do instead.
  if (prepared.generation !== undefined && prepared.generation !== currentPurgeGeneration()) {
    await notifyReportExpired();
    return false;
  }
  const hasBetaAttachment = prepared.attachments.some((a) => a.endsWith('.json'));
  if (!(await confirmReportConsent({ betaAttachment: hasBetaAttachment }))) return false;

  const version = Application.nativeApplicationVersion ?? '?';
  const build = Application.nativeBuildVersion ?? '?';
  const { subject, body } = reportEnvelope(prepared.kind, version, build);

  if (await MailComposer.isAvailableAsync()) {
    const result = await MailComposer.composeAsync({
      recipients: [ERROR_REPORT_EMAIL],
      subject,
      body,
      attachments: prepared.attachments,
    });
    // iOS says when the composer was dismissed without sending; Android
    // cannot tell and reports every return the same way.
    return (result?.status as string | undefined) !== 'cancelled';
  }
  // The share sheet takes one file. The text report carries the log; the
  // artifacts JSON, when there is one, is the thing worth having, so prefer it.
  const single = prepared.attachments[prepared.attachments.length - 1] ?? prepared.uri;
  await Sharing.shareAsync(single, {
    mimeType: single.endsWith('.json') ? 'application/json' : 'text/plain',
    dialogTitle: i18n.t('errorReport.shareDialogTitle', { defaultValue: 'Send the report' }),
  });
  return true;
}

/**
 * Settings' "send the previous session's log": read the previous tail
 * (sanitised), ask, send, and forget it only once it has actually been handed
 * to a transport. Before 2.0.2 the file was deleted BEFORE the mail opened, so
 * backing out lost it.
 */
export async function sendPreviousSessionReport(): Promise<'sent' | 'cancelled' | 'none'> {
  const text = await readPreviousSessionLog();
  if (!text) return 'none';
  const sent = await sendErrorReport(await prepareRecoveredSessionReport(text));
  if (!sent) return 'cancelled';
  await clearPreviousSessionLog();
  return 'sent';
}

// A purge of the vote trace also removes the report files already written
// from the old buffer: they sit in the cache directory, where a later share
// could pick them up. Registered once, at module load.
onVoteTracePurged(() => {
  void cleanupOldReports();
});
