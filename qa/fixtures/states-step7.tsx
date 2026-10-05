/**
 * Step 7, verification and registration: every sentence it can stop on.
 *
 * Every failure is produced by the real mapping (utils/step7-error-message.ts)
 * from the error the registration pipeline throws: a fake SDK throws it on the
 * first call Step 7 makes (qa/fixtures/data.ts, failingStep7Sdk). No RPC, no
 * prover, no chain.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Step7 from '@/components/voting-modal/Step7';
import {
  IDENTITY_BOUND_ELSEWHERE,
  PROOF_GENERATION_FAILED,
  REGISTERED_WITH_OTHER_KEY,
  REGISTRATION_OUTCOME_UNKNOWN,
  STATUS_READ_TIMEOUT,
  REGISTRATION_PENDING,
  REGISTRATION_REVERT,
} from '@/utils/registration-sentinels';
import { inFlow, QA_LONG_WATCHDOG_MS } from './helpers';
import { failingStep7Sdk, QA_NFC_DATA } from './data';
import type { ExpectedButton, GalleryCtx, GalleryState, TextExpectation } from './types';

const COMPONENT = 'components/voting-modal/Step7.tsx';
const REPORT: ExpectedButton = {
  key: 'errorReport.button',
  action: 'sendErrorReport → consent alert "Envoyer un rapport ?"',
  recorder: 'report',
};
const RESTART: ExpectedButton = {
  key: 'voting.step7RestartVote',
  action: 'onRestart → router.back() + push /voting-flow (clean restart, same question)',
  recorder: 'restart',
};

/** Placeholders a fixture message may carry, turned into the sentence the
 *  pipeline would have put there, in the current language. */
function resolveMessage(t: (k: string) => string, msg: string): string {
  return msg
    .replace(/__UNSUPPORTED_PHONE__/g, t('voting.errors.unsupportedPhone'))
    .replace(/__CSCA__/g, t('voting.errors.cscaNotRegisteredOnMainnet'))
    .replace(/\bvoting\.errors\.[A-Za-z_]+\b/g, (k) => t(k));
}

function Step7State({
  ctx,
  message,
  initError,
  linked,
  withNfcData,
  holdWaiting,
}: {
  ctx: GalleryCtx;
  message?: string;
  initError?: boolean;
  linked?: boolean;
  withNfcData?: boolean;
  holdWaiting?: boolean;
}) {
  const { t } = useTranslation();
  // Built once per state: Step 7 re-runs its effect when these change.
  const sdk = useMemo(() => (message ? failingStep7Sdk(resolveMessage(t, message)) : null), [message, t]);
  const actions = useMemo(
    () => ({
      success: ctx.act('verified', 'step 8 (1.5 s later)'),
      error: ctx.act('step7-error', 'stays on step 7'),
      restart: ctx.act('restart', 'router.back() + push /voting-flow'),
    }),
    [ctx],
  );
  return inFlow(ctx, 7, ({ containerWidth, stepSlideHeight }) => (
    <Step7
      containerWidth={containerWidth}
      slideAreaHeight={stepSlideHeight}
      player={null}
      isActive
      network="mainnet"
      proposalId="qa-901"
      nfcData={withNfcData ? (QA_NFC_DATA as any) : null}
      rarime={sdk?.rarime}
      passport={sdk?.passport}
      attemptKey={sdk?.attemptKey}
      initError={initError ? t('voting.errors.keyResolutionFailed') : null}
      keyLinkedToOtherDocument={linked ?? false}
      missingDataTimeoutMs={holdWaiting ? QA_LONG_WATCHDOG_MS : undefined}
      onSuccess={actions.success}
      onError={actions.error}
      onRestart={actions.restart}
    />
  ));
}

function step7(
  ctx: GalleryCtx,
  opts: { message?: string; initError?: boolean; linked?: boolean; waitForSdk?: boolean },
) {
  return (
    <Step7State
      ctx={ctx}
      message={opts.message}
      initError={opts.initError}
      linked={opts.linked}
      withNfcData={opts.waitForSdk}
      // The waiting state is the state: hold it, instead of letting the 30 s
      // watchdog turn it into step7-missing-data mid-run (QA iPhone, item 3).
      holdWaiting={opts.waitForSdk}
    />
  );
}

function failure(
  id: string,
  trigger: string,
  message: string,
  text: TextExpectation,
  buttons: ExpectedButton[],
  extra: Partial<GalleryState> & { linked?: boolean } = {},
): GalleryState {
  const { linked, ...rest } = extra;
  return {
    id,
    group: 'Vote: step 7 (verification) errors',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger,
    texts: [{ key: 'voting.step7Title' }, text],
    buttons,
    settleMs: 500,
    render: (ctx) => step7(ctx, { message, linked }),
    ...rest,
  };
}

// Step 7 carries the VOTE_INELIGIBLE sentence verbatim: resolveMessage() puts
// the translated sentence in place of the key, as Step 7 does.
const ineligible = (key: string) => `[VOTE_INELIGIBLE] ${key}`;

export const STEP7_STATES: GalleryState[] = [
  {
    id: 'step7-verifying',
    group: 'Vote: step 7 (verification)',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Chip read OK, SDK still initialising. After 30 s without it: step7MissingData (next state; the gallery holds the waiting state, the timeout itself is covered by the jest suite).',
    texts: [{ key: 'voting.step7Title' }, { key: 'voting.step7Verifying' }, { key: 'voting.step7BornOn', params: { date: '12/07/1985' } }],
    buttons: [],
    notes: 'Personal details card (name, birth date, nationality) under the spinner. Other progress lines (step7CheckingStatus, step7Registering, step7Confirming, step7StillConfirming, step7Verified) need the registration pipeline: not in the gallery.',
    render: (ctx) => step7(ctx, { waitForSdk: true }),
  },
  {
    id: 'step7-missing-data',
    group: 'Vote: step 7 (verification) errors',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'SDK / passport / key never arrived: 30 s watchdog (hooks/useMissingDataWatchdog.ts).',
    texts: [{ key: 'voting.step7Title' }, { key: 'voting.step7MissingData_idCard' }],
    buttons: [REPORT],
    settleMs: 32000,
    notes: 'Takes 30 s to appear (real timer).',
    render: (ctx) => step7(ctx, {}),
  },
  {
    id: 'step7-key-resolution-failed',
    group: 'Vote: step 7 (verification) errors',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: "This document's key could not be read on the phone (resolveAttemptKey threw): initError.",
    texts: [{ key: 'voting.step7Title' }, { key: 'voting.errors.keyResolutionFailed' }],
    buttons: [REPORT],
    settleMs: 500,
    render: (ctx) => step7(ctx, { initError: true }),
  },
  failure(
    'step7-other-key',
    'Chain binds the card to another key, confirmed by the one re-read ([REGISTERED_WITH_OTHER_KEY]).',
    `${REGISTERED_WITH_OTHER_KEY} document status after one re-read`,
    { key: 'voting.errors.passportAlreadyBoundOtherKey_idCard' },
    [RESTART],
    { notes: 'Expected refusal: no report button, "Relancer le vote" instead.' },
  ),
  failure(
    'step7-registration-pending',
    'Registration sent, not confirmed in the foreground wait ([REGISTRATION_PENDING]).',
    `${REGISTRATION_PENDING} not confirmed within the wait`,
    { key: 'voting.errors.registrationPending' },
    [REPORT, RESTART],
  ),
  failure(
    'step7-registration-pending-service-down',
    'Pending, and the confirmation reads kept failing with a 5xx ([REGISTRATION_PENDING] service-unavailable).',
    `${REGISTRATION_PENDING} service-unavailable`,
    { key: 'voting.errors.registrationPendingServiceDown' },
    [REPORT, RESTART],
  ),
  failure(
    'step7-registration-outcome-unknown',
    'Registration POST left, answer lost ([REGISTRATION_OUTCOME_UNKNOWN]).',
    `${REGISTRATION_OUTCOME_UNKNOWN} light registrator answer lost`,
    { key: 'voting.errors.registrationPending' },
    [REPORT, RESTART],
    { notes: 'Same sentence as "pending" ("Relancez le vote dans quelques minutes"), with the same "Relancer le vote" button.' },
  ),
  failure(
    'step7-status-read-timeout',
    'The first document-status read never answered, three attempts of 20 s ([STATUS_READ_TIMEOUT], AV1). Nothing proved or sent.',
    `${STATUS_READ_TIMEOUT} getDocumentStatus did not answer within 20 s`,
    { key: 'voting.errors.network' },
    [REPORT, RESTART],
  ),
  failure(
    'step7-identity-bound-other-doc',
    'StateKeeper refused: identity already holds the passport of the same person ([IDENTITY_BOUND_ELSEWHERE], key linked).',
    `${IDENTITY_BOUND_ELSEWHERE} identity already registered`,
    { key: 'voting.errors.identityBoundToOtherDocument_idCard' },
    [REPORT],
    { linked: true },
  ),
  failure(
    'step7-identity-bound-unknown',
    'Same refusal, key not linked to another document on this phone.',
    `${IDENTITY_BOUND_ELSEWHERE} identity already registered`,
    { key: 'voting.errors.identityBoundToOtherDocument_unknown' },
    [REPORT],
  ),
  failure(
    'step7-registration-revert',
    'Relayer dry run reverted ([REGISTRATION_REVERT] <reason>).',
    `${REGISTRATION_REVERT} QA simulated revert`,
    { key: 'voting.errors.registrationRefusedOnChain', params: { reason: 'QA simulated revert' } },
    [REPORT],
  ),
  failure(
    'step7-proof-failed',
    'Noir prover rejected the witness ([PROOF_GENERATION_FAILED] <detail>).',
    `${PROOF_GENERATION_FAILED} register_td1 witness rejected`,
    { key: 'voting.errors.proofGenerationFailed', params: { detail: 'register_td1 witness rejected' } },
    [REPORT],
  ),
  failure(
    'step7-storage-full',
    'ENOSPC / "No space left on device" during registration.',
    'Error: ENOSPC: no space left on device, write',
    { key: 'voting.errors.deviceStorageFull' },
    [REPORT],
  ),
  failure(
    'step7-service-unavailable',
    'Registration relayer 5xx / network failure (isServiceUnavailableError).',
    'relayer 503 : Service Unavailable',
    { key: 'voting.errors.registrationServiceUnavailable' },
    [REPORT],
    { notes: 'Report button forced (forceShow) for service failures.' },
  ),
  failure(
    'step7-unsupported-phone',
    'Prover probe says the phone cannot run the Noir prover ([DEVICE_UNSUPPORTED], utils/device-support.ts).',
    '[DEVICE_UNSUPPORTED] __UNSUPPORTED_PHONE__',
    { key: 'voting.errors.unsupportedPhone' },
    [REPORT],
  ),
  failure(
    'step7-already-voted',
    'This document already voted on this question (one-document check before the proof).',
    ineligible('voting.errors.alreadyVotedThisQuestion'),
    { key: 'voting.errors.alreadyVotedThisQuestion' },
    [],
    { notes: 'isExpectedError matches "déjà voté sur cette question": no report button. EN text does not match the pattern: report button shown in EN.' },
  ),
  failure(
    'step7-other-document-voted',
    'The passport of the same person already voted (second-document guard).',
    ineligible('voting.errors.otherDocumentVoted_passport'),
    { key: 'voting.errors.otherDocumentVoted_passport' },
    [REPORT],
  ),
  failure(
    'step7-other-document-registered',
    'The passport of the same person is already registered (second-document guard).',
    ineligible('voting.errors.otherDocumentRegistered_passport'),
    { key: 'voting.errors.otherDocumentRegistered_passport' },
    [REPORT],
  ),
  failure(
    'step7-other-document-legacy',
    'The passport of the same person is on a legacy key (second-document guard).',
    ineligible('voting.errors.otherDocumentLegacy_passport'),
    { key: 'voting.errors.otherDocumentLegacy_passport' },
    [REPORT],
  ),
  failure(
    'step7-csca-not-registered',
    'CSCA of the document could not be registered on Mainnet.',
    '[CSCA_MISSING] __CSCA__',
    { key: 'voting.errors.cscaNotRegisteredOnMainnet' },
    [REPORT],
  ),
  failure(
    'step7-generic',
    'Anything else: formatRpcError fallback.',
    'QA simulated unexpected failure',
    { key: 'voting.errors.generic' },
    [REPORT],
    { notes: 'formatRpcError picks among voting.errors.* by message; this fixture lands on its generic branch.' },
  ),
];
