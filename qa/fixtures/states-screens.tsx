/**
 * Outside the vote flow: home banners, report consent alert, Settings,
 * Vérifier, key management, the root error screen.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, Typography } from '@/constants/theme';
import UpdateNoticeBanner from '@/components/UpdateNoticeBanner';
import { resolveAppBanner, type AppBanner } from '@/utils/update-notice';
import { confirmReportConsent } from '@/utils/report-consent';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import ParametresScreen from '@/app/parametres';
import VerifierScreen from '@/app/(tabs)/verifier';
import KeyManagementScreen from '@/app/key-management';
import { recordAction } from './recorder';
import type { ExpectedButton, GalleryCtx, GalleryState } from './types';

// ---------------------------------------------------------------------------
// Home banners
// ---------------------------------------------------------------------------

/** The banner where the home puts it: under the screen title, over the list. */
function HomeBanner({ ctx, banner }: { ctx: GalleryCtx; banner: Exclude<AppBanner, null> }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 16 }}>
      <Text style={[styles.homeTitle, { color: colors.text }]}>Accueil (QA stub)</Text>
      <UpdateNoticeBanner
        banner={banner}
        onDismiss={banner.kind === 'recommended' ? ctx.act('dismiss', 'banner hidden, dismissal stored for this version') : undefined}
        onUpdate={ctx.act('store', 'Linking.openURL(store page)')}
      />
      <View style={[styles.cardStub, { backgroundColor: colors.cardBackground }]} />
    </View>
  );
}

const UPDATE: ExpectedButton = { key: 'home.updateButton', action: 'onUpdate → Linking.openURL(STORE_URLS[platform])', recorder: 'store' };

const COMPONENT_BANNER = 'components/UpdateNoticeBanner.tsx, app/(tabs)/index.tsx';

export const HOME_STATES: GalleryState[] = [
  {
    id: 'home-banner-recommended',
    group: 'Home: app-version banner',
    component: COMPONENT_BANNER,
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Installed version < recommended_app_versions[platform] of the signed index, and >= the minimum; not dismissed for this version. Green.',
    texts: [{ key: 'home.updateRecommendedTitle' }, { key: 'home.updateRecommendedBody', params: { version: '2.0.3' } }],
    buttons: [UPDATE, { key: 'common.close', action: 'onDismiss (✕) → hidden; stored per recommended version', recorder: 'dismiss' }],
    notes: 'Priority (resolveAppBanner): unsupported phone > required (red) > recommended (green). Vote buttons stay.',
    render: (ctx) => <HomeBanner ctx={ctx} banner={{ kind: 'recommended', version: '2.0.3' }} />,
  },
  {
    id: 'home-banner-required',
    group: 'Home: app-version banner',
    component: COMPONENT_BANNER,
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Installed version < min_supported_app_versions[platform]. Red, not dismissible; Vote buttons hidden (vote-eligibility app-outdated).',
    texts: [{ key: 'home.updateRequiredTitle' }, { key: 'home.updateRequiredBody', params: { min: '2.0.2' } }],
    buttons: [UPDATE],
    render: (ctx) => <HomeBanner ctx={ctx} banner={{ kind: 'required', min: '2.0.2' }} />,
  },
  {
    id: 'home-banner-unsupported',
    group: 'Home: app-version banner',
    component: COMPONENT_BANNER,
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Prover probe: Noir library missing on this phone (32-bit Android), utils/device-support.ts. Orange (warning palette), not dismissible, no update link.',
    texts: [{ key: 'home.unsupportedPhoneTitle' }, { key: 'home.unsupportedPhoneBody' }],
    buttons: [],
    notes: 'Uses the warning (orange) palette, not red.',
    render: (ctx) => <HomeBanner ctx={ctx} banner={{ kind: 'unsupported' }} />,
  },
  {
    id: 'home-banner-priority',
    group: 'Home: app-version banner',
    component: COMPONENT_BANNER,
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Unsupported phone AND below the minimum AND below the recommended version at once: resolveAppBanner returns the unsupported banner only.',
    texts: [{ key: 'home.unsupportedPhoneTitle' }],
    buttons: [],
    render: (ctx) => {
      const banner = resolveAppBanner({
        current: '2.0.0',
        min: '2.0.2',
        recommended: '2.0.3',
        dismissedRecommended: null,
        deviceUnsupported: true,
      });
      return <HomeBanner ctx={ctx} banner={banner ?? { kind: 'unsupported' }} />;
    },
  },
  {
    id: 'home-banner-required-over-recommended',
    group: 'Home: app-version banner',
    component: COMPONENT_BANNER,
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Below the minimum and below the recommended version: the red banner wins, the green one is not shown.',
    texts: [{ key: 'home.updateRequiredTitle' }],
    buttons: [UPDATE],
    render: (ctx) => {
      const banner = resolveAppBanner({ current: '2.0.0', min: '2.0.2', recommended: '2.0.3', dismissedRecommended: '2.0.3' });
      return <HomeBanner ctx={ctx} banner={banner ?? { kind: 'unsupported' }} />;
    },
  },
];

// ---------------------------------------------------------------------------
// Alerts: a button that opens the real native alert.
// ---------------------------------------------------------------------------

function AlertLauncher({ label, onPress, note }: { label: string; onPress: () => void; note: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: insets.top + 48 }}>
      <Text style={{ color: colors.text, marginBottom: 16, fontFamily: Typography.fontFamily.medium }}>{note}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={[styles.launcher, { backgroundColor: colors.secondary }]}
        testID="qa-open-alert"
      >
        <Text style={{ color: colors.buttonText, fontFamily: Typography.fontFamily.bold }}>{label}</Text>
      </Pressable>
    </View>
  );
}

const CONSENT_BUTTONS: ExpectedButton[] = [
  { key: 'errorReport.consentCancel', action: 'resolves false: nothing sent, report kept', recorder: 'consent-false' },
  { key: 'errorReport.consentSend', action: 'resolves true: mail composer (or share sheet) opens', recorder: 'consent-true' },
];

function consent(ctx: GalleryCtx, beta: boolean) {
  return (
    <AlertLauncher
      label="QA: ouvrir l'alerte"
      note={beta ? 'confirmReportConsent({ betaAttachment: true })' : 'confirmReportConsent({ betaAttachment: false })'}
      onPress={() => {
        void confirmReportConsent({ betaAttachment: beta }).then((ok) =>
          recordAction(ok ? 'consent-true' : 'consent-false', ok ? 'consent: Envoyer' : 'consent: Annuler'),
        );
      }}
    />
  );
}

export const ALERT_STATES: GalleryState[] = [
  {
    id: 'alert-report-consent',
    group: 'Report consent alert',
    component: 'utils/report-consent.ts (via utils/error-reporter.ts sendErrorReport)',
    frame: 'alert',
    runtime: 'gallery',
    trigger: 'Any "Envoyer un rapport d\'erreur" tap (steps 6, 7, 13, root error screen, Settings previous session), store app or no vote artifacts attached.',
    texts: [{ key: 'errorReport.consentTitle' }, { key: 'errorReport.consentBody' }],
    buttons: CONSENT_BUTTONS,
    prelude: [{ tap: { testID: 'qa-open-alert' } }],
    notes: 'Shown every time, no "do not ask again". Android: tapping outside the alert = Annuler.',
    render: (ctx) => consent(ctx, false),
  },
  {
    id: 'alert-report-consent-beta',
    group: 'Report consent alert',
    component: 'utils/report-consent.ts (via utils/error-reporter.ts sendErrorReport)',
    frame: 'alert',
    runtime: 'gallery',
    trigger: 'Same, when the report carries the vote artifacts JSON (beta app, after a registration or vote this session).',
    texts: [{ key: 'errorReport.consentTitle' }, { key: 'errorReport.consentBody' }, { key: 'errorReport.consentBetaAttachment' }],
    buttons: CONSENT_BUTTONS,
    prelude: [{ tap: { testID: 'qa-open-alert' } }],
    render: (ctx) => consent(ctx, true),
  },
];

// ---------------------------------------------------------------------------
// Real screens
// ---------------------------------------------------------------------------

function Thrower(): React.ReactElement {
  throw new Error('QA gallery: simulated render crash');
}

export const SCREEN_STATES: GalleryState[] = [
  {
    id: 'settings-screen',
    group: 'Settings',
    component: 'app/parametres.tsx',
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Settings opened. The "previous session" row appears only when a previous session log exists on disk (app closed mid-flow).',
    // darkMode first: the measurement flow waits for the second text, which
    // must be visible at first rendering on every device (the key-management
    // row is below the fold of a 360 x 640 screen at font scale 1.3).
    texts: [{ key: 'settings.darkMode' }, { key: 'settings.contact' }, { key: 'keyManagement.title' }],
    buttons: [
      { key: 'settings.contact', action: 'openContactEmail → mail composer', recorder: 'mail', noTapInAutomation: true },
      {
        key: 'keyManagement.title',
        action: "router.push('/key-management')",
        recorder: 'router.push:/key-management',
        destinationKey: 'keyManagement.dbDescription',
      },
    ],
    buttonsComplete: false,
    notes: 'Real screen: shows this phone\'s real settings. Other rows (language, theme, legal links, dev section) unchanged in 2.0.2.',
    render: () => <ParametresScreen />,
  },
  {
    id: 'settings-previous-session',
    group: 'Settings',
    component: 'app/parametres.tsx, utils/error-reporter.ts (sendPreviousSessionReport)',
    frame: 'screen',
    runtime: 'jest',
    trigger: 'A previous session log exists (readPreviousSessionLog() returns text).',
    texts: [{ key: 'settings.sendPreviousLog' }],
    buttons: [
      {
        key: 'settings.sendPreviousLog',
        action: 'sendPreviousSessionReport → consent alert; Annuler keeps the log and the row, Envoyer clears both',
        recorder: 'previous-session',
      },
    ],
    notes: 'Needs a previous-session file on disk: rendered by the jest suite with the logger mocked. On a phone: kill the app during a vote, relaunch, open Settings.',
    buttonsComplete: false,
    jestGlobals: { __QA_PREVIOUS_LOG__: 'previous session log (fixture)' },
    render: () => <ParametresScreen />,
  },
  {
    id: 'verify-idle',
    group: 'Vérifier',
    component: 'app/(tabs)/verifier.tsx',
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Vérifier tab opened.',
    texts: [{ key: 'verifier.title' }, { key: 'verifier.description' }, { key: 'verifier.lookupLabel' }],
    buttons: [
      { key: 'verifier.cta', action: 'disabled while the field is empty', recorder: 'none', disabled: true },
      { key: 'settings.title', action: "SettingsButton (gear icon) → router.push('/parametres')", recorder: 'none' },
    ],
    render: () => <VerifierScreen />,
  },
  {
    id: 'verify-invalid',
    group: 'Vérifier',
    component: 'app/(tabs)/verifier.tsx, utils/vote-hash-input.ts',
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Text that is not 0x + 64 hex typed, "Vérifier" tapped: refused before any request.',
    prelude: [{ type: 'abc123' }, { tap: { testID: 'verify-cta' } }],
    texts: [{ key: 'verifier.lookupLabel' }, { key: 'verifier.invalidHash' }],
    buttons: [
      { key: 'verifier.cta', testID: 'verify-cta', action: 'lookupVoteTx → validation again (no request)', recorder: 'none' },
      { key: 'settings.title', action: "SettingsButton (gear icon) → router.push('/parametres')", recorder: 'none' },
    ],
    render: () => <VerifierScreen />,
  },
  {
    id: 'verify-not-found',
    group: 'Vérifier',
    component: 'app/(tabs)/verifier.tsx',
    frame: 'screen',
    runtime: 'manual',
    trigger: 'Well-formed serial unknown on both networks (type 0x followed by 64 zeros).',
    texts: [{ key: 'verifier.notFound' }],
    buttons: [],
  },
  {
    id: 'verify-lookup-error',
    group: 'Vérifier',
    component: 'app/(tabs)/verifier.tsx',
    frame: 'screen',
    runtime: 'manual',
    trigger: 'RPC failure during the lookup (airplane mode, then a well-formed serial).',
    texts: [{ key: 'verifier.lookupError' }],
    buttons: [],
  },
  {
    id: 'keys-screen',
    group: 'Key management',
    component: 'app/key-management.tsx',
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Settings → Gestion des clés. Lists this phone\'s real documents (keys are never displayed).',
    texts: [{ key: 'keyManagement.dbDescription' }],
    buttons: [
      { key: 'keyManagement.actionImportFile', action: 'DocumentPicker → import mode alert (Fusionner / Tout remplacer)', recorder: 'none', noTapInAutomation: true },
    ],
    buttonsComplete: false,
    notes: 'Real screen on the real key store: the automation never taps an export, import or wipe button here. Menus and alerts of this screen are listed below as manual states.',
    render: () => <KeyManagementScreen />,
  },
  ...(
    [
      ['keys-alert-import-mode', 'keyManagement.importChooseModeTitle', 'A backup file picked: Annuler / Fusionner / Tout remplacer.'],
      ['keys-alert-import-empty', 'keyManagement.importEmptyTitle', 'The picked file is empty.'],
      ['keys-alert-import-invalid', 'keyManagement.importInvalidTitle', 'The picked file is not a key backup.'],
      ['keys-alert-import-conflict', 'keyManagement.importConflictTitle', 'Merge found documents that already have another key: Annuler / Remplacer.'],
      ['keys-alert-import-conflict-none-match', 'keyManagement.importConflictNoneMatchTitle', 'Merge conflicts whose keys do not match the chain.'],
      ['keys-alert-replace-invalid', 'keyManagement.replaceKeyInvalidTitle', 'Pasted replacement key is not 64 hex characters.'],
      ['keys-alert-replace-mismatch', 'keyManagement.replaceKeyMismatchTitle', 'Pasted key does not match the identity on chain.'],
      ['keys-alert-replace-confirm', 'keyManagement.replaceKeyConfirmTitle', 'Pasted key accepted: Annuler / Remplacer (irreversible).'],
      ['keys-alert-wipe-all', 'keyManagement.wipeAllConfirmTitle', 'Dev mode only: "Tout supprimer": Annuler / Tout supprimer.'],
      ['keys-alert-share-unavailable', 'keyManagement.genericError', 'Export on a device without a share target.'],
    ] as const
  ).map(
    ([id, key, trigger]): GalleryState => ({
      id,
      group: 'Key management',
      component: 'app/key-management.tsx',
      frame: 'alert',
      runtime: 'manual',
      trigger,
      texts: [{ key }],
      buttons: [],
      status: 'unchanged',
      notes: 'Alert built inside the screen handlers; reproduce on the real screen with a test phone.',
    }),
  ),
  {
    id: 'root-error-fallback',
    group: 'Root error screen',
    component: 'components/RootErrorBoundary.tsx',
    frame: 'screen',
    runtime: 'gallery',
    trigger: 'Any render crash below the root layout.',
    texts: [{ key: 'errorReport.fallbackTitle' }, { key: 'errorReport.fallbackMessage' }],
    buttons: [
      { key: 'errorReport.button', action: 'sendPending → consent alert', recorder: 'report' },
      { key: 'common.retry', action: 'reset → re-render the tree', recorder: 'none' },
    ],
    settleMs: 1500,
    notes: 'The report button appears once the report is prepared (a moment after the crash).',
    render: () => (
      <RootErrorBoundary>
        <Thrower />
      </RootErrorBoundary>
    ),
  },
];

const styles = StyleSheet.create({
  homeTitle: { fontSize: 32, fontFamily: Typography.fontFamily.bold, paddingHorizontal: 24, marginBottom: 12 },
  cardStub: { height: 220, marginHorizontal: 24, marginTop: 16, borderRadius: 24 },
  launcher: { padding: 16, borderRadius: 64, alignItems: 'center' },
});

