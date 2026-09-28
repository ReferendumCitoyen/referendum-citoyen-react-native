/**
 * One vote-error table, language-independent (R6, items 6 and 8 c).
 *
 * Every way a vote can stop maps to one code, and the code alone decides:
 *   - severity: `expected` (a refusal the voter can understand and nobody
 *     needs to report) or `error`;
 *   - retryable: whether "Réessayer le vote" is offered (a retry always makes
 *     a new proof, see voting-flow handleVoteRetry);
 *   - reportable: whether the report button is shown;
 *   - the translation key (with a _idCard / _passport variant when the text
 *     names the document).
 *
 * Classification reads codes and markers, never the French sentence the voter
 * saw: the retry decision used to scan the translated message, so it depended
 * on the language and on the wording. The raw relayer body is never copied into
 * a user string.
 *
 * Rules that matter:
 *   - a 400 from the relayer is terminal only when the cause is established
 *     locally (the eligibility rule fails now); an opaque 400, or one where the
 *     UTC date changed between the proof and the error, keeps Retry;
 *   - there is no global "[VOTE_INELIGIBLE] = terminal" rule: each sub-case
 *     (minor, age limit, nationality, other key, unsupported document) has its
 *     own entry, so the unsupported document stays reportable;
 *   - once the vote POST may have left the phone, the outcome is unknown and
 *     no entry says "not registered" (R4, utils/vote-attempt.ts).
 */
import type { TFunction } from 'i18next';
import { BIRTH_DATE_MESSAGES, CITIZENSHIP_MESSAGE } from './mrz-date-bounds';
import { isStorageFullError } from './storage-errors';
import type { IneligibilityReason } from './vote-eligibility';

export type VoteErrorCode =
  | 'already-voted'
  | 'ineligible-minor'
  | 'ineligible-age-limit'
  | 'ineligible-citizenship'
  | 'ineligible-document-rule'
  | 'other-key'
  | 'unsupported-document'
  | 'question-closed'
  | 'not-started'
  | 'ended'
  | 'not-available'
  | 'app-outdated'
  | 'relayer-forbidden'
  | 'relayer-server'
  | 'network'
  | 'outcome-unknown'
  | 'outcome-still-unknown'
  | 'rejected-opaque'
  | 'rejected-date-rollover'
  | 'prover-incompatible'
  | 'storage-full'
  | 'download-failed'
  | 'missing-data'
  | 'reverted'
  | 'unknown';

export interface VoteErrorEntry {
  severity: 'expected' | 'error';
  retryable: boolean;
  reportable: boolean;
  /** i18n key; `perDocument` appends _idCard / _passport. */
  key: string;
  perDocument?: boolean;
}

const expected = (key: string, perDocument = false): VoteErrorEntry => ({
  severity: 'expected',
  retryable: false,
  reportable: false,
  key,
  perDocument,
});

export const VOTE_ERROR_TABLE: Readonly<Record<VoteErrorCode, VoteErrorEntry>> = {
  // Refusals a retry cannot change, understood without us: no Retry, no report.
  'already-voted': expected('voting.errors.alreadyVotedThisQuestion'),
  'ineligible-minor': expected('voting.voteErrors.minor'),
  'ineligible-age-limit': expected('voting.voteErrors.ageLimit'),
  'ineligible-citizenship': expected('voting.voteErrors.citizenship'),
  'ineligible-document-rule': expected('voting.voteErrors.documentRule'),
  'other-key': expected('voting.voteErrors.otherKey', true),
  'question-closed': expected('voting.voteErrors.questionClosed'),
  'not-started': expected('voting.step11VotingNotStarted'),
  ended: expected('voting.step11VotingEnded'),
  'app-outdated': expected('voting.voteErrors.appOutdated'),
  // Refused for good, but a case we want to hear about.
  'unsupported-document': {
    severity: 'error',
    retryable: false,
    reportable: true,
    key: 'voting.voteErrors.unsupportedDocument',
    perDocument: true,
  },
  'not-available': { severity: 'error', retryable: false, reportable: true, key: 'voting.voteErrors.notAvailable' },
  // Transient on the service side: Retry kept.
  'relayer-forbidden': {
    severity: 'error',
    retryable: true,
    reportable: true,
    key: 'voting.voteErrors.serviceSaturated',
    perDocument: true,
  },
  'relayer-server': {
    severity: 'error',
    retryable: true,
    reportable: true,
    key: 'voting.voteErrors.serviceError',
    perDocument: true,
  },
  // The phone's connection, before anything was sent.
  network: { severity: 'expected', retryable: true, reportable: false, key: 'voting.voteErrors.network', perDocument: true },
  // Sent, outcome unknown: Retry re-reads the status first and never re-sends
  // while the first vote may still land (utils/vote-attempt.ts).
  'outcome-unknown': { severity: 'error', retryable: true, reportable: true, key: 'voting.voteErrors.outcomeUnknown' },
  'outcome-still-unknown': {
    severity: 'expected',
    retryable: true,
    reportable: false,
    key: 'voting.voteErrors.outcomeStillUnknown',
  },
  // The relayer's 400 with no locally established cause: Retry makes a new proof.
  'rejected-opaque': { severity: 'error', retryable: true, reportable: true, key: 'voting.step11VoteNotCast' },
  'rejected-date-rollover': { severity: 'error', retryable: true, reportable: true, key: 'voting.voteErrors.dateRollover' },
  // QA-7: the message names no platform and no error code, and says what the
  // voter can actually do (final wording confirmed by the product owner,
  // 22/09, closing DECISION-D6). Retry stays available: the same failure on a
  // second attempt is what tells us the phone, and not one bad proof, is the
  // problem, and the report button carries it to us.
  'prover-incompatible': { severity: 'error', retryable: true, reportable: true, key: 'voting.step11ProverIncompatible' },
  'storage-full': { severity: 'expected', retryable: true, reportable: false, key: 'voting.errors.deviceStorageFull' },
  'download-failed': { severity: 'error', retryable: true, reportable: true, key: 'voting.step11DownloadFailed' },
  'missing-data': { severity: 'error', retryable: true, reportable: true, key: 'voting.step11MissingData', perDocument: true },
  // The transaction was mined and reverted: certainly not recorded.
  reverted: { severity: 'error', retryable: true, reportable: true, key: 'voting.voteNotRegistered' },
  unknown: { severity: 'error', retryable: true, reportable: true, key: 'voting.errors.unexpected' },
};

export type DocSuffix = 'idCard' | 'passport';

export function voteErrorKey(code: VoteErrorCode, doc: DocSuffix): string {
  const entry = VOTE_ERROR_TABLE[code];
  return entry.perDocument ? `${entry.key}_${doc}` : entry.key;
}

export function voteErrorMessage(t: TFunction | ((key: string) => string), code: VoteErrorCode, doc: DocSuffix): string {
  return (t as (key: string) => string)(voteErrorKey(code, doc));
}

/** A local eligibility refusal, as a table code. */
export function codeForIneligibility(reason: IneligibilityReason): VoteErrorCode {
  switch (reason) {
    case 'closed':
      return 'question-closed';
    case 'not-started':
      return 'not-started';
    case 'ended':
      return 'ended';
    case 'wrong-document':
      return 'unsupported-document';
    case 'citizenship':
      return 'ineligible-citizenship';
    case 'app-outdated':
      return 'app-outdated';
    case 'not-listed':
    case 'unknown-contract':
    case 'multi-question':
    case 'unknown-rules':
      return 'not-available';
  }
}

/** Marker an error carries once the vote POST may have left the phone. The
 * patched SDK sets it (sendProposalRequest); so does utils/vote-calldata.ts. */
export const VOTE_POST_SENT = 'VOTE_POST_SENT';

export function votePostMaybeSent(err: unknown): boolean {
  const e = err as { votePostSent?: unknown; code?: unknown } | null;
  return !!e && typeof e === 'object' && (e.votePostSent === true || e.code === VOTE_POST_SENT);
}

/**
 * Narrower: the 90 s POST bound is what ended the attempt, as opposed to a
 * connection that dropped or a relayer that answered.
 *
 * The distinction matters for one decision only, and only because of WHEN it
 * happens. A lost answer usually arrives long after the relayer broadcast, so
 * asking the chain once answers the question. The bound firing is, by
 * definition, the statement that the relayer is STILL working, so the same
 * single question is asked at the worst possible instant and a vote that was
 * seconds from landing reads as "issue inconnue" (REG-11). The caller keeps
 * looking for a bounded while instead (utils/vote-attempt.ts).
 */
export function votePostBoundFired(err: unknown): boolean {
  const e = err as { votePostBoundFired?: unknown } | null;
  return !!e && typeof e === 'object' && e.votePostBoundFired === true;
}

/**
 * Whether this failure may leave a ballot on chain, so the vote trace must be
 * purged before the error screen (R8 with R4): a lost answer after the POST,
 * a status still unknown, or a mined transaction that reverted (its calldata,
 * ballot included, is public). A relayer that answered 4xx refused the vote
 * before broadcasting it: nothing to correlate, and its lines are exactly
 * what a report of that refusal needs.
 */
export function ballotMayBeOnChain(code: VoteErrorCode, err?: unknown): boolean {
  if (code === 'reverted' || code === 'outcome-unknown' || code === 'outcome-still-unknown') return true;
  if (!votePostMaybeSent(err)) return false;
  const status = relayerStatus(err);
  return !(status !== null && status >= 400 && status < 500);
}

/** HTTP status of a relayer answer, from the error object or its message
 * ("HTTP error 403: …", "[submitVote] relayer 403 …"). */
export function relayerStatus(err: unknown): number | null {
  const e = err as { status?: unknown } | null;
  if (e && typeof e === 'object' && typeof e.status === 'number') return e.status;
  const msg = messageOf(err);
  const m = /(?:HTTP error|relayer|sendProposalRequest failed:)\s*(\d{3})\b/i.exec(msg);
  return m ? Number(m[1]) : null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
}

const TRANSPORT = /(network request failed|failed to fetch|network error|connection (refused|reset)|econnrefused|enotfound|timed out|timeout|request was aborted|operation was aborted|aborterror)/i;

export interface VoteErrorContext {
  /** The eligibility rule, re-run now on the local index, refuses. */
  localIneligibility?: IneligibilityReason | null;
  /** The UTC day changed between the proof's start and this error. */
  dateChanged?: boolean;
}

/** Map a vote failure to its table code. Pure. */
export function classifyVoteError(err: unknown, ctx: VoteErrorContext = {}): VoteErrorCode {
  const tagged = (err as { voteCode?: unknown } | null)?.voteCode;
  if (typeof tagged === 'string' && tagged in VOTE_ERROR_TABLE) return tagged as VoteErrorCode;

  const msg = messageOf(err);
  const lower = msg.toLowerCase();

  if (/already voted|nullifier already used|déjà voté/i.test(msg)) return 'already-voted';
  if (lower.includes('profile key mismatch')) return 'other-key';
  if (msg === BIRTH_DATE_MESSAGES['above-upperbound'] || msg.includes('Birth date is higher than upperbound')) {
    return 'ineligible-minor';
  }
  if (msg === BIRTH_DATE_MESSAGES['below-lowerbound'] || msg.includes('Birth date is lower than lowerbound')) {
    return 'ineligible-age-limit';
  }
  if (msg === CITIZENSHIP_MESSAGE || msg.includes('Citizen is not in whitelist')) return 'ineligible-citizenship';
  if (msg.startsWith('[VOTE_INELIGIBLE]')) return 'ineligible-document-rule';
  if (/voting has not started/i.test(msg)) return 'not-started';
  if (/voting has ended/i.test(msg)) return 'ended';
  if (/proposal (closed|not active)/i.test(msg)) return 'question-closed';
  if (/td3 voting is not supported/i.test(msg)) return 'unsupported-document';
  if (isStorageFullError(err)) return 'storage-full';

  const sent = votePostMaybeSent(err);
  const status = relayerStatus(err);
  const pairing = msg.includes('0xd71fd263') || lower.includes('pairing_failed');
  const reverted400 = lower.includes('execution reverted') && lower.includes('failed to estimate gas');

  if (status === 403) return 'relayer-forbidden';
  if (status === 400 || (status === null && reverted400)) {
    if (ctx.localIneligibility) return codeForIneligibility(ctx.localIneligibility);
    if (pairing) return 'prover-incompatible';
    if (ctx.dateChanged) return 'rejected-date-rollover';
    return 'rejected-opaque';
  }
  if (status !== null && status >= 500) {
    // A gateway that timed out may have passed the vote on: unknown, not failed.
    if (sent && status >= 502) return 'outcome-unknown';
    return 'relayer-server';
  }
  if (pairing) return 'prover-incompatible';
  if (TRANSPORT.test(msg) || lower.includes('internal server error')) {
    if (sent) return 'outcome-unknown';
    return lower.includes('internal server error') ? 'relayer-server' : 'network';
  }
  if (sent) return 'outcome-unknown';
  return 'unknown';
}

/** Error carrying a table code, for refusals raised by the app itself. */
export class VoteRefusal extends Error {
  readonly voteCode: VoteErrorCode;
  constructor(code: VoteErrorCode) {
    super(`[vote] ${code}`);
    this.voteCode = code;
  }
}
