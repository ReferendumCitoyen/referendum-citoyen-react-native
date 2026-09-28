/**
 * Sentinel prefixes on the errors the registration pipeline throws when it
 * knows exactly what went wrong. Step 7 maps them to user-facing text
 * (utils/step7-error-message.ts): match on the prefix, never on what follows
 * it, which is the contract's or the prover's own English.
 *
 * Kept in a module with no imports so the message mapping — and its tests —
 * can load without dragging in ethers, the prover or the certificate parser.
 */

/** StateKeeper refused to bind a second document to an identity that already
 *  holds one — with Level 1 (utils/identity.ts) that means the person's other
 *  document is the registered one. */
export const IDENTITY_BOUND_ELSEWHERE = '[IDENTITY_BOUND_ELSEWHERE]';

/** Any other revert seen by the relayer dry run; the reason follows. */
export const REGISTRATION_REVERT = '[REGISTRATION_REVERT]';

/** The Noir prover rejected the witness; the circuit name and the prover's
 *  words follow. Since 2026-09-05 the usual cause is a circuit built for the
 *  old certificate-tree leaf (constants/bundled-circuits.ts). */
export const PROOF_GENERATION_FAILED = '[PROOF_GENERATION_FAILED]';

/** The chain binds this document to a key this attempt does not hold, and the
 *  one approved re-read with the document's own key (dossier 2.0.2, item 14 b)
 *  said the same. An expected refusal: no report button, "Relancer le vote". */
export const REGISTERED_WITH_OTHER_KEY = '[REGISTERED_WITH_OTHER_KEY]';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : '';
}

export function isOtherKeyRefusal(err: unknown): boolean {
  return messageOf(err).startsWith(REGISTERED_WITH_OTHER_KEY);
}

/** The registration POST left the phone but its answer did not come back: a
 *  network failure, the 90 s bound, or a body that could not be read. The
 *  registration may well be on chain. Never re-POSTed automatically (R3); the
 *  one approved status re-read and the confirmation poll decide. */
export const REGISTRATION_OUTCOME_UNKNOWN = '[REGISTRATION_OUTCOME_UNKNOWN]';

/** Sent, and not confirmed within the foreground wait. Shown as "confirmation
 *  en attente", never as "non enregistré". Followed by `service-unavailable`
 *  when the confirmation reads kept failing with a transient 5xx. */
export const REGISTRATION_PENDING = '[REGISTRATION_PENDING]';

export function isOutcomeUnknown(err: unknown): boolean {
  return messageOf(err).startsWith(REGISTRATION_OUTCOME_UNKNOWN);
}

export function isRegistrationPending(err: unknown): boolean {
  return messageOf(err).startsWith(REGISTRATION_PENDING);
}

/** The document-status read before anything is proved or sent did not
 *  answer in time, on every attempt (dossier 2.0.2, AV1 / plan D2). Nothing
 *  was sent: a network problem the user can retry with "Relancer le vote". */
export const STATUS_READ_TIMEOUT = '[STATUS_READ_TIMEOUT]';

/** Bound on ONE attempt of that read; three attempts and two 3 s pauses stay
 *  under 90 s. */
export const STATUS_READ_ATTEMPT_TIMEOUT_MS = 20_000;

export function isStatusReadTimeout(err: unknown): boolean {
  return messageOf(err).startsWith(STATUS_READ_TIMEOUT);
}
