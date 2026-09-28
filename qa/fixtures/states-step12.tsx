/**
 * Step 12 (vote sent) and step 13 (vote failed).
 *
 * Step 13's props are built exactly as app/voting-flow.tsx's
 * handleStep11Error builds them from a vote-error table code
 * (utils/vote-error-table.ts): the reason is voteErrorMessage(t, code, doc),
 * Retry is offered when the entry is retryable, the report button follows
 * `reportable`. One state per code (and per document where the text names it).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import Step12Success from '@/components/voting-modal/Step12Success';
import Step12Error from '@/components/voting-modal/Step12Error';
import {
  VOTE_ERROR_TABLE,
  voteErrorKey,
  voteErrorMessage,
  VoteRefusal,
  type VoteErrorCode,
} from '@/utils/vote-error-table';
import { inFlow, WithProposalCache } from './helpers';
import { NEXT_PROPOSAL, QA_VOTE_TX, VOTED_PROPOSAL } from './data';
import type { ExpectedButton, GalleryCtx, GalleryState } from './types';

const SUCCESS = 'components/voting-modal/Step12Success.tsx';
const ERROR = 'components/voting-modal/Step12Error.tsx';

// ---------------------------------------------------------------------------
// Step 12: vote sent
// ---------------------------------------------------------------------------

function success(
  ctx: GalleryCtx,
  props: Partial<React.ComponentProps<typeof Step12Success>>,
) {
  return inFlow(ctx, 12, ({ containerWidth, stepSlideHeight }) => (
    <Step12Success
      containerWidth={containerWidth}
      slideAreaHeight={stepSlideHeight}
      voteIdentifier={QA_VOTE_TX}
      confirmed
      proposalInfo={VOTED_PROPOSAL}
      answerIndex={0}
      network="mainnet"
      isPassportFlow={false}
      onVoteAnother={ctx.act('vote-another', 'router.back() + push /voting-flow (other question)')}
      onVerify={ctx.act('verify', "router.replace('/verifier')")}
      onClose={ctx.act('close', 'router.back()')}
      onBackupKey={ctx.act('backup', "router.replace('/key-management')")}
      {...props}
    />
  ));
}

const CONTACT: ExpectedButton = { key: 'settings.contact', action: 'openContactEmail → mail composer (or mailto:)', recorder: 'mail', noTapInAutomation: true };
const CONTRIBUTE: ExpectedButton = { key: 'voting.step12ContributeCta', action: 'Linking.openURL(CONTRIBUTE_URL) → website', recorder: 'link', noTapInAutomation: true };
const COPY: ExpectedButton = { key: 'voting.step12VoteIdCopy', action: 'Clipboard.setStringAsync(serial) → label "Copié"', recorder: 'clipboard' };
const VERIFY: ExpectedButton = { key: 'voting.step12VerifyLink', action: "onVerify → router.replace('/verifier')", recorder: 'verify' };
const CLOSE_ANDROID: ExpectedButton = {
  key: 'common.close',
  action: 'onClose → router.back() (Android only; iOS uses the header "Fermer")',
  recorder: 'close',
  platform: 'android',
};
const SUCCESS_REPORT: ExpectedButton = {
  key: 'errorReport.successButton',
  action: 'prepareSuccessReport + sendErrorReport → consent alert (with the vote proof attachment)',
  recorder: 'report',
  betaOnly: true,
};

export const STEP12_SUCCESS_STATES: GalleryState[] = [
  {
    id: 'step12-confirmed',
    group: 'Vote: step 12 (vote sent)',
    component: SUCCESS,
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Vote mined with status 1 (confirmed = true).',
    texts: [
      { key: 'voting.step12ThanksTitle' },
      { key: 'voting.step12ThanksBody' },
      { key: 'voting.step12ContributeBody' },
      { key: 'voting.step12SuccessTitle' },
      { key: 'voting.step12ResultsTitle' },
    ],
    buttons: [CONTACT, SUCCESS_REPORT, CONTRIBUTE, COPY, VERIFY, CLOSE_ANDROID],
    notes: 'Beta app only: "Envoyer le rapport du vote réussi" (SuccessReportButton) under the thank-you. Results bars include the voter\'s own +1.',
    render: (ctx) => success(ctx, {}),
  },
  {
    id: 'step12-confirmed-backup',
    group: 'Vote: step 12 (vote sent)',
    component: SUCCESS,
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Confirmed vote right after a FIRST registration of the document (justRegistered).',
    texts: [
      { key: 'voting.step12SuccessTitle' },
      // Keys absent from both locale files: the component's French defaultValue shows (in EN too).
      { key: 'voting.step12BackupTitle', params: { defaultValue: 'Sauvegardez votre accès' } },
      {
        key: 'voting.step12BackupBody',
        params: {
          defaultValue:
            'Votre pièce d’identité est désormais liée à une clé conservée sur ce téléphone. ' +
            'Si vous changez d’appareil ou réinstallez l’application sans sauvegarde, ' +
            'vous ne pourrez plus voter avec cette pièce.',
        },
      },
    ],
    buttons: [
      CONTACT,
      SUCCESS_REPORT,
      CONTRIBUTE,
      COPY,
      { key: 'voting.step12BackupCta', params: { defaultValue: 'Sauvegarder maintenant' }, action: "onBackupKey → router.replace('/key-management')", recorder: 'backup' },
      VERIFY,
      CLOSE_ANDROID,
    ],
    render: (ctx) => success(ctx, { justRegistered: true }),
  },
  {
    id: 'step12-pending',
    group: 'Vote: step 12 (vote sent)',
    component: SUCCESS,
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Vote submitted, receipt not confirmed within the wait (confirmed = false): "confirmation en attente".',
    texts: [{ key: 'voting.step12PendingTitle' }],
    buttons: [COPY, VERIFY, CLOSE_ANDROID],
    notes: 'No thank-you, no contribution card, no results (they cannot include a vote not yet mined).',
    render: (ctx) => success(ctx, { confirmed: false }),
  },
  {
    id: 'step12-pending-no-serial',
    group: 'Vote: step 12 (vote sent)',
    component: SUCCESS,
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Pending with no transaction hash (Step 11 onSuccess("", false)).',
    texts: [{ key: 'voting.step12PendingTitle' }],
    buttons: [VERIFY, CLOSE_ANDROID],
    render: (ctx) => success(ctx, { confirmed: false, voteIdentifier: undefined }),
  },
  {
    id: 'step12-suggestion',
    group: 'Vote: step 12 (vote sent)',
    component: SUCCESS,
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'Confirmed vote and another question this document may vote (pickNextProposal, same eligibility rule as the home).',
    texts: [{ key: 'voting.step12SuccessTitle' }, { key: 'voting.step12NextLabel' }, { key: 'home.badgeOngoing' }],
    buttons: [
      CONTACT,
      SUCCESS_REPORT,
      CONTRIBUTE,
      COPY,
      { key: 'home.voteButton', action: 'onVoteAnother(id) → router.back() + push /voting-flow (other question)', recorder: 'vote-another' },
      VERIFY,
      CLOSE_ANDROID,
    ],
    notes: "The gallery puts two fixture questions in the home's Mainnet proposal cache while the state is shown, and restores the cache after (devAllowed waives the index listing).",
    render: (ctx) => (
      <WithProposalCache list={[VOTED_PROPOSAL, NEXT_PROPOSAL]}>{success(ctx, { devAllowed: true })}</WithProposalCache>
    ),
  },
];

// ---------------------------------------------------------------------------
// Step 13: vote failed (Step12Error)
// ---------------------------------------------------------------------------

function ErrorState({ ctx, code, doc }: { ctx: GalleryCtx; code: VoteErrorCode; doc: 'idCard' | 'passport' }) {
  const { t } = useTranslation();
  const entry = VOTE_ERROR_TABLE[code];
  const reason = voteErrorMessage(t, code, doc);
  return inFlow(ctx, 13, ({ containerWidth, stepSlideHeight }) => (
    <Step12Error
      containerWidth={containerWidth}
      slideAreaHeight={stepSlideHeight}
      onGoHome={ctx.act('home', 'router.back() (flow closed)')}
      onRetry={entry.retryable ? ctx.act('retry', 'step 11 (vote only, new proof)') : undefined}
      errorReason={reason}
      error={new VoteRefusal(code)}
      isPassportFlow={doc === 'passport'}
      reportable={entry.reportable}
    />
  ));
}

const TRIGGERS: Record<VoteErrorCode, string> = {
  'already-voted': 'Relayer / contract: "already voted", "nullifier already used".',
  'ineligible-minor': 'Birth date above the upper bound (under 18), local check or relayer.',
  'ineligible-age-limit': 'Birth date below the lower bound.',
  'ineligible-citizenship': 'Nationality not in the whitelist.',
  'ineligible-document-rule': '[VOTE_INELIGIBLE] with no more specific cause.',
  'other-key': 'Relayer "profile key mismatch".',
  'unsupported-document': 'Proposal contract does not take this document (wrong-document) or "TD3 voting is not supported".',
  'question-closed': 'Index marks the question closed, or "proposal closed / not active".',
  'not-started': 'Before the start date (local check or "voting has not started").',
  ended: 'After the end date (local check or "voting has ended").',
  'not-available': 'Question not listed / unknown contract / several questions / unknown rules in this app version.',
  'app-outdated': 'Installed version below min_supported_app_versions of the signed index.',
  'relayer-forbidden': 'Vote relayer answered 403.',
  'relayer-server': 'Vote relayer answered 5xx before the POST could have been forwarded.',
  network: 'Transport failure before the vote POST left the phone.',
  'outcome-unknown': 'Transport failure or 502-504 AFTER the vote POST may have left (VOTE_POST_SENT).',
  'outcome-still-unknown': 'Retry of an unknown outcome: status still not readable.',
  'rejected-opaque': 'Relayer 400 with no locally established cause.',
  'rejected-date-rollover': 'Relayer 400 and the UTC date changed between the proof and the error.',
  'prover-incompatible': 'Pairing failure 0xd71fd263 / PAIRING_FAILED.',
  'storage-full': 'ENOSPC while downloading or proving.',
  'download-failed': 'Circuit / zkey download failed.',
  'missing-data': 'Step 11 active 15 s without SDK refs.',
  reverted: 'Vote transaction mined and reverted.',
  unknown: 'Anything else.',
};

function errorButtons(code: VoteErrorCode): ExpectedButton[] {
  const entry = VOTE_ERROR_TABLE[code];
  const out: ExpectedButton[] = [];
  if (entry.reportable) {
    out.push({ key: 'errorReport.button', action: 'sendErrorReport → consent alert "Envoyer un rapport ?"', recorder: 'report' });
  }
  if (entry.retryable) {
    out.push({ key: 'voting.step12ErrorRetry', action: 'onRetry → step 11 (vote only, new proof)', recorder: 'retry' });
  }
  out.push({ key: 'common.backToHome', action: 'onGoHome → router.back() (flow closed)', recorder: 'home' });
  return out;
}

function errorState(code: VoteErrorCode, doc: 'idCard' | 'passport'): GalleryState {
  const entry = VOTE_ERROR_TABLE[code];
  const suffix = entry.perDocument ? `-${doc === 'idCard' ? 'idcard' : 'passport'}` : '';
  return {
    id: `step13-${code}${suffix}`,
    group: 'Vote: step 13 (vote failed)',
    component: ERROR,
    frame: 'flow',
    runtime: doc === 'passport' ? 'dormant' : 'gallery',
    doc,
    trigger: `${TRIGGERS[code]} Code "${code}": ${entry.severity}, retry ${entry.retryable ? 'yes' : 'no'}, report ${entry.reportable ? 'yes' : 'no'}.`,
    texts: [{ key: 'voting.step12ErrorTitle' }, { key: voteErrorKey(code, doc) }],
    buttons: errorButtons(code),
    render: (ctx) => <ErrorState ctx={ctx} code={code} doc={doc} />,
  };
}

const CODES = Object.keys(VOTE_ERROR_TABLE) as VoteErrorCode[];

export const STEP13_STATES: GalleryState[] = [
  ...CODES.map((code) => errorState(code, 'idCard')),
  // The passport wording, for the codes whose text names the document. The
  // passport flow is dormant in 2.0.2 (CARD_ONLY_LAUNCH): listed, and still
  // rendered by the jest suite so its keys stay checked.
  ...CODES.filter((c) => VOTE_ERROR_TABLE[c].perDocument).map((code) => errorState(code, 'passport')),
  {
    id: 'step13-no-reason',
    group: 'Vote: step 13 (vote failed)',
    component: ERROR,
    frame: 'flow',
    runtime: 'gallery',
    trigger: 'onError called with no reason and no code (legacy caller): generic description, retry decided by isTerminalVoteError().',
    texts: [{ key: 'voting.step12ErrorTitle' }, { key: 'voting.step12ErrorDescription' }],
    buttons: [
      { key: 'voting.step12ErrorRetry', action: 'onRetry → step 11 (vote only, new proof)', recorder: 'retry' },
      { key: 'common.backToHome', action: 'onGoHome → router.back() (flow closed)', recorder: 'home' },
    ],
    render: (ctx) =>
      inFlow(ctx, 13, ({ containerWidth, stepSlideHeight }) => (
        <Step12Error
          containerWidth={containerWidth}
          slideAreaHeight={stepSlideHeight}
          onGoHome={ctx.act('home', 'router.back() (flow closed)')}
          onRetry={ctx.act('retry', 'step 11 (vote only, new proof)')}
          errorReason={null}
        />
      )),
  },
];
