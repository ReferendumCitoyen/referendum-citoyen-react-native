/**
 * "Is the user holding the other kind of document?" — decided from the text of
 * a native NFC error.
 *
 * Step 6 has two ways to reach that conclusion. One is proof: the chip was
 * read and its DG1 came back at the other type's length (TD3 passport = 93
 * bytes, TD1 ID card = 95). The other is this file — a *guess*, used when the
 * read never got far enough to produce a DG1. Callers must treat the two
 * differently: only the DG1 evidence justifies telling the user to start over
 * with a different document and taking the retry button away.
 *
 * The guess previously lived inline in Step6 as a list of `includes(...)`
 * checks, and in the ID-card flow it matched on essentially every failure,
 * on both platforms:
 *
 *   - iOS surfaces errors as "<ErrorType>: <description>", and the type is
 *     `NFCPassportReaderError` — so *every* iOS error contains the substring
 *     "passport". Two of the library's own PACE failures also mention
 *     "passports public key" / "passports ephemeral key" in their description,
 *     no matter which document is actually on the phone.
 *   - Android's ID-card authentication failure reads "…try providing the CAN
 *     (6 digits) from the back of the card…", and "back" contains "bac".
 *
 * Both fired, so a perfectly valid French ID card that merely read badly (held
 * upside down, poor antenna coupling) was reported to the user as "Passeport
 * détecté" — and the retry button was hidden, dead-ending them. Found from
 * beta-tester feedback, Aug 2026.
 *
 * The rules below therefore:
 *   1. never match the bare words "passport" / "passeport", which in practice
 *      only ever come from the library's own name;
 *   2. use word boundaries for short tokens, and drop the bare "bac" test
 *      altogether — the BAC fallback is attempted during a legitimate ID-card
 *      scan anyway, so it was never good evidence;
 *   3. return no verdict at all for transport failures (tag lost, timeout,
 *      cancelled), which say nothing about which document was presented.
 */

export type DocFlow = 'passport' | 'idCard';

/**
 * Failures of the radio link or of the session rather than of the document.
 * A dropped tag looks identical whichever document was on the phone, so these
 * must never produce a document-type verdict.
 */
const TRANSPORT_PATTERNS: RegExp[] = [
  /tag (was |connection )?lost/,
  /connection ?(error|lost)/,
  /noconnectedtag/,
  /tagnotvalid/,
  /tag invalide/,
  /morethanonetagfound/,
  /plusieurs tags/,
  /user ?cancell?ed/,
  /timeout/,
  /timed out/,
  /transceive/,
  /ioexception/,
  /io error/,
  /nfcnotsupported/,
];

/**
 * Signals that the chip is a passport while we were scanning for a French ID
 * card. A CNIe scan polls Type A and speaks PACE; a passport is Type B and
 * generally only speaks BAC — so an explicit Type B detection, or the chip
 * refusing PACE outright, points at a passport.
 */
const PASSPORT_SIGNALS: RegExp[] = [
  /iso ?14443-? ?b/,
  /\btype[- ]?b\b/,
  /pace not supported/,
  /pace non support/,
  /\bno pace\b/,
];

/**
 * Signals that the chip is a French ID card while we were scanning for a
 * passport. PACE-IM (integrated mapping) is a CNIe protocol a passport never
 * speaks.
 *
 * "Security status not satisfied" (6982) used to be on this list, as the mark
 * of a chip that demanded PACE first. It is also exactly what a real passport
 * answers to BAC with a mistyped MRZ, so it told a passport holder with one
 * wrong digit "carte d'identité détectée" (rule R11 of the 2.0.2 dossier).
 * 6982 is a PACE/BAC status, read only in the CAN flow (scan-error.ts).
 */
const ID_CARD_SIGNALS: RegExp[] = [
  /step ?2 ?im/,
  /pace-im/,
  /im not yet/,
  /carte d'identit/,
];

/** True for errors that describe a broken link rather than a wrong document. */
export function isTransportError(message: string): boolean {
  const m = message.toLowerCase();
  return TRANSPORT_PATTERNS.some((pattern) => pattern.test(m));
}

/**
 * Best guess at "wrong document type" from a native error message. Returns
 * false whenever the error is a transport failure, or whenever nothing in the
 * message unambiguously identifies the other document — the caller should then
 * fall back to a plain read error, which is always recoverable by retrying.
 *
 * @param flow the document type the scan was *expecting*.
 */
export function suspectsWrongDocument(message: string, flow: DocFlow): boolean {
  const m = message.toLowerCase();
  // A broken radio link tells us nothing about the document. Bail before
  // looking at anything else, so a stray token inside e.g. a timeout message
  // can't be read as evidence.
  if (TRANSPORT_PATTERNS.some((pattern) => pattern.test(m))) return false;
  const signals = flow === 'passport' ? ID_CARD_SIGNALS : PASSPORT_SIGNALS;
  return signals.some((pattern) => pattern.test(m));
}
