/**
 * What a failed chip read means, in words the user can act on (item 11 D and
 * rule R10 of the 2.0.2 dossier).
 *
 * Classified on the raw native text (`error.nativeMessage`, see
 * modules/e-document/index.ts), case-insensitively, and never shown as is:
 * every kind maps to a French translation key, so no English native sentence
 * ("NFC scan timeout", "Authentication failed for ID card…") reaches the
 * screen.
 *
 * Both native formats are recognised, so the OTA JavaScript already reads the
 * next store build correctly:
 *   - today: iOS `NFCPassportReaderError.UnexpectedError` (the fork's default
 *     branch, the CoreNFC reason discarded);
 *   - 2.0.2 store build (item 11 F): `Unknown(<CoreNFC error>)`, carrying the
 *     CoreNFC label ("Session timeout", "System resource unavailable"…).
 *
 * PACE/BAC-specific rules (the CAN refused on 6982 / "security status") apply
 * to the CAN flow only. Android's "Authentication failed for ID card" wrapper
 * is read through its "Original error:" part, never on its own (P15). In the
 * passport flow the same status words come from BAC with a mistyped MRZ, and
 * must neither be blamed on the CAN nor read as "carte d'identité détectée" (rule R11).
 */
import { suspectsWrongDocument, type DocFlow } from './wrong-document';
import { NFC_SCAN_TIMEOUT_MESSAGE } from './nfc-scan-owner';

export type ScanErrorKind =
  | 'invalidMrz'
  | 'userCancelled'
  | 'nfcUnsupported'
  | 'wrongDocument'
  | 'timeout'
  | 'canRejected'
  | 'contactLost'
  | 'nfcBusy'
  | 'interrupted'
  | 'translated'
  | 'generic';

/** An UnexpectedError this fast came before any possible contact with a chip. */
export const IMMEDIATE_FAILURE_MS = 1_000;
/** An UnexpectedError this late is CoreNFC closing its 60 s session. */
export const SESSION_CAP_FAILURE_MS = 55_000;

export interface ScanErrorInput {
  /** Untranslated native text (error.nativeMessage ?? error.message). */
  raw: string;
  /**
   * True when modules/e-document/index.ts replaced the native text with a
   * specific French explanation (error.hasSpecificMessage). Its catch-all
   * "Erreur NFC" rewrite does not count: it blames a disabled NFC for
   * anything, which is what item 11 D removes.
   */
  hasSpecificMessage?: boolean;
  code?: string;
  flow: DocFlow;
  /** Time from arming the reader to the failure, when known. */
  elapsedMs?: number;
}

const has = (m: string, ...patterns: RegExp[]) => patterns.some((p) => p.test(m));

// CoreNFC reasons as the future Unknown(<error>) wrapper spells them: the
// localized description, or the NSError domain/code (NFCReaderError 201 =
// session timeout, 203 = system busy).
const SESSION_TIMEOUT = [/session timeout/, /session timed out/, /nfcerror code=201\b/, /code=201\b/];
const SYSTEM_BUSY = [/system resource unavailable/, /system is busy/, /code=203\b/];
// Android: TagLostException "Tag was lost", IOException "Not connected", and
// SecurityException "Tag ... is out of date" (a Tag object from a previous
// contact). All three mean the card left the field, whatever wrapper carries them.
const CONTACT_LOST = [
  /tag was lost/,
  /tag connection lost/,
  /tag response error/,
  /not connected/,
  /out of date/,
];
// Android's PACE wrapper with "Failed response" and no 6982: the card moved
// during authentication. Card flow only: in the passport flow this is BAC.
const CARD_CONTACT_LOST = [/failed response/];
// The only proof that the chip refused the CAN (P15, plan D1).
const CAN_REFUSED = [/(?:\b|0x)6982\b/, /security status/];

/**
 * The cause inside Android's PACE wrapper ("Authentication failed for ID card.
 * Try providing the CAN ... Original error: <cause>"), or the whole text when
 * there is no wrapper.
 */
function originalError(m: string): string {
  const i = m.lastIndexOf('original error:');
  return i >= 0 ? m.slice(i + 'original error:'.length) : m;
}

export function classifyScanError(input: ScanErrorInput): ScanErrorKind {
  const m = (input.raw || '').toLowerCase();
  const isCardFlow = input.flow === 'idCard';

  if (input.raw === 'InvalidMRZKey' || input.code === 'InvalidMRZKey') return 'invalidMrz';
  // The person tapped Cancel on the iOS sheet: not an error to explain.
  if (has(m, /user ?cancell?ed/, /session invalidated by user/, /code=200\b/)) return 'userCancelled';
  if (has(m, /nfcnotsupported/, /nfc not supported/)) return 'nfcUnsupported';
  if (suspectsWrongDocument(input.raw || '', input.flow)) return 'wrongDocument';
  if (m === NFC_SCAN_TIMEOUT_MESSAGE.toLowerCase() || has(m, ...SESSION_TIMEOUT)) return 'timeout';

  // Order (P15): the native cause
  // first, then the CAN status words, then lost contact. Android's wrapper
  // "Authentication failed for ID card. Try providing the CAN" is printed for
  // ANY PACE failure, a lost tag included, so it is never evidence of a wrong
  // CAN on its own: only 6982 / "security status" are. 2.0.2 classified the
  // bare wrapper as canRejected and sent "Tag was lost" to "Modifier le
  // numéro CAN" (regression P15).
  const cause = originalError(m);
  if (isCardFlow && has(cause, ...CAN_REFUSED)) return 'canRejected';
  if (has(cause, ...CONTACT_LOST)) return 'contactLost';
  if (isCardFlow && has(cause, ...CARD_CONTACT_LOST)) return 'contactLost';
  if (isCardFlow && has(m, ...CAN_REFUSED)) return 'canRejected';
  if (has(m, ...CONTACT_LOST)) return 'contactLost';

  if (has(m, /unexpectederror/, /\bunknown\(/)) {
    if (has(m, ...SYSTEM_BUSY)) return 'nfcBusy';
    const elapsed = input.elapsedMs;
    if (elapsed !== undefined && elapsed < IMMEDIATE_FAILURE_MS) return 'nfcBusy';
    if (elapsed !== undefined && elapsed >= SESSION_CAP_FAILURE_MS) return 'timeout';
    return 'interrupted';
  }

  // modules/e-document/index.ts already wrote a French sentence for it.
  if (input.hasSpecificMessage) return 'translated';
  return 'generic';
}

/**
 * Translation key for a kind. `translated` has none (the module's French text
 * is shown), and `wrongDocument` / `invalidMrz` / `userCancelled` have their
 * own screens in Step 6.
 */
export function scanErrorKey(kind: ScanErrorKind, docSfx: 'idCard' | 'passport'): string | null {
  switch (kind) {
    case 'timeout': return `voting.step6Timeout_${docSfx}`;
    case 'nfcBusy': return 'voting.step6NfcBusy';
    case 'canRejected': return 'voting.step6CanRejected';
    case 'contactLost': return 'voting.step6TagLostError';
    case 'interrupted': return 'voting.step6UnexpectedError';
    case 'nfcUnsupported': return 'voting.nfcUnsupportedDevice';
    case 'userCancelled': return 'voting.step6Cancelled';
    case 'invalidMrz': return 'voting.step6InvalidMrz';
    case 'generic': return `voting.step6ReadFailed_${docSfx}`;
    default: return null;
  }
}

/**
 * Closed vocabulary for a failed chip read, attached at the native boundary
 * (modules/e-document/index.ts) and the only thing logged about it there
 * (plan D14, rule R8). Derived from classifyScanError so the
 * log and the screen can never disagree.
 */
export type NfcErrorCode =
  | 'NFC_AUTH'
  | 'NFC_CONTACT_LOST'
  | 'NFC_TIMEOUT'
  | 'NFC_BUSY'
  | 'NFC_CANCELLED'
  | 'NFC_UNSUPPORTED'
  | 'NFC_WRONG_DOCUMENT'
  | 'NFC_INVALID_MRZ'
  | 'NFC_INTERRUPTED'
  | 'NFC_FAILED';

const CODE_OF_KIND: Record<ScanErrorKind, NfcErrorCode> = {
  canRejected: 'NFC_AUTH',
  contactLost: 'NFC_CONTACT_LOST',
  timeout: 'NFC_TIMEOUT',
  nfcBusy: 'NFC_BUSY',
  userCancelled: 'NFC_CANCELLED',
  nfcUnsupported: 'NFC_UNSUPPORTED',
  wrongDocument: 'NFC_WRONG_DOCUMENT',
  invalidMrz: 'NFC_INVALID_MRZ',
  interrupted: 'NFC_INTERRUPTED',
  translated: 'NFC_FAILED',
  generic: 'NFC_FAILED',
};

export function nfcErrorCode(input: ScanErrorInput): NfcErrorCode {
  return CODE_OF_KIND[classifyScanError(input)];
}

/**
 * "type=<ErrorName> code=<NFC_...>" for a log line: the error's class name
 * (only if it looks like an identifier) and the closed code, never its text.
 */
export function describeNativeError(error: unknown, code: string | undefined): string {
  const name = (error as { name?: unknown } | null)?.name;
  const type = typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? name : 'Error';
  const safeCode = typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'none';
  return `type=${type} code=${safeCode}`;
}
