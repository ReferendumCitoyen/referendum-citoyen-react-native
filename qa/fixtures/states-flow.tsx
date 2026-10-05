/**
 * Voting flow, steps 1 to 5 and 8 to 11: the happy path screens and the
 * refusals they carry. Steps 6, 7, 12 and 13 have files of their own.
 */
import React from 'react';
import Step1 from '@/components/voting-modal/Step1';
import Step2 from '@/components/voting-modal/Step2';
import Step4 from '@/components/voting-modal/Step4';
import Step5Can from '@/components/voting-modal/Step5Can';
import Step8 from '@/components/voting-modal/Step8';
import Step9Vote from '@/components/voting-modal/Step9Vote';
import Step10 from '@/components/voting-modal/Step10';
import Step11 from '@/components/voting-modal/Step11';
import DocumentChoice from '@/components/voting-modal/DocumentChoice';
import { inFlow, QA_LONG_WATCHDOG_MS } from './helpers';
import { VOTED_PROPOSAL } from './data';
import type { GalleryState } from './types';

export const FLOW_STATES: GalleryState[] = [
  {
    id: 'flow-doc-choice',
    group: 'Vote: document choice',
    component: 'components/voting-modal/DocumentChoice.tsx',
    frame: 'flow',
    runtime: 'dormant',
    trigger: 'Entry of the flow when CARD_ONLY_LAUNCH is false. 2.0.2 ships CARD_ONLY_LAUNCH = true: never shown.',
    texts: [{ key: 'voting.documentChoiceTitle' }, { key: 'voting.documentChoiceDescription' }],
    buttons: [
      { key: 'voting.documentChoiceIdCardTitle', action: 'onSelect(false) → ID card flow, step 1', recorder: 'select-idcard' },
      { key: 'voting.documentChoicePassportTitle', action: 'onSelect(true) → passport flow, step 1', recorder: 'select-passport' },
    ],
    render: (ctx) =>
      inFlow(ctx, 0, ({ slideAreaHeight }) => (
        <DocumentChoice
          slideAreaHeight={slideAreaHeight}
          onSelect={(isPassport) =>
            isPassport ? ctx.act('select-passport', 'passport flow, step 1')() : ctx.act('select-idcard', 'ID card flow, step 1')()
          }
        />
      )),
  },
  {
    id: 'flow-step1',
    group: 'Vote: steps 1-2 (explanations)',
    component: 'components/voting-modal/Step1.tsx',
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Tap "Voter" on a home card (ID card flow).',
    texts: [{ key: 'voting.title', platform: 'android' }, { key: 'voting.step1Title_idCard' }, { key: 'voting.step1Description' }],
    buttons: [{ key: 'common.next', testID: 'qa-flow-next', action: 'handleNext → step 2', recorder: 'next' }],
    render: (ctx) =>
      inFlow(ctx, 1, ({ containerWidth, slideAreaHeight }) => (
        <Step1 containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} />
      ), 'step 2'),
  },
  {
    id: 'flow-step2',
    group: 'Vote: steps 1-2 (explanations)',
    component: 'components/voting-modal/Step2.tsx',
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Arrow on step 1.',
    texts: [{ key: 'voting.title', platform: 'android' }, { key: 'voting.step2Title' }, { key: 'voting.step2Description_idCard' }],
    buttons: [{ key: 'common.next', testID: 'qa-flow-next', action: 'handleNext → step 4 (step 3 removed)', recorder: 'next' }],
    render: (ctx) =>
      inFlow(ctx, 2, ({ containerWidth, slideAreaHeight }) => (
        <Step2 containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} />
      ), 'step 4'),
  },
  {
    id: 'flow-step4',
    group: 'Vote: step 4 (start)',
    component: 'components/voting-modal/Step4.tsx',
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Arrow on step 2, NFC reader present or unknown.',
    texts: [{ key: 'voting.step4Title_idCard' }],
    buttons: [{ key: 'voting.step4Start', action: 'onStartAnalysis → step 5 (CAN)', recorder: 'start' }],
    render: (ctx) =>
      inFlow(ctx, 4, ({ containerWidth, stepSlideHeight }) => (
        <Step4
          player={null}
          containerWidth={containerWidth}
          slideAreaHeight={stepSlideHeight}
          onStartAnalysis={ctx.act('start', 'step 5 (CAN)')}
        />
      )),
  },
  {
    id: 'flow-step4-no-nfc',
    group: 'Vote: step 4 (start)',
    component: 'components/voting-modal/Step4.tsx',
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'checkNfcHardware() === false (every iPad, phones without NFC): nfcUnsupported prop.',
    texts: [{ key: 'voting.step4Title_idCard' }, { key: 'voting.nfcUnsupportedDevice' }],
    buttons: [{ key: 'common.backToHome', action: 'onExit → handleClose (flow closed)', recorder: 'close' }],
    notes: 'No start button. "Retour à l\'écran d\'accueil" is the way out on both platforms (Android has no header on this step).',
    render: (ctx) =>
      inFlow(ctx, 4, ({ containerWidth, stepSlideHeight }) => (
        <Step4
          player={null}
          containerWidth={containerWidth}
          slideAreaHeight={stepSlideHeight}
          onStartAnalysis={ctx.act('start')}
          nfcUnsupported
          onExit={ctx.act('close', 'handleClose (flow closed)')}
        />
      )),
  },
  {
    id: 'flow-step5-can',
    group: 'Vote: step 5 (CAN)',
    component: 'components/voting-modal/Step5Can.tsx',
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: '"Démarrer l\'analyse" on step 4 (ID card).',
    texts: [
      { key: 'voting.step5CanTitle' },
      { key: 'voting.step5CanCaption' },
      { key: 'mrzManual.docTypeNotice_idCard' },
      { key: 'voting.step5CanLabel' },
      { key: 'voting.step5CanHint' },
    ],
    buttons: [{ key: 'common.continue', action: 'disabled until 6 digits', recorder: 'can', disabled: true }],
    render: (ctx) =>
      inFlow(ctx, 5, ({ containerWidth, stepSlideHeight }) => (
        <Step5Can containerWidth={containerWidth} slideAreaHeight={stepSlideHeight} isActive onSubmit={ctx.act('can', 'step 6 (chip read)')} />
      )),
  },
  {
    id: 'flow-step5-can-filled',
    group: 'Vote: step 5 (CAN)',
    component: 'components/voting-modal/Step5Can.tsx',
    frame: 'flow',
    runtime: 'gallery',
    doc: 'idCard',
    trigger: 'Six digits typed in the CAN field.',
    // The field, not its label: tapping the label "Numéro CAN (6 chiffres)"
    // focuses nothing on iPhone, so the six digits went nowhere, the button
    // stayed disabled and the flow failed on "Continuer, enabled is visible"
    // (QA iPhone 2.0.2). The placeholder belongs to the input alone; the same
    // trick the "Vérifier" screen's field already uses.
    prelude: [{ type: '123456', into: { key: 'voting.step5CanPlaceholder' } }],
    texts: [{ key: 'voting.step5CanTitle' }, { key: 'voting.step5CanLabel' }],
    buttons: [{ key: 'common.continue', action: 'onSubmit(can) → step 6 (chip read)', recorder: 'can' }],
    notes: 'Keyboard open: on iPhone SE the Continue button must stay reachable above the keyboard (the keyboard inset is added inside the ScrollView, hooks/useKeyboardInset.ts).',
    render: (ctx) =>
      inFlow(ctx, 5, ({ containerWidth, stepSlideHeight }) => (
        <Step5Can containerWidth={containerWidth} slideAreaHeight={stepSlideHeight} isActive onSubmit={ctx.act('can', 'step 6 (chip read)')} />
      )),
  },
  {
    id: 'flow-step5-passport-mrz',
    group: 'Vote: step 5 (CAN)',
    component: 'components/voting-modal/Step5.tsx, ManualMRZInput.tsx',
    frame: 'flow',
    runtime: 'dormant',
    doc: 'passport',
    trigger: 'Passport flow: MRZ form and camera. Behind CARD_ONLY_LAUNCH in 2.0.2.',
    texts: [{ key: 'voting.step5Title_passport' }],
    buttons: [],
  },
  {
    id: 'flow-step8-ready',
    group: 'Vote: steps 8-11 (ballot)',
    component: 'components/voting-modal/Step8.tsx',
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Step 7 verified (verificationResult = success), 1.5 s after "Vérification réussie".',
    texts: [{ key: 'voting.step8Ready' }],
    buttons: [{ key: 'voting.step8VoteNow', action: 'onVoteSuccess → step 9 (ballot)', recorder: 'vote-now' }],
    render: (ctx) =>
      inFlow(ctx, 8, ({ containerWidth }) => (
        <Step8 containerWidth={containerWidth} verificationResult="success" onVoteSuccess={ctx.act('vote-now', 'step 9 (ballot)')} onRestart={ctx.act('restart')} />
      )),
  },
  {
    id: 'flow-step8-not-verified',
    group: 'Vote: steps 8-11 (ballot)',
    component: 'components/voting-modal/Step8.tsx',
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Step 8 reached without a verified registration (fallback for the 2026-06 step-skip reports).',
    texts: [{ key: 'voting.step8NotVerifiedTitle' }, { key: 'voting.step8NotVerifiedDescription' }],
    buttons: [{ key: 'voting.step8Restart', action: 'onRestart → router.back() + push /voting-flow (same question)', recorder: 'restart' }],
    render: (ctx) =>
      inFlow(ctx, 8, ({ containerWidth }) => (
        <Step8 containerWidth={containerWidth} verificationResult={null} onVoteSuccess={ctx.act('vote-now')} onRestart={ctx.act('restart', 'router.back() + push /voting-flow')} />
      )),
  },
  {
    id: 'flow-step9-ballot',
    group: 'Vote: steps 8-11 (ballot)',
    component: 'components/voting-modal/Step9Vote.tsx',
    frame: 'flow',
    runtime: 'gallery',
    trigger: '"Votez maintenant" on step 8.',
    texts: [],
    buttons: [
      { text: 'Oui', action: 'onVoteSelect(0) → step 10', recorder: 'select' },
      { text: 'Non', action: 'onVoteSelect(1) → step 10', recorder: 'select' },
      { text: 'Blanc', action: 'onVoteSelect(2) → step 10', recorder: 'select' },
      { text: 'Je refuse de voter', action: 'onVoteSelect(3) → step 10', recorder: 'select' },
      { key: 'common.cancel', action: 'onCancel → router.back() (flow closed)', recorder: 'cancel' },
    ],
    notes: 'The question title is the proposal title (long French fixture on purpose).',
    render: (ctx) =>
      inFlow(ctx, 9, ({ containerWidth, stepSlideHeight }) => (
        <Step9Vote containerWidth={containerWidth} slideAreaHeight={stepSlideHeight} proposalInfo={VOTED_PROPOSAL} onVoteSelect={ctx.act('select', 'step 10')} onCancel={ctx.act('cancel', 'router.back()')} />
      )),
  },
  {
    id: 'flow-step10-confirm',
    group: 'Vote: steps 8-11 (ballot)',
    component: 'components/voting-modal/Step10.tsx',
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'An answer tapped on step 9.',
    texts: [{ key: 'voting.step10Confirm', params: { vote: 'OUI' } }],
    buttons: [
      { key: 'common.cancel', action: 'onCancel → router.back() (flow closed)', recorder: 'cancel' },
      { key: 'voting.step10VoteAction', params: { vote: 'Oui' }, action: 'onConfirm → step 11 (proof and vote)', recorder: 'confirm' },
    ],
    render: (ctx) =>
      inFlow(ctx, 10, ({ containerWidth, stepSlideHeight }) => (
        <Step10 containerWidth={containerWidth} slideAreaHeight={stepSlideHeight} player={null} selectedVote={0} proposalInfo={VOTED_PROPOSAL} onCancel={ctx.act('cancel', 'router.back()')} onConfirm={ctx.act('confirm', 'step 11')} />
      )),
  },
  {
    id: 'flow-step11-preparing',
    group: 'Vote: steps 8-11 (ballot)',
    component: 'components/voting-modal/Step11.tsx',
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Step 11 active before the SDK refs arrive. After 15 s without them: onError(missing-data) → step 13 (the gallery holds the waiting state; the timeout itself is covered by the jest suite).',
    texts: [{ key: 'voting.step11Preparing' }],
    buttons: [],
    notes: 'Other status lines of this screen (step11GeneratingProof, step11DownloadingData, step11FinalizingData, step11Confirming) need the prover: not in the gallery.',
    render: (ctx) =>
      inFlow(ctx, 11, ({ containerWidth, stepSlideHeight }) => (
        <Step11 containerWidth={containerWidth} slideAreaHeight={stepSlideHeight} isActive missingDataTimeoutMs={QA_LONG_WATCHDOG_MS} onSuccess={ctx.act('vote-sent')} onError={ctx.act('vote-error', 'step 13 (missing-data)')} />
      )),
  },
];

