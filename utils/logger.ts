import { Platform } from 'react-native';
import { isBetaBuild } from '@/constants/app-flavour';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { appVersionLabel } from './app-version';
import { isMockBackend, mockBackendOverride } from '@/constants/mock-backend';
import { TD1_HEAVY_REGISTER } from '@/constants/td1-heavy-register';
// Safe to import here: constants/rarime-config.ts has no imports of its own,
// so there is no cycle back into the logger (which loads very early, via
// utils/logger-install.ts).
import {
  RARIME_MAINNET_CONFIG,
  RARIME_TESTNET_CONFIG,
  FREEDOM_TOOL_MAINNET_CONFIG,
  FREEDOM_TOOL_TESTNET_CONFIG,
  MAINNET_REGISTRATION_CONTRACT_ADDRESS,
  MAINNET_CERT_POSEIDON_SMT_ADDRESS,
} from '@/constants/rarime-config';

// Best-effort PII redaction. Applied at insert time so the in-memory buffer
// itself never holds personally identifiable information. Not a security
// guarantee.

// ---------------------------------------------------------------------------
// Labelled values: `key: value`, `key=value`, `"key":"value"`, `key: {...}`
// ---------------------------------------------------------------------------
//
// A label is what marks a value as personal, so label and value are handled
// together and the value is dropped WHOLE, whatever its shape: a quoted string
// (spaces included), a nested object or array, or a bare token. The previous
// rule needed the label to be exactly one word of a list and the value to be
// one token, so `canNumber: 123456`, `userCAN=123456` or
// `passport: {"number": "X"}` went through.
//
// A label is personal when
//   - one of its words (camelCase / snake_case split) is a short label: `can`,
//     `dg1`, `sk`... Whole words only, so `scanMs` is not `can`;
//   - or its letters contain a long label: `passport`, `surname`,
//     `dateofbirth`, `accesskey` (the CAN's name in the vote flow)...
// A technical last word (`documentType`, `dg1Length`, `passportStatus`) keeps
// the value: those describe the data, they are not the data. Booleans and
// null are kept as well: `isPassportFlow: true` carries nothing.
//
// The CAN is the CNIe's access credential and the DPIA (R5 #2) is explicit
// that it must never appear in a log. KNOWN LIMIT, unchanged: this catches a
// labelled CAN in any spelling, not a bare `Using CAN 483920 for PACE`. Six
// digits cannot be matched generically without also redacting timings, byte
// counts and block numbers. Nothing logs a bare CAN; label it or it will not
// be caught. The report context, which is where a bare `can` value could
// arrive, is an allow-list (utils/error-reporter.ts), not a filter.

const SHORT_LABELS = new Set([
  'can', 'dg1', 'dg2', 'dg11', 'dg12', 'dg14', 'dg15', 'sod', 'sk', 'dob', 'pin', 'puk',
  'mrz', 'uid', 'seed', 'secret', 'password', 'sex', 'gender',
  // A slice of chip bytes is still chip bytes. The SDK patch used to log
  // `dg1 first16=[80,60,...]`: the label the redactor sees is the one glued to
  // the `=`, so `dg1` never applied and the value went out whole. The line is
  // gone, and the label is listed so the next one like it is caught (wave 4a).
  'first16', 'first8', 'first32', 'head', 'prefix', 'sample', 'excerpt',
]);
const LONG_LABELS = [
  'passport', 'document', 'surname', 'givenname', 'firstname', 'lastname', 'dateofbirth',
  'birthdate', 'expirydate', 'dateofexpiry', 'nationality', 'citizenship', 'issuingcountry',
  'personalnumber', 'privatekey', 'secretkey', 'accesskey', 'mnemonic', 'nullifier',
  // Vocabulary gaps: these are the field names the `mrz` package itself uses,
  // so they are what a future line is most likely to be labelled with.
  'expirationdate', 'docnumber', 'documentnumber',
];
const TECHNICAL_SUFFIXES = new Set([
  'type', 'status', 'count', 'length', 'len', 'size', 'bytes', 'ms', 'source', 'ready',
  'present', 'flow', 'kind', 'mode', 'code', 'whitelist', 'error', 'step', 'pos', 'position',
  'offset', 'shift',
]);

function labelWords(label: string): string[] {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** Whether a field name marks its value as personal. Exported for the report
 *  context allow-list and the tests. */
export function isSensitiveLabel(label: string): boolean {
  const words = labelWords(label);
  if (words.length === 0) return false;
  if (words.length > 1 && TECHNICAL_SUFFIXES.has(words[words.length - 1])) return false;
  if (words.some((w) => SHORT_LABELS.has(w))) return true;
  const flat = words.join('');
  return LONG_LABELS.some((l) => flat.includes(l));
}

// lead, opening quote, label, closing quote, then `:` or `=` (not `==`, `=>`).
const LABEL_RE = /(^|[^A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_]*)(["']?)[ \t]*[:=](?![=>])[ \t]*/g;
const VALUE_STOP = /[,;&}\])\s]/;

/** End index (exclusive) of the value that starts at `i`. */
function valueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, s.length);
  }
  if (c === '{' || c === '[') {
    let depth = 0;
    let quote: string | null = null;
    for (let j = i; j < s.length; j++) {
      const d = s[j];
      if (quote) {
        if (d === '\\') j++;
        else if (d === quote) quote = null;
        continue;
      }
      if (d === '"' || d === "'") quote = d;
      else if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return s.length;
  }
  let j = i;
  while (j < s.length && !VALUE_STOP.test(s[j])) j++;
  return j;
}

function redactLabelledValues(line: string): string {
  let out = '';
  let last = 0;
  const re = new RegExp(LABEL_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const [whole, lead, openQuote, label, closeQuote] = m;
    const valueStart = m.index + whole.length;
    if (!isSensitiveLabel(label) || valueStart >= line.length) {
      // Keep scanning INSIDE the value: `{"data":{"can":"1"}}` has its
      // personal label one level down.
      re.lastIndex = m.index + lead.length + openQuote.length + label.length + 1;
      continue;
    }
    const end = valueEnd(line, valueStart);
    const value = line.slice(valueStart, end);
    if (value.length === 0 || /^(?:true|false|null|undefined)$/.test(value)) {
      re.lastIndex = Math.max(end, m.index + 1);
      continue;
    }
    out += line.slice(last, m.index) + lead + openQuote + label + closeQuote + ':<redacted>';
    last = end;
    re.lastIndex = end;
  }
  return last === 0 ? line : out + line.slice(last);
}

/**
 * Contract addresses that are public infrastructure, not identity.
 *
 * The `<addr>` rule below masks every 0x+40hex it sees. That was the right
 * default when it was written, but in this app the user never holds an EOA —
 * their identity is a BJJ profile key, which is 64 hex and masked by its own
 * rule. Every 40-hex value we actually log is a contract: StateKeeper,
 * PoseidonSMT, Registration2, the relayer destination, a proposal's
 * sendVoteContract. Masking those buys no privacy and costs real diagnosis —
 * a report of a failed vote could not say WHICH contract rejected it.
 *
 * Seeded by walking the network config rather than by hand, so adding a
 * contract there can't leave this list behind. Runtime values that aren't in
 * the config — a proposal's own vote contract — register themselves via
 * `registerPublicAddress`.
 */
const publicAddresses = new Set<string>();

function collectAddresses(value: unknown): void {
  if (typeof value === 'string') {
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) publicAddresses.add(value.toLowerCase());
    return;
  }
  if (value && typeof value === 'object') Object.values(value).forEach(collectAddresses);
}

[
  RARIME_MAINNET_CONFIG,
  RARIME_TESTNET_CONFIG,
  FREEDOM_TOOL_MAINNET_CONFIG,
  FREEDOM_TOOL_TESTNET_CONFIG,
  MAINNET_REGISTRATION_CONTRACT_ADDRESS,
  MAINNET_CERT_POSEIDON_SMT_ADDRESS,
].forEach(collectAddresses);

/**
 * Mark a contract address as safe to show in logs. For addresses that only
 * exist at runtime — notably `proposal.sendVoteContractAddress`, which comes
 * from proposal data rather than our config.
 *
 * Only ever pass a CONTRACT address. Anything user-derived belongs behind the
 * redactor, and there is no way to un-register.
 */
export function registerPublicAddress(address: string | null | undefined): void {
  if (typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address)) {
    publicAddresses.add(address.toLowerCase());
  }
}

const PATTERNS: Array<[RegExp, string]> = [
  // MRZ embedded ANYWHERE in a line, not just as the whole line. The
  // whole-line rule in redact() only fires on a bare MRZ, so a prefixed one —
  // `MRZ match 2/2 - <mrzKey>` in app/passport-test.tsx, say — used to reach
  // the ring buffer intact, carrying document number, DOB, expiry and name.
  // Runs of 30+ are matched (not 30-44) so a 3-line TD1 MRZ logged as one
  // joined string collapses too.
  //
  // The `<` requirement is what keeps this from eating legitimate output: an
  // MRZ pads with filler `<`, while the long uppercase runs that show up in
  // normal logs (hex, base64, SCREAMING_CASE constants) do not contain it.
  // Ordered first, and disjoint from the hex rules below for the same reason.
  [
    /[A-Z0-9<]{30,}/g,
    ((m: string) => (m.includes('<') ? '<mrz>' : m)) as unknown as string,
  ],
  // Order matters: 0x+64hex before 0x+40hex so the longer match wins.
  [/0x[a-fA-F0-9]{64}\b/g, '<hex64>'],
  [
    /0x[a-fA-F0-9]{40}\b/g,
    ((m: string) =>
      publicAddresses.has(m.toLowerCase()) ? m : '<addr>') as unknown as string,
  ],
  [/\b[a-fA-F0-9]{64}\b/g, '<hex64>'],
  [/\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '<email>'],
  // Per-install identifiers. iOS file paths and stack frames carry the app
  // container's UUID, Android install paths a random per-install string
  // (/data/app/~~<random>==/fr.…-<random>==/). Either one is a stable id for
  // one phone across every report it sends.
  [/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '<uuid>'],
  [/\/data\/app\/[^\s:)'"]+/g, '/data/app/<path>'],
  [/\b\d{8,}\b/g, '<digits>'],
  // A byte array written out as decimals. Individual bytes are one to three
  // digits, so the `\d{8,}` rule above never sees them and the commas break
  // every hex and base64 rule. Eight or more in a row is not a measurement,
  // it is a buffer: chip bytes, a key, a proof (wave 4a / 4b, defence in
  // depth behind removing the line that produced one).
  [/\b\d{1,3}(?:\s*,\s*\d{1,3}){7,}\b/g, '<bytes>'],
  // Catch-all for any remaining hex run >=32 chars. The `\b…{64}\b` patterns
  // above require a word boundary after exactly 64 chars, so a CONTINUOUS hex
  // blob longer than 64 (e.g. an APDU TX/RX transcript) slips through.
  // Ordered last so the more specific <hex64>/<addr>/<digits> labels win
  // wherever they apply; anything left over is masked to <hex>.
  // Allowlisted contracts have to be re-checked here, not just in the <addr>
  // rule: a 40-hex address is >=32 chars, so leaving it intact above only for
  // this rule to mask it to <hex> would defeat the allowlist entirely (and did,
  // until a test caught it).
  [
    /(?:0x)?[a-fA-F0-9]{32,}/g,
    ((m: string) => (publicAddresses.has(m.toLowerCase()) ? m : '<hex>')) as unknown as string,
  ],
  // Unlabelled base64 runs (chip bytes, signatures, proofs), which none of
  // the hex rules reach. 40+ characters holding both letters and digits: no
  // word, constant or circuit name of this app gets there (those carry `_`).
  [
    /[A-Za-z0-9+/]{40,}={0,2}/g,
    ((m: string) =>
      /[0-9]/.test(m) && /[A-Za-z]/.test(m) && !publicAddresses.has(m.toLowerCase())
        ? '<b64>'
        : m) as unknown as string,
  ],
];

/**
 * Label a registration transaction hash in a log line.
 *
 * Returns `tx:<hex64>`: the hash itself never survives. A registration hash
 * in a report, next to the sender's address, would tie that sender to their
 * on-chain registration, so no report may carry one. The label
 * stays so a line still says that a transaction was produced; the parameter
 * stays so the call sites (Step7, register-via-noir, csca-bootstrap) need no
 * change.
 *
 * TODO(DECISION-REPORT-REDUCTIONS): the product owner and the protocol lead to confirm this reduction
 * and the three that go with it. Left exactly as it is on purpose: the wave 2b
 * review lists them as deliberate, not as regressions, and they are theirs to
 * weigh, not this branch's.
 *   1. HERE, the registration transaction hash. The one loss that closes a
 *      whole diagnosis: a registration that fails can no longer be found on
 *      chain. A middle road exists and is not taken here, keeping the first 8
 *      characters, which does not identify a sender but does narrow the
 *      candidate transactions inside a block window.
 *   2. `proposalId`, dropped from the success report by the context allow list
 *      (utils/error-reporter.ts): support no longer knows which question was
 *      voted.
 *   3. absolute timestamps, replaced by offsets from the first line
 *      (formatEntriesRelative, below): no report can be lined up against a
 *      clock any more.
 *   4. exact free disk space, replaced by bands above 10 GB
 *      (freeDiskBand, utils/error-reporter.ts).
 * Each is one function, and each is reversible in that one function.
 */
export function loggableTxHash(_txHash: string): string {
  return 'tx:<hex64>';
}

// TODO(DECISION-D1): how much detail a report keeps (product owner, protocol
// lead). This branch
// keeps the redacted flow lines; only the native boundary is closed to a type
// and a code (D14, modules/e-document and Step 6). A closed list for
// every line is not adopted until D-1 is decided.
export function redact(line: string): string {
  // Whole-line MRZ: 30-44 chars of A-Z, 0-9, < only.
  if (/^[A-Z0-9<]{30,44}$/.test(line)) return '<mrz>';
  let out = redactLabelledValues(line);
  for (const [re, repl] of PATTERNS) {
    out = typeof repl === 'function' ? out.replace(re, repl as any) : out.replace(re, repl);
  }
  return out;
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
/** `seq` is a per-process line counter: it orders lines for the vote-trace
 *  purge without relying on the clock, which can go backwards. */
export interface LogEntry { t: number; level: LogLevel; msg: string; seq?: number }

/**
 * How far back an error report's log tail reaches. Twenty minutes because a
 * full registration attempt — CSCA bootstrap, proof generation on a slow
 * phone, the SMT confirmation poll, a retry — runs longer than the five the
 * buffer used to keep, and the 2026-09-08 reports arrived with their opening
 * lines already evicted. Exported so the report header states the same number.
 */
export const LOG_RETENTION_MINUTES = 20;
const RETENTION_MS = LOG_RETENTION_MINUTES * 60 * 1000;
/** Hard cap on entries whatever their age: the ~7 lines/s the 5-minute buffer
 *  allowed, scaled to the new window. Worst case a few MB of strings. */
export const MAX_LOG_ENTRIES = 8000;

const buffer: LogEntry[] = [];

function evict() {
  const cutoff = Date.now() - RETENTION_MS;
  while (buffer.length > 0 && buffer[0].t < cutoff) buffer.shift();
  while (buffer.length > MAX_LOG_ENTRIES) buffer.shift();
}

let nextSeq = 0;

function push(level: LogLevel, msg: string): string {
  const clean = redact(msg);
  buffer.push({ t: Date.now(), level, msg: clean, seq: nextSeq++ });
  crashTailDirty = true;
  evict();
  return clean;
}

export function snapshotBuffer(): readonly LogEntry[] {
  evict();
  return buffer.slice();
}

// ---------------------------------------------------------------------------
// The vote trace: purged once the vote has left
// ---------------------------------------------------------------------------
//
// A vote transaction is public and its VoteCast event carries the ballot in
// clear. A report is sent from the voter's own address. So a report holding
// the vote steps with their times ("[Step11] Submitting vote", "step → 12
// (vote-submitted)") would let anyone who reads it find the one vote
// transaction in that window, and with it the sender's ballot. No redaction
// of the lines fixes that; only their absence does.
//
// So the vote flow marks where its lines start (beginVoteTrace, on entering
// the flow), and purgeVoteTrace drops every line from that mark on, in memory
// AND in the crash tail on disk. It is called when the vote succeeds
// (entering step 12), again when a flow that voted is left, and must be
// called by the vote code after any error that follows the vote POST (the
// outcome is unknown there: the ballot may be on chain). A report sent during
// a vote that failed before its POST has no ballot to correlate and keeps its
// lines: that is the report we need.
//
// Nothing is logged about the purge itself: a line saying "purged" at the
// time of the vote would be the very timestamp being removed.

let voteTraceStartSeq: number | null = null;
let purgeGeneration = 0;
const purgeListeners = new Set<() => void>();

/** The vote flow starts here: every line from now on belongs to it. */
export function beginVoteTrace(): void {
  voteTraceStartSeq = nextSeq;
}

/** The flow is over and holds no successful vote any more (after a purge, or
 *  a flow left without voting). */
export function endVoteTrace(): void {
  voteTraceStartSeq = null;
}

/**
 * Drop the vote flow's lines from the buffer and from the crash tail.
 *
 * Every line since beginVoteTrace goes; with no mark (a caller that never
 * began one), the whole buffer goes, which is the safe side. The buffer is
 * purged synchronously, before this returns, so a report prepared right
 * after it cannot see the lines; the returned promise settles once the tail
 * file has been rewritten (or deleted when nothing is left). Reports already
 * prepared from the old buffer are invalidated through
 * `currentPurgeGeneration` / `onVoteTracePurged`.
 */
export function purgeVoteTrace(): Promise<void> {
  const from = voteTraceStartSeq ?? -1;
  let removed = 0;
  for (let i = buffer.length - 1; i >= 0; i--) {
    const seq = buffer[i].seq ?? -1;
    if (from < 0 || seq >= from) {
      buffer.splice(i, 1);
      removed++;
    }
  }
  // Repeated purges are harmless: Step11 purges at the vote's outcome and
  // voting-flow again on entering step 12 or 13 and on leaving the run. A
  // purge that removed nothing leaves every report prepared since the last
  // one valid (they cannot hold a line that no longer exists), so only a
  // purge that removed lines invalidates them. The tail is rewritten every
  // time: it may still hold lines written before the previous purge settled.
  if (removed > 0) {
    purgeGeneration++;
    for (const fn of purgeListeners) {
      try { fn(); } catch { /* a listener must not stop the purge */ }
    }
  }
  return queueTail(() => writeCrashTailNow(true));
}

/** Bumped by every purge. A report prepared under an older generation may
 *  hold purged lines and must not be sent. */
export function currentPurgeGeneration(): number {
  return purgeGeneration;
}

export function onVoteTracePurged(fn: () => void): () => void {
  purgeListeners.add(fn);
  return () => { purgeListeners.delete(fn); };
}

/**
 * Map a value from a native or network boundary to a closed list of codes.
 *
 * For the new sources of 2.0.2 (PACE/BAC texts, CoreNFC reasons, relayer
 * bodies, the probe message): only a code that is on `allowed` reaches a log
 * line, an error object or a report; anything else is `fallback`. Matching is
 * exact after trimming, so a free text that merely CONTAINS a code does not
 * pass. Returns the allowed spelling, never the input.
 */
export function closedCode<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: string = 'other',
): T | string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const v = String(value).trim();
  const hit = allowed.find((a) => a === v);
  return hit ?? fallback;
}

// ---------------------------------------------------------------------------
// Exported log text: offsets, not clock times
// ---------------------------------------------------------------------------

/** `+MM:SS.mmm` from the first line. Minutes run past 59 rather than wrap. */
export function formatOffset(ms: number): string {
  const v = Math.max(0, Math.round(ms));
  const minutes = Math.floor(v / 60000);
  const seconds = Math.floor((v % 60000) / 1000);
  const millis = v % 1000;
  return `+${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Log lines as they go into a report: time as an offset from the first line,
 * level, message. The absolute time of each line is not written anywhere a
 * report can carry: the header says the minute the report was made.
 */
export function formatEntriesRelative(entries: readonly Pick<LogEntry, 't' | 'level' | 'msg'>[]): string {
  if (entries.length === 0) return '';
  const t0 = entries[0].t;
  return entries
    .map((e) => `${formatOffset(e.t - t0)} ${e.level.toUpperCase().padEnd(5)} ${e.msg}`)
    .join('\n');
}

// Markers of a vote that LEFT the phone, in the lines the vote flow writes
// (voting-flow.tsx, Step11.tsx). Used on tails read from disk, which may have
// been written by pre-2.0.2 code that never purged anything.
const VOTE_SENT_MARKERS = [
  // The four below mark a vote that has ALREADY come back. They are written
  // after the relayer answered, or at the step change that follows it.
  /\(vote-submitted\)/,
  /Vote TX hash/i,
  /vote tx id/i,
  /vote tx reverted/i,
  // The three below mark a vote that is LEAVING, and they are why this list
  // was wrong until 23/09/2026. The audit of that day found the window: the
  // POST can take up to VOTE_POST_TIMEOUT_MS, and if the process dies in it,
  // none of the four above was ever written. The purge then found no marker,
  // kept the whole segment, and a report could leave with the proposal number
  // and the instant of the POST, from the person's own mail address, which is
  // exactly what R8 exists to prevent. Note that "relayer accepted: txId=" is
  // not matched by /vote tx id/i: there is no space in "txId".
  // The first of the three is written BEFORE anything else of the vote, so a
  // segment that reaches it is dropped from there, whatever happens next.
  /casting vote on proposal/i,
  /\[submitVote\] POST/i,
  /relayer accepted/i,
];
const FLOW_START_MARKER = /\[flow\] step → 1 \(focus-reset\)/;
/**
 * Levels worth keeping from AFTER a sent ballot. An error is the reason the
 * tail exists; a log or a debug line from the same moments is flow narration
 * and carries no diagnosis worth the correlation it would allow (REG-9).
 */
const POST_VOTE_KEPT_LEVELS = new Set(['ERROR', 'FATAL', 'WARN']);
/**
 * Constant, carries nothing: support must be able to tell a tail that was cut
 * from a tail that was short.
 */
export const VOTE_TRACE_REMOVED_NOTE =
  '[report] vote steps removed before sending (R8); the errors that followed are kept, timed to the minute';
const TAIL_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\s+([A-Z]+)\s?(.*)$/;

/**
 * Turn a crash tail read from disk into report text.
 *
 * The same pass for every tail, whoever wrote it: tails left by 2.0.0 and
 * 2.0.1 survive an update, and they hold registration hashes in clear, the
 * vote steps of successful votes and clock times to the millisecond.
 *   1. in a vote flow that sent a ballot, every line up to and including the
 *      last vote marker is dropped: that is the ballot, its preparation and
 *      anything that names the transaction;
 *   2. what FOLLOWED the vote is kept when it is an error, which is the whole
 *      point of a crash tail, with its clock rounded down to the minute;
 *   3. every line is redacted again with today's rules;
 *   4. clock times become offsets from the first line kept.
 * Returns null when nothing is left.
 *
 * REG-9, and the reasoning behind the shape above. Dropping the vote flow
 * WHOLE was the safe first cut, and it had one perverse effect: the single
 * most interesting case for support, an app that disappears in the seconds
 * after a vote, was exactly the case that left nothing at all to send. The
 * "envoyer le journal de la session précédente" line never even appeared.
 *
 * What R8 protects is the ballot and the ability to line a report up against
 * a transaction on a public chain. Neither of those lives in the stack trace
 * of a native crash that happened afterwards. So the cut moves from "the
 * whole flow" to "everything through the vote", and what survives is the
 * error that followed:
 *   - no line of the vote flow itself survives, so no proposal, no answer
 *     index, no transaction id, no relayer exchange;
 *   - the surviving errors are re-redacted with today's rules;
 *   - their timestamps are floored to the minute before offsets are computed,
 *     so the sub-minute alignment with a block timestamp is gone. A minute on
 *     an L2 whose blocks are seconds apart is not a pointer to one voter;
 *   - a constant note says lines were removed and why, so support reads a
 *     partial tail as partial rather than as a complete one.
 * The live purge (purgeVoteTrace) is untouched: this function only ever sees
 * a tail left on disk by a session that died before it could purge anything.
 */
export function sanitizeTailForReport(text: string): string | null {
  type Parsed = { t: number; level: string; msg: string };
  const entries: Parsed[] = [];
  for (const raw of text.split('\n')) {
    const m = TAIL_LINE.exec(raw);
    if (m) {
      const t = Date.parse(m[1]);
      entries.push({ t: Number.isFinite(t) ? t : entries[entries.length - 1]?.t ?? 0, level: m[2], msg: m[3] });
    } else if (entries.length > 0) {
      // A continuation line (a stack frame, a multi-line message).
      entries[entries.length - 1].msg += '\n' + raw;
    } else if (raw.trim().length > 0) {
      entries.push({ t: 0, level: 'LOG', msg: raw });
    }
  }
  // Split into flows and drop those that sent a vote.
  const segments: Parsed[][] = [[]];
  for (const e of entries) {
    if (FLOW_START_MARKER.test(e.msg) && segments[segments.length - 1].length > 0) segments.push([]);
    segments[segments.length - 1].push(e);
  }
  const kept: Parsed[] = [];
  for (const seg of segments) {
    let lastVote = -1;
    seg.forEach((e, i) => {
      if (VOTE_SENT_MARKERS.some((re) => re.test(e.msg))) lastVote = i;
    });
    if (lastVote === -1) {
      kept.push(...seg);
      continue;
    }
    // Everything through the vote goes. What followed it is kept only when it
    // is an error, which is what a crash tail is for, and only to the minute.
    const after = seg
      .slice(lastVote + 1)
      .filter((e) => POST_VOTE_KEPT_LEVELS.has(e.level.toUpperCase()));
    if (after.length === 0) continue;
    const minute = (t: number) => Math.floor(t / 60_000) * 60_000;
    kept.push({ t: minute(after[0].t), level: 'LOG', msg: VOTE_TRACE_REMOVED_NOTE });
    kept.push(...after.map((e) => ({ ...e, t: minute(e.t) })));
  }
  if (kept.length === 0) return null;
  const lines = kept.map((e) => ({
    t: e.t,
    level: (e.level.toLowerCase() as LogLevel),
    msg: e.msg.split('\n').map(redact).join('\n'),
  }));
  return formatEntriesRelative(lines);
}

// ---------------------------------------------------------------------------
// Surviving a shutdown
// ---------------------------------------------------------------------------
//
// The buffer above is memory only, which is right for the normal case: cheap,
// already redacted, and a report file is written the moment a tester asks for
// one. It has exactly one failure mode, and on 2026-09-10 it happened — the
// app disappeared moments after a vote, taking with it every line that would
// have said why. The tester never reached a report button, so nothing had been
// written to disk.
//
// So the tail is mirrored to a file, on a timer rather than on every line: a
// shutdown then leaves the last minutes behind and the next launch can offer
// them. Best-effort throughout — a logger that throws while logging would be
// worse than the gap it closes.

/** How much of the tail to keep on disk. Shorter than the in-memory window: a
 *  shutdown is explained by its final moments, and this is rewritten often. */
const CRASH_TAIL_ENTRIES = 1200;
/** Gap between writes. Invisible next to proof generation, and a shutdown
 *  loses only seconds of context. */
const CRASH_TAIL_INTERVAL_MS = 10_000;

let crashTailTimer: ReturnType<typeof setInterval> | null = null;
let crashTailDirty = false;

// Three files, all in the cache directory, all local:
//   - the CURRENT tail, rewritten every 10 s by the running session;
//   - the PREVIOUS tail, the current one renamed at the next launch. The
//     only file Settings ever offers. Before 2.0.2 Settings read the current
//     file, so "send the previous session's log" sent the running session's
//     own tail as soon as it had run 10 s: 34 such reports, none a crash;
//   - the CLEAN marker, an empty file written when the app goes to the
//     background and deleted when it comes back. Found at launch, it means
//     the last session ended in the background (the user left, or the system
//     reclaimed it), so there is nothing to report.
// 'background' only, never 'inactive': the CoreNFC sheet, Face ID and the
// Control Centre fire 'inactive' while the app is in use, and a marker there
// would classify a crash during the NFC read as a clean exit.
const CURRENT_TAIL_FILE = 'last-session-log.txt';
const PREVIOUS_TAIL_FILE = 'previous-session-log.txt';
const CLEAN_MARKER_FILE = 'clean-exit.marker';

type FsModule = typeof import('expo-file-system/legacy');

async function fsAndDir(): Promise<{ fs: FsModule; dir: string } | null> {
  try {
    const fs = await import('expo-file-system/legacy');
    const dir = fs.cacheDirectory;
    return dir ? { fs, dir } : null;
  } catch {
    return null;
  }
}

// Every operation on these files goes through this one queue: a periodic
// write, the launch rotation, the purge rewrite, Settings' read and delete.
// Without it, a write that snapshotted the buffer BEFORE a purge could land
// on disk AFTER the purge's rewrite and put the purged lines back.
let tailQueue: Promise<void> = Promise.resolve();

function queueTail<T>(op: () => Promise<T>): Promise<T> {
  const run = tailQueue.then(op, op);
  tailQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Write the current tail. `force` rewrites even when nothing new was
 *  logged, and an empty buffer DELETES the file instead of leaving the last
 *  written tail behind (the purge relies on both). */
async function writeCrashTailNow(force: boolean): Promise<void> {
  if (!force && !crashTailDirty) return;
  crashTailDirty = false;
  try {
    const env = await fsAndDir();
    if (!env) return;
    const { fs, dir } = env;
    const tail = snapshotBuffer().slice(-CRASH_TAIL_ENTRIES);
    if (tail.length === 0) {
      await fs.deleteAsync(dir + CURRENT_TAIL_FILE, { idempotent: true });
      return;
    }
    // Clock times stay in this local file (they are turned into offsets when
    // a report is made from it, sanitizeTailForReport).
    const text = tail
      .map((e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.msg}`)
      .join('\n');
    await fs.writeAsStringAsync(dir + CURRENT_TAIL_FILE, text, { encoding: fs.EncodingType.UTF8 });
  } catch {
    // Never let mirroring break logging.
  }
}

async function exists(fs: FsModule, path: string): Promise<boolean> {
  try {
    return (await fs.getInfoAsync(path)).exists;
  } catch {
    return false;
  }
}

/**
 * At launch, before the first tail write: the tail the last session left
 * becomes the previous tail; a clean marker deletes both marker and previous
 * tail (the last session ended in the background). Queued, so nothing else
 * touches the files until it is done.
 */
export function rotateCrashTailAtLaunch(): Promise<void> {
  return queueTail(async () => {
    const env = await fsAndDir();
    if (!env) return;
    const { fs, dir } = env;
    try {
      if (await exists(fs, dir + CURRENT_TAIL_FILE)) {
        await fs.deleteAsync(dir + PREVIOUS_TAIL_FILE, { idempotent: true });
        await fs.moveAsync({ from: dir + CURRENT_TAIL_FILE, to: dir + PREVIOUS_TAIL_FILE });
      }
      if (await exists(fs, dir + CLEAN_MARKER_FILE)) {
        await fs.deleteAsync(dir + CLEAN_MARKER_FILE, { idempotent: true });
        await fs.deleteAsync(dir + PREVIOUS_TAIL_FILE, { idempotent: true });
      }
    } catch {
      // best effort
    }
  });
}

/** AppState hook, wired in utils/logger-install.ts. */
export function noteAppStateForCrashTail(state: string): Promise<void> {
  if (state === 'background') {
    return queueTail(async () => {
      const env = await fsAndDir();
      if (!env) return;
      try {
        // Constant content, no timestamp.
        await env.fs.writeAsStringAsync(env.dir + CLEAN_MARKER_FILE, '', { encoding: env.fs.EncodingType.UTF8 });
      } catch { /* best effort */ }
    });
  }
  if (state === 'active') {
    return queueTail(async () => {
      const env = await fsAndDir();
      if (!env) return;
      try {
        await env.fs.deleteAsync(env.dir + CLEAN_MARKER_FILE, { idempotent: true });
      } catch { /* best effort */ }
    });
  }
  return Promise.resolve();
}

/**
 * The previous session's tail, ready for a report: vote flows removed,
 * redacted again, offsets instead of clock times (sanitizeTailForReport).
 * Null when there is none, or when nothing is left after the pass.
 */
export function readPreviousSessionLog(): Promise<string | null> {
  return queueTail(async () => {
    const env = await fsAndDir();
    if (!env) return null;
    try {
      if (!(await exists(env.fs, env.dir + PREVIOUS_TAIL_FILE))) return null;
      const text = await env.fs.readAsStringAsync(env.dir + PREVIOUS_TAIL_FILE);
      return text.trim().length > 0 ? sanitizeTailForReport(text) : null;
    } catch {
      return null;
    }
  });
}

/** Forget the previous tail, once it has been SENT (a cancelled send keeps
 *  it, so the offer is still there next time). */
export function clearPreviousSessionLog(): Promise<void> {
  return queueTail(async () => {
    const env = await fsAndDir();
    if (!env) return;
    try {
      await env.fs.deleteAsync(env.dir + PREVIOUS_TAIL_FILE, { idempotent: true });
    } catch { /* best effort */ }
  });
}

export function startCrashTail(): void {
  if (crashTailTimer) return;
  crashTailTimer = setInterval(() => void queueTail(() => writeCrashTailNow(false)), CRASH_TAIL_INTERVAL_MS);
}

export function stopCrashTail(): void {
  if (!crashTailTimer) return;
  clearInterval(crashTailTimer);
  crashTailTimer = null;
}

// Test-only hooks. Not for production import sites.
export const __testing = {
  push,
  snapshot: snapshotBuffer,
  reset: () => { buffer.length = 0; voteTraceStartSeq = null; },
  flushTail: () => queueTail(() => writeCrashTailNow(false)),
  drainTail: () => queueTail(async () => undefined),
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
      let redacted: string | null = null;
      try {
        redacted = push(level, formatArgs(args));
      } catch {
        // Never let logging crash the app.
      }
      // The device's own system log (Xcode console, logcat) is readable by
      // anything with a cable or a bug-report dump, and it used to receive
      // the ORIGINAL arguments while the report was filtered. Release builds
      // pass it the redacted line only; a dev build keeps the raw objects,
      // which is what a developer at the debugger needs.
      if (__DEV__) originals[level]!(...args);
      else originals[level]!(redacted ?? '<unloggable>');
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

// expo-device is a native module, so reading it can throw when new JS ships
// over an older native build via OTA. Same guard (and same reason) as
// utils/contact-info.ts::deviceModel — a report that loses its device line is
// far better than one that fails to generate. `modelName` is the marketing
// name ("iPhone 17 Pro", "Pixel 8"); `deviceName` is deliberately NOT used,
// because users name their phones after themselves.
function deviceModel(): string {
  try {
    // Manufacturer + model, because "SM-G780G" alone doesn't read as a phone
    // to a human triaging a report, and the manufacturer disambiguates the
    // hardware-specific failures (Samsung NFC placement, Pixel 8+ 16 KB pages).
    const maker = Device.manufacturer ?? Device.brand ?? '';
    const model = Device.modelName ?? '?';
    return maker && !model.startsWith(maker) ? `${maker} ${model}` : model;
  } catch {
    return '?';
  }
}

/** Total RAM in whole GB, or '?'. witnesscalc OOMs on low-RAM devices during
 *  proof generation, so this is a first-class triage signal, not a curiosity.
 *  Whole GB and no finer: to the 0.1 GB, next to the model and OS, it was one
 *  more bit of a per-phone fingerprint, and triage needs "3 or 8", not "3.7". */
export function roundedGb(bytes: number | null | undefined, unit: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '?';
  return `${Math.max(1, Math.round(bytes / unit))} GB`;
}

function totalMemoryGb(): string {
  try {
    return roundedGb(Device.totalMemory, 1024 ** 3);
  } catch {
    return '?';
  }
}

/**
 * The language only (`fr`, `en`), never the region. A region tag can be rare
 * enough among the reports we receive to single out the phone that sent one,
 * and the region answers no diagnostic question, so it never leaves the app.
 */
export function languageOnly(locale: string | null | undefined): string {
  if (!locale) return '?';
  const lang = locale.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return /^[a-z]{2,3}$/.test(lang) ? lang : '?';
}

/**
 * `2026-09-22T10Z`: the HOUR the report was made, no finer.
 *
 * It said the minute until 23/09/2026. The protocol author put the point to us
 * that way: the relative offsets plus the Date header of the mail that carries
 * the report resolve every log line to an absolute time. What the reply missed,
 * and what reading the code showed, is that the mail is not even needed — this
 * header alone does it, because the offsets below it are counted from the first
 * line. On chain a vote carries its block's timestamp, so a report and a vote
 * transaction could be lined up to the minute, and when few votes fall in the
 * same minute that match is unique.
 *
 * The hour is the coarsest value that keeps the diagnosis we actually use:
 * ordering the reports of one day, and tying them to a deployment. The day
 * would lose the ability to line up two reports from the same person on the
 * same evening. Rounding the offsets as well would cost the timing diagnosis
 * itself, which is how the chip read was found to stall at 10 and 35 percent,
 * so the offsets are left alone.
 *
 * The name is kept so the call sites read the same; what changed is the
 * precision, and that is what the tests pin.
 */
export function minuteStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 13) + 'Z';
}

/**
 * Which install this is — the single most-requested missing field. Beta and
 * production are separate binaries with separate SecureStore sandboxes, and
 * a report that doesn't say which one it came from has repeatedly sent us
 * chasing a "lost key" that was really a tester moving between the two.
 * Derived from the bundle id (…​.fr.beta vs …​.fr) so it cannot be faked or
 * drift from the actual binary.
 */
export function appFlavourLabel(): string {
  try {
    const id = Application.applicationId ?? '';
    if (isBetaBuild()) return 'BÊTA';
    if (id) return 'PROD';
    return '?';
  } catch {
    return '?';
  }
}

/**
 * Which platform the report came from.
 *
 * Sits in the subject next to the flavour because the inbox sorts on it first:
 * an iOS-only failure (a PACE session, a Liquid Glass header) and an
 * Android-only one (a 32-bit ROM, a witnesscalc OOM) read identically once the
 * subject is opened, and until now the platform was only in the attachment's
 * session header. Spelled as the contact mail spells it (utils/contact-info.ts
 * ::prettyPlatform) so the two mails sort the same way.
 */
export function platformLabel(): string {
  if (Platform.OS === 'ios') return 'iOS';
  if (Platform.OS === 'android') return 'Android';
  return Platform.OS || '?';
}

/** Source commit of this binary, from app.config.ts's build-time capture.
 *  Read straight off Constants so logger stays independent of the app-version
 *  label module. '?' when the build didn't record one (e.g. a bare export). */
function commitLabel(): string {
  try {
    const extra = Constants.expoConfig?.extra as { commitHash?: string; commitDirty?: boolean } | undefined;
    if (!extra?.commitHash) return '?';
    return extra.commitHash.slice(0, 10) + (extra.commitDirty ? '-dirty' : '');
  } catch {
    return '?';
  }
}

function deviceLocale(): string | null {
  try {
    return typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : null;
  } catch {
    return null;
  }
}

export function formatSessionHeader(network: string | null): string {
  const lines = [
    // Which binary, first and unmissable. Everything below is read differently
    // depending on this, and it was the field reports never carried.
    `App     : ${appFlavourLabel()} — Référendum Citoyen`,
    // Version + build number name the JavaScript too: the app has no
    // over-the-air updater (app.config.ts), so the bundle is the binary's.
    `Version : ${appVersionLabel()} (build ${Application.nativeBuildVersion ?? '?'})`,
    // Source commit of this binary, when the build recorded it (EAS builds do;
    // see app.config.ts::gitCommit). Ties a report to exactly the code that
    // produced it — invaluable when several test builds ship in a day.
    `Commit  : ${commitLabel()}`,
    // Beta and production are separate installs with separate SecureStore
    // sandboxes, so the same document registers under different keys in each.
    // Several "my key disappeared" reports turned out to be a tester moving
    // between the two, and nothing in the report said which one it came from.
    `Bundle  : ${Application.applicationId ?? '?'}`,
    // Model, not just OS: several reported failures are hardware-specific
    // (16 KB pages on Pixel 8+, NFC antenna placement, low-RAM witnesscalc
    // OOM), and "ios 26.5" alone can't tell those apart.
    `Device  : ${deviceModel()}`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `Memory  : ${totalMemoryGb()}`,
    `Locale  : ${languageOnly(deviceLocale())}`,
    `Network : ${network ?? '?'}`,
    // Build-time switches that change behaviour enough to invalidate a report
    // read without them. MOCK_BACKEND stubs registration and voting outright,
    // so "the vote worked" from a mock build means nothing; TD1_HEAVY_REGISTER
    // decides whether an ID card registers through the heavy Noir circuit or
    // the light registrator — two completely different failure surfaces.
    // Neither is inferable from the version string.
    `Flags   : MOCK_BACKEND=${isMockBackend()}${mockBackendOverride() === null ? '' : ' (overridden in Settings)'} TD1_HEAVY_REGISTER=${TD1_HEAVY_REGISTER}`,
    `Time    : ${minuteStamp()}`,
  ];
  return lines.join('\n');
}
