/**
 * Step 6, the chip read: every message a failed read can end on.
 *
 * The state is produced by the real path: a simulated native failure
 * (utils/qa-overrides.ts) goes through modules/e-document/index.ts's French
 * rewrite, utils/e-document/scan-error.ts's classification and Step 6's own
 * screens. The automation taps "Analyser" (the prelude) to start the read.
 *
 * Android waits up to 5 s after the step mounts before arming the reader
 * (ANDROID_MIN_GAP_MS), iOS keeps Retry disabled 3 s after a failure: the
 * settle times below cover both.
 */
import React from 'react';
import Step6 from '@/components/voting-modal/Step6';
import { inFlow, WithScan } from './helpers';
import type { ScanScript } from './data';
import type { ExpectedButton, GalleryCtx, GalleryState, TextExpectation } from './types';

const CAN = { kind: 'can', can: '123456' } as const;
const COMPONENT = 'components/voting-modal/Step6.tsx';
const START: GalleryState['prelude'] = [{ tap: { key: 'common.analyze' } }, { wait: 7000 }];

const RETRY: ExpectedButton = { key: 'common.retry', action: 'handleAnalyzePress → new read (Retry)', recorder: 'none' };
const EDIT: ExpectedButton = { key: 'voting.step6EditAccess_idCard', action: 'onGoBack → step 5 (CAN kept)', recorder: 'back' };
const REPORT: ExpectedButton = {
  key: 'errorReport.button',
  action: 'sendErrorReport → consent alert "Envoyer un rapport ?"',
  recorder: 'report',
};

function step6(ctx: GalleryCtx, script: ScanScript | null, accessKey: typeof CAN | null = CAN) {
  // stepSlideHeight, as app/voting-flow.tsx passes it to Step6 since
  // 2026-09-24 (the footer under the Android navigation bar): the gallery
  // must give the step exactly what the flow gives it.
  const body = inFlow(ctx, 6, ({ containerWidth, stepSlideHeight }) => (
    <Step6
      containerWidth={containerWidth}
      slideAreaHeight={stepSlideHeight}
      player={null}
      accessKey={accessKey}
      isActive
      onNFCSuccess={ctx.act('nfc-success', 'step 7 (verification)')}
      onGoBack={ctx.act('back', 'step 5 (CAN kept)')}
    />
  ));
  return script ? <WithScan script={script}>{body}</WithScan> : body;
}

const BASE_TEXTS: TextExpectation[] = [{ key: 'voting.step6Title_idCard' }];
const REMOVE_HINT: TextExpectation = { key: 'voting.step6RemoveBeforeRetry_idCard' };

function failure(
  id: string,
  trigger: string,
  script: ScanScript,
  message: TextExpectation | null,
  buttons: ExpectedButton[],
  extra: Partial<GalleryState> = {},
): GalleryState {
  return {
    id,
    group: 'Vote: step 6 (chip read) errors',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger,
    prelude: START,
    // The "remove the card before Retry" hint shows whenever Retry does.
    texts: [...BASE_TEXTS, ...(message ? [message] : []), ...(buttons.includes(RETRY) ? [REMOVE_HINT] : [])],
    buttons,
    render: (ctx) => step6(ctx, script),
    ...extra,
  };
}

const AFTER_FAILURE: ExpectedButton[] = [RETRY, EDIT, REPORT];

export const STEP6_STATES: GalleryState[] = [
  {
    id: 'step6-idle',
    group: 'Vote: step 6 (chip read)',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Continue on step 5 with a valid CAN.',
    texts: [
      ...BASE_TEXTS,
      { key: 'voting.step6CardTip1' },
      { key: 'voting.step6CardTip2' },
      { key: 'voting.step6CardPress' },
    ],
    buttons: [{ key: 'common.analyze', action: 'handleAnalyzePress → reader armed (Scan en cours…)', recorder: 'none' }],
    notes: 'Tip 3 differs by platform: step6CardTip3_ios / step6CardTip3_android.',
    render: (ctx) => step6(ctx, { kind: 'hang' }),
  },
  {
    id: 'step6-scanning',
    group: 'Vote: step 6 (chip read)',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Reader armed, no chip answering yet (read in progress).',
    prelude: [{ tap: { key: 'common.analyze' } }, { wait: 6000 }],
    texts: [...BASE_TEXTS, { key: 'voting.step6Now_idCard' }],
    buttons: [
      { key: 'voting.step6Scanning', action: 'disabled while scanning', recorder: 'none', disabled: true },
      { key: 'common.cancel', action: 'releaseScan(cancelled) → "Lecture annulée", Retry state', recorder: 'none' },
    ],
    notes: 'Android shows the in-app progress bar; iOS shows the system NFC sheet over the app (not simulated here).',
    render: (ctx) => step6(ctx, { kind: 'hang' }),
  },
  {
    id: 'step6-missing-access',
    group: 'Vote: step 6 (chip read) errors',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Analyser pressed with no access key (CAN lost, defensive).',
    prelude: [{ tap: { key: 'common.analyze' } }],
    texts: [...BASE_TEXTS, { key: 'voting.step6MissingAccess_idCard' }],
    buttons: [
      { ...EDIT, action: 'onGoBack → step 5 (CAN field); shown FIRST, as the main button' },
      { key: 'common.analyze', action: 'handleAnalyzePress (same message again)', recorder: 'none' },
    ],
    render: (ctx) => step6(ctx, null, null),
  },
  failure(
    'step6-timeout',
    'Native "Session timeout" / NFCReaderError 201 / owner timeout → kind timeout.',
    { kind: 'fail', message: 'NFCError: Session timeout (code=201)' },
    { key: 'voting.step6Timeout_idCard', params: { antenna: '{{antenna}}' } },
    AFTER_FAILURE,
    { notes: 'antenna = voting.step6AntennaIos on iOS, voting.step6AntennaAndroid on Android.' },
  ),
  failure(
    'step6-busy',
    'Native "Unknown(System resource unavailable)" or an UnexpectedError < 1 s → kind nfcBusy.',
    { kind: 'fail', message: 'Unknown(System resource unavailable)' },
    { key: 'voting.step6NfcBusy' },
    AFTER_FAILURE,
  ),
  failure(
    'step6-can-rejected',
    'Status word 6982 / "Security status not satisfied" in the card flow → kind canRejected.',
    { kind: 'fail', message: 'Security status not satisfied (6982)' },
    { key: 'voting.step6CanRejected' },
    [
      { ...EDIT, action: 'onGoBack → step 5 (CAN kept); shown FIRST, as the main button' },
      RETRY,
      REPORT,
    ],
  ),
  failure(
    'step6-contact-lost',
    'Native "Tag was lost" / "Tag connection lost" → kind contactLost.',
    { kind: 'fail', message: 'Tag was lost' },
    { key: 'voting.step6TagLostError' },
    AFTER_FAILURE,
  ),
  failure(
    'step6-interrupted',
    'Native UnexpectedError between 1 s and 55 s after arming → kind interrupted.',
    { kind: 'fail', message: 'NFCPassportReaderError.UnexpectedError', delayMs: 1500 },
    { key: 'voting.step6UnexpectedError' },
    AFTER_FAILURE,
  ),
  failure(
    'step6-unsupported-device',
    'Native "NFCNotSupported" (iPad that got past step 4) → kind nfcUnsupported.',
    { kind: 'fail', message: 'NFCNotSupported' },
    { key: 'voting.nfcUnsupportedDevice' },
    AFTER_FAILURE,
  ),
  failure(
    'step6-cancelled',
    'User tapped Annuler on the iOS NFC sheet ("UserCanceled") → kind userCancelled.',
    { kind: 'fail', message: 'UserCanceled' },
    { key: 'voting.step6Cancelled' },
    [RETRY, EDIT],
    { notes: 'No report button: nothing to report.' },
  ),
  failure(
    'step6-read-failed',
    'Any other native error → kind generic.',
    { kind: 'fail', message: 'QA simulated unclassified failure' },
    { key: 'voting.step6ReadFailed_idCard' },
    AFTER_FAILURE,
  ),
  failure(
    'step6-translated-pace-im',
    'Native "IM not yet implemented" (PACE-IM card): French text written by modules/e-document/index.ts → kind translated.',
    { kind: 'fail', message: 'PACE Step2IM: IM not yet implemented' },
    null,
    AFTER_FAILURE,
    {
      notes: 'Text is hard-coded French in modules/e-document/index.ts ("❌ Méthode PACE non supportée…"), not in fr.json: shown in French in the EN app too. Classified as wrongDocument first when it carries ID-card signals in the passport flow.',
    },
  ),
  failure(
    'step6-wrong-doc-suspected',
    'Native text with passport signals ("ISO14443-B", "PACE not supported") in the card flow → kind wrongDocument (guess).',
    { kind: 'fail', message: 'PACE not supported by this chip (ISO14443-B)' },
    { key: 'voting.step6PassportDetected' },
    [
      { key: 'voting.step6RestartWithCorrectDoc', action: 'onGoBack → step 5', recorder: 'back' },
      RETRY,
      EDIT,
      REPORT,
    ],
    { prelude: START },
  ),
  failure(
    'step6-wrong-doc-confirmed',
    'Read succeeded but DG1 is 93 bytes (a passport) in the card flow: mismatch proven.',
    { kind: 'succeed', dg1Length: 93 },
    { key: 'voting.step6PassportDetected' },
    [{ key: 'voting.step6RestartWithCorrectDoc', action: 'onGoBack → step 5', recorder: 'back' }],
    { notes: 'Retry and Edit hidden: the banner button is the only action.' },
  ),
  failure(
    'step6-dg1-corrupt',
    'Read succeeded but DG1 is neither 95 nor 93 bytes.',
    { kind: 'succeed', dg1Length: 12 },
    { key: 'voting.step6ReadError' },
    [RETRY, EDIT],
  ),
  failure(
    'step6-success',
    'Read succeeded with a 95-byte DG1: hand-off to step 7 after 500 ms.',
    { kind: 'succeed', dg1Length: 95 },
    { key: 'voting.step6ReadSuccess' },
    [{ key: 'common.analyze', action: 'disabled during the 500 ms hand-off', recorder: 'none', disabled: true }],
    { notes: 'The hand-off is recorded (QA ▸ step 7) 500 ms after the read. "Lancer l\'analyse" is disabled meanwhile, so a tap can no longer start a new read and drop the hand-off.' },
  ),
  {
    id: 'step6-nfc-disabled-alert',
    group: 'Vote: step 6 (chip read) errors',
    component: COMPONENT,
    frame: 'alert',
    runtime: 'manual',
    doc: 'idCard',
    trigger: 'Android only: NFC switched off in the system settings, Analyser pressed.',
    texts: [{ key: 'voting.step6NfcDisabledTitle' }, { key: 'voting.step6NfcDisabledMessage' }],
    buttons: [
      { key: 'common.cancel', action: 'closes the alert', recorder: 'none' },
      { key: 'voting.step6OpenNfcSettings', action: 'Linking.sendIntent(NFC_SETTINGS); scan restarts on return', recorder: 'none' },
    ],
    notes: 'Reproducible by hand (turn NFC off). Not simulated: the gallery does not stub NfcManager.',
  },
  {
    id: 'step6-invalid-mrz',
    group: 'Vote: step 6 (chip read) errors',
    component: COMPONENT,
    frame: 'flow',
    runtime: 'dormant',
    doc: 'passport',
    trigger: 'Passport flow, native InvalidMRZKey: message then back to the MRZ form after 1.5 s.',
    texts: [{ key: 'voting.step6InvalidMrz' }],
    buttons: [],
  },
];
