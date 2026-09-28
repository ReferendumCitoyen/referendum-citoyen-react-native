/**
 * The one place a Step 7 failure is turned into the sentence the user reads.
 *
 * Every error class Step 7 can raise ends on Step 7 with a message (the flow
 * never advances on failure), so the mapping is worth keeping pure and
 * tested: a wrong branch here is a wrong instruction to a voter.
 */
import {
  IDENTITY_BOUND_ELSEWHERE,
  PROOF_GENERATION_FAILED,
  REGISTERED_WITH_OTHER_KEY,
  REGISTRATION_OUTCOME_UNKNOWN,
  REGISTRATION_PENDING,
  REGISTRATION_REVERT,
  STATUS_READ_TIMEOUT,
} from '@/utils/registration-sentinels';
import { isServiceUnavailableError } from '@/utils/relayer-errors';
import { isStorageFullError } from '@/utils/storage-errors';

export type DocSuffix = 'idCard' | 'passport';

export interface Step7ErrorContext {
  /** Which document the user is voting with — picks the *_idCard / *_passport strings. */
  docSfx: DocSuffix;
  /**
   * True when this document shares its key with the other document type on
   * this phone (Level 1, utils/identity.ts). With it, "identity already
   * registered" can name the document that IS registered; without it the
   * message can only say "another document".
   */
  keyLinkedToOtherDocument: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** For errors nothing here recognises — formatRpcError in production. */
  fallback: (err: unknown) => string;
}

// Sentinels whose body is already user-facing French: surface it as-is.
// formatRpcError would replace it with a generic "an error occurred".
// DEVICE_UNSUPPORTED: the Noir prover cannot load on this phone (item 4,
// utils/device-support.ts).
const VERBATIM = /^\[(?:VOTE_INELIGIBLE|CSCA_MISSING|DEVICE_UNSUPPORTED)\]\s*/;

/** Last-resort sentence, used when nothing else produced a usable one. */
const GENERIC_FALLBACK = 'Une erreur est survenue. Veuillez réessayer.';

/**
 * The mapped sentence for a Step 7 failure. NEVER blank.
 *
 * Step 7 renders its spinner and "Vérification en cours…" whenever
 * `errorMessage` is falsy, and gates the report button on the same value, so
 * an empty string here is not a cosmetic detail: it leaves a voter whose vote
 * has just failed on a loading screen for ever, with no message and no way to
 * report (QA Android 2.0.2, item 4.3 — `step7-generic`). Every branch below
 * reads its sentence from a translator that can answer `undefined` (a missing
 * key, an i18n instance that is not up, the `fallback` translator which is a
 * different one from the component's), so the result is normalised here, once,
 * rather than trusted at each of the ten call sites.
 */
export function step7ErrorMessage(err: unknown, ctx: Step7ErrorContext): string {
  const text = mapStep7Error(err, ctx);
  if (typeof text === 'string' && text.trim()) return text;
  const generic = ctx.t('voting.errors.generic', { defaultValue: GENERIC_FALLBACK });
  return typeof generic === 'string' && generic.trim() ? generic : GENERIC_FALLBACK;
}

function mapStep7Error(err: unknown, ctx: Step7ErrorContext): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  if (VERBATIM.test(msg)) return msg.replace(VERBATIM, '').trim();

  // Bound to another key, confirmed by the one re-read. Never claims the key
  // is lost: an earlier attempt or another phone may hold it (item 14 d).
  if (msg.startsWith(REGISTERED_WITH_OTHER_KEY)) {
    return ctx.t(`voting.errors.passportAlreadyBoundOtherKey_${ctx.docSfx}`);
  }

  // Sent, not confirmed in the window (R3): "confirmation en attente", never
  // "non enregistré". Checked before the service-down branch, whose text says
  // the vote "has not been registered yet".
  if (msg.startsWith(REGISTRATION_PENDING) || msg.startsWith(REGISTRATION_OUTCOME_UNKNOWN)) {
    return ctx.t(
      /service-unavailable/.test(msg)
        ? 'voting.errors.registrationPendingServiceDown'
        // Plain French, and it matches the two buttons this state shows:
        // "Relancer le vote" (named in the sentence) and the report button.
        // It says the registration is sent but not confirmed, that the vote
        // is not lost, and what to do — never "not registered".
        // (DECISION-D2 closed by the product owner and the operations lead.)
        : 'voting.errors.registrationPending',
    );
  }

  // The first status read never answered (AV1): nothing was sent, so this is
  // the network message, not "registration service unavailable".
  if (msg.startsWith(STATUS_READ_TIMEOUT)) {
    return ctx.t('voting.errors.network', {
      defaultValue: 'Erreur réseau, vérifiez votre connexion et réessayez.',
    });
  }

  if (msg.startsWith(IDENTITY_BOUND_ELSEWHERE)) {
    return ctx.t(
      ctx.keyLinkedToOtherDocument
        ? `voting.errors.identityBoundToOtherDocument_${ctx.docSfx}`
        : 'voting.errors.identityBoundToOtherDocument_unknown',
    );
  }

  if (msg.startsWith(REGISTRATION_REVERT)) {
    const reason = msg.slice(REGISTRATION_REVERT.length).trim();
    return ctx.t('voting.errors.registrationRefusedOnChain', {
      reason,
      defaultValue: `L'enregistrement a été refusé par la blockchain : ${reason}. Envoyez-nous un rapport d'erreur.`,
    });
  }

  // The prover rejected the witness. Retrying cannot help: since 2026-09-05
  // this is what a circuit built for the old certificate-tree leaf does.
  if (msg.startsWith(PROOF_GENERATION_FAILED)) {
    const detail = msg.slice(PROOF_GENERATION_FAILED.length).trim();
    return ctx.t('voting.errors.proofGenerationFailed', {
      detail,
      defaultValue: `La preuve cryptographique n'a pas pu être générée (${detail}). Réessayer ne changera rien : envoyez-nous un rapport d'erreur.`,
    });
  }

  // Disk-full / OOM (e.g. ENOSPC downloading the ~300 MB trusted setup,
  // 2026-06-11 reports) — a DEVICE problem: "try later" would be wrong advice,
  // and retrying without freeing space cannot succeed. Checked before the
  // service-down branch so it wins.
  if (isStorageFullError(err)) {
    return ctx.t('voting.errors.deviceStorageFull', {
      defaultValue:
        "Espace de stockage insuffisant sur votre appareil. Le vote nécessite le téléchargement d'environ 1 Go de données cryptographiques. Libérez de l'espace puis réessayez.",
    });
  }

  // 5xx / network / confirmation-timeout — a transient SERVER-side failure.
  // After the dry run in utils/relayer-simulation.ts, a relayer 500 that
  // reaches here really is the relayer, not a revert it was hiding.
  if (isServiceUnavailableError(err)) {
    return ctx.t('voting.errors.registrationServiceUnavailable', {
      defaultValue:
        "Le service d'enregistrement est temporairement indisponible. Réessayez plus tard.",
    });
  }

  return ctx.fallback(err);
}
