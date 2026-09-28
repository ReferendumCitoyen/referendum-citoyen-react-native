import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, View, Text, Switch, TouchableOpacity, Linking, Alert, TextInput, Platform } from 'react-native';
import { appVersionLabel, appBuildLabel, appCommitLabel } from '@/utils/app-version';
import { isBetaBuild } from '@/constants/app-flavour';
import { useTranslation } from 'react-i18next';
import { useColors, useTheme, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useDevMode } from '@/contexts/DevModeContext';
import {
  isMockBackend,
  setMockBackendOverride,
  MOCK_BACKEND_BUILD_DEFAULT,
} from '@/constants/mock-backend';
import { useNetwork } from '@/contexts/NetworkContext';
import { useExtraProposals } from '@/contexts/ExtraProposalsContext';
import { LEGAL_URLS, NEWSLETTER_URL } from '@/constants/urls';
import { openContactEmail } from '@/utils/open-contact-email';

const CaretRightIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 6L15 12L9 18"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default function ParametresScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const colors = useColors();
  const styles = createStyles(colors);
  const darkModeEnabled = theme === 'dark';
  const { devMode, setDevMode, handleVersionTap } = useDevMode();
  // Effective MOCK_BACKEND, mirrored into local state so the switch renders.
  // The source of truth stays the module (constants/mock-backend.ts) because
  // every consumer reads it from inside an async flow, not during render.
  const [mockBackend, setMockBackendState] = useState(isMockBackend());
  const { network, setNetwork } = useNetwork();
  const { extraEnabled, setExtraEnabled, extraIds, setExtraIds } = useExtraProposals();

  // Local mirror of the comma-separated input — lets the user type freely
  // (with intermediate invalid states like a trailing comma) and only
  // commits sanitised values to the context on blur. Re-syncs from the
  // context if the value changes externally (e.g. AsyncStorage hydrate).
  const [extraIdsInput, setExtraIdsInput] = useState<string>(extraIds.join(', '));
  const [extraIdsError, setExtraIdsError] = useState<string | null>(null);
  useEffect(() => {
    setExtraIdsInput(extraIds.join(', '));
  }, [extraIds]);

  const commitExtraIds = () => {
    // Split on any run of whitespace, commas, or semicolons; filter to
    // non-empty numeric tokens; dedupe (preserving first occurrence).
    const raw = extraIdsInput
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const invalid = raw.filter((s) => !/^[1-9]\d*$/.test(s));
    if (invalid.length > 0) {
      setExtraIdsError(`Entrées invalides : ${invalid.join(', ')}`);
      return;
    }
    const deduped: string[] = [];
    for (const id of raw) if (!deduped.includes(id)) deduped.push(id);
    setExtraIdsError(null);
    setExtraIds(deduped);
  };

  // Switching to Mainnet writes real on-chain state via the registration
  // relayer. Confirm before flipping. Switching *back* to testnet is free —
  // no confirmation needed.
  const handleNetworkToggle = (toMainnet: boolean) => {
    if (!toMainnet) {
      setNetwork('testnet');
      return;
    }
    Alert.alert(
      t('settings.mainnetAlertTitle'),
      t('settings.mainnetAlertBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.continue'), style: 'destructive', onPress: () => setNetwork('mainnet') },
      ],
    );
  };

  // Shared with the post-vote screen's "Nous contacter" — see
  // utils/open-contact-email.ts for the composer/mailto fallback.
  const handleContact = () => openContactEmail(t);

  // A previous session's log tail, if the app left one behind: the tail of a
  // session that died in the foreground, renamed at launch (utils/logger.ts),
  // never the running session's own tail. Only checked once, on mount: it
  // changes only between launches, and the row it controls disappears as soon
  // as it is sent.
  const [hasPreviousLog, setHasPreviousLog] = useState(false);
  useEffect(() => {
    let alive = true;
    import('@/utils/logger')
      .then((m) => m.readPreviousSessionLog())
      .then((text) => { if (alive) setHasPreviousLog(Boolean(text)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleSendPreviousLog = async () => {
    try {
      const { sendPreviousSessionReport } = await import('@/utils/error-reporter');
      const outcome = await sendPreviousSessionReport();
      // Cancelled at the consent screen: the log stays, and so does the row.
      if (outcome !== 'cancelled') setHasPreviousLog(false);
    } catch {
      console.warn('[settings] could not send the previous session log');
    }
  };

  return (
    <View style={styles.screenContainer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        {/* Settings Container */}
        <View style={styles.settingsContainer}>
          {/* Dark Mode Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.darkMode')}</Text>
            <Switch
              value={darkModeEnabled}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.switchGray, true: colors.secondary }}
              thumbColor={colors.buttonText}
              ios_backgroundColor={colors.switchGray}
            />
          </View>

          {/* Privacy Policy Row */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => Linking.openURL(LEGAL_URLS.privacyPolicy)}
          >
            <Text style={styles.settingLabel}>{t('settings.privacyPolicy')}</Text>
            <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
          </TouchableOpacity>

          {/* Terms & Conditions Row — opens the in-app CGU view (the same
              text + version the user accepted at the launch gate). */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => router.push('/terms-view')}
          >
            <Text style={styles.settingLabel}>{t('settings.termsAndConditions')}</Text>
            <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
          </TouchableOpacity>

          {/* Contact Row */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={handleContact}
          >
            <Text style={styles.settingLabel}>{t('settings.contact')}</Text>
            <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
          </TouchableOpacity>

          {/* Newsletter — on the site, never in the app: no e-mail field here. */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => Linking.openURL(NEWSLETTER_URL)}
            accessibilityRole="link"
          >
            <Text style={styles.settingLabel}>{t('newsletter.button')}</Text>
            <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
          </TouchableOpacity>

          {/* The tail of a previous session, when one was left on disk. Shown
              only when there is something to send, so it is absent in the
              normal case and present exactly when the app closed on someone
              mid-flow — the 2026-09-10 case, where the buffer was memory-only
              and every line was lost with it. */}
          {hasPreviousLog && (
            <TouchableOpacity
              style={styles.settingRow}
              activeOpacity={0.7}
              onPress={handleSendPreviousLog}
            >
              <Text style={styles.settingLabel}>{t('settings.sendPreviousLog')}</Text>
              <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
            </TouchableOpacity>
          )}

          {/* Key management — backup / restore the per-document BJJ private
              keys (read-only access for ordinary users; the destructive
              "Tout supprimer" reset inside the screen stays gated to dev
              mode). Lives outside the devMode block so a user who needs to
              restore a backup after reinstalling can actually find it. */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => router.push('/key-management' as any)}
          >
            <Text style={styles.settingLabel}>{t('keyManagement.title')}</Text>
            <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
          </TouchableOpacity>

          {devMode && (
            <>
              {/* Real pipeline vs stub. Behind dev mode because turning the
                  stub OFF makes the flow write to Mainnet permanently, and
                  French documents have no DG15 so Registration2.revoke() is
                  blocked — a document bonded by mistake can never vote again.
                  Turning it ON is harmless, so only the dangerous direction
                  asks for confirmation. The effective value is printed in
                  every error report header, so a report can't misrepresent
                  which pipeline produced it. */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>
                  {t('settings.mockBackend', { defaultValue: 'Backend simulé' })}
                </Text>
                <Switch
                  value={mockBackend}
                  onValueChange={(next) => {
                    const apply = async () => {
                      // Clear the override when it matches the build default,
                      // so the header reports "not overridden" rather than an
                      // override that happens to agree.
                      await setMockBackendOverride(
                        next === MOCK_BACKEND_BUILD_DEFAULT ? null : next,
                      );
                      setMockBackendState(next);
                    };
                    if (next) {
                      apply();
                      return;
                    }
                    Alert.alert(
                      t('settings.mockBackendOffTitle', {
                        defaultValue: 'Passer en mode réel ?',
                      }),
                      t('settings.mockBackendOffBody', {
                        defaultValue:
                          "L'enregistrement et le vote écriront réellement sur la blockchain Mainnet. Un document enregistré par erreur ne pourra jamais être annulé.\n\nExportez vos clés avant de continuer (Gestion des clés).",
                      }),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('settings.mockBackendOffCta', { defaultValue: 'Mode réel' }),
                          style: 'destructive',
                          onPress: apply,
                        },
                      ],
                    );
                  }}
                />
              </View>

              {/* Hide Dev Tools */}
              <TouchableOpacity
                style={[styles.settingRow, { justifyContent: 'center' }]}
                activeOpacity={0.7}
                onPress={() => setDevMode(false)}
              >
                <Text style={[styles.settingValue, { color: colors.secondary }]}>Hide Dev Tools</Text>
              </TouchableOpacity>

              {/* Language picker. Lives in the dev menu so production users
                  default to French; QA / English users flip via the Settings
                  7-tap escape hatch. Reuses the existing language-select
                  screen wired up at app/language-select.tsx. */}
              <TouchableOpacity
                style={styles.settingRow}
                activeOpacity={0.7}
                onPress={() => router.push('/language-select')}
              >
                <Text style={styles.settingLabel}>{t('settings.language')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{
                    fontFamily: Typography.fontFamily.medium,
                    fontSize: Typography.fontSize.small,
                    color: colors.text,
                    opacity: 0.6,
                  }}>
                    {t(`languages.${i18n.language}`, { defaultValue: i18n.language?.toUpperCase() })}
                  </Text>
                  <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
                </View>
              </TouchableOpacity>

              {/* Network selector (Mainnet / Testnet)
                  Visible only in dev mode. Mainnet writes real on-chain
                  state — see NetworkContext.tsx and the Alert in
                  handleNetworkToggle. Switching here propagates to the
                  voting flow on its next mount; existing in-memory Rarime
                  instances are not hot-swapped, the voting flow re-creates
                  them on entry. */}
              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingLabel}>Réseau</Text>
                  <Text style={{
                    fontFamily: Typography.fontFamily.medium,
                    fontSize: Typography.fontSize.small,
                    color: colors.text,
                    opacity: 0.6,
                    marginTop: 2,
                  }}>
                    {network === 'mainnet' ? 'Mainnet — chain 7368' : 'Testnet — chain 7369'}
                  </Text>
                </View>
                <Switch
                  value={network === 'mainnet'}
                  onValueChange={handleNetworkToggle}
                  trackColor={{ false: colors.switchGray, true: colors.secondary }}
                  thumbColor={colors.buttonText}
                  ios_backgroundColor={colors.switchGray}
                />
              </View>

              {/* Extra proposals — toggle + editable list. Adds the IDs
                  in `extraIds` (see ExtraProposalsContext) to the home
                  screen alongside the production allowlist. Used to keep
                  older verified scrutins reachable for QA without
                  exposing them to regular users. Default off, default
                  IDs ['48', '47']. */}
              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingLabel}>Scrutins supplémentaires (dev)</Text>
                  <Text style={{
                    fontFamily: Typography.fontFamily.medium,
                    fontSize: Typography.fontSize.small,
                    color: colors.text,
                    opacity: 0.6,
                    marginTop: 2,
                  }}>
                    {extraEnabled
                      ? (extraIds.length > 0 ? t('settings.extrasShowing', { ids: extraIds.join(', #') }) : t('settings.extrasEnabledEmpty'))
                      : t('settings.extrasDisabled')}
                  </Text>
                </View>
                <Switch
                  value={extraEnabled}
                  onValueChange={setExtraEnabled}
                  trackColor={{ false: colors.switchGray, true: colors.secondary }}
                  thumbColor={colors.buttonText}
                  ios_backgroundColor={colors.switchGray}
                />
              </View>

              {/* Editable list of extra proposal IDs. Visible whether the
                  toggle is on or off so the user can prep the list before
                  enabling it. Commits on blur (or on "Done" / submit). */}
              <View style={[styles.settingRow, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                <Text style={[styles.settingLabel, { fontSize: Typography.fontSize.small, opacity: 0.7 }]}>
                  IDs supplémentaires (séparés par virgules)
                </Text>
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: extraIdsError ? colors.errorText : colors.border,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontFamily: Typography.fontFamily.regular,
                    fontSize: Typography.fontSize.body,
                    color: colors.text,
                    backgroundColor: colors.background,
                  }}
                  value={extraIdsInput}
                  onChangeText={(v) => { setExtraIdsInput(v); if (extraIdsError) setExtraIdsError(null); }}
                  onBlur={commitExtraIds}
                  onSubmitEditing={commitExtraIds}
                  placeholder="48, 47"
                  placeholderTextColor={colors.text + '60'}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="done"
                />
                {extraIdsError && (
                  <Text style={{
                    fontFamily: Typography.fontFamily.medium,
                    fontSize: Typography.fontSize.small,
                    color: colors.errorText,
                  }}>
                    {extraIdsError}
                  </Text>
                )}
              </View>

              {/* French ID Test Row */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Test Carte d&apos;identité</Text>
                <TouchableOpacity
                  style={styles.settingValueContainer}
                  activeOpacity={0.7}
                  onPress={() => router.push('/french-id-test')}
                >
                  <Text style={styles.settingValue}>{t('common.open')}</Text>
                  <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
                </TouchableOpacity>
              </View>


              {/* Passport Test Row */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Test Passeport</Text>
                <TouchableOpacity
                  style={styles.settingValueContainer}
                  activeOpacity={0.7}
                  onPress={() => router.push('/passport-test')}
                >
                  <Text style={styles.settingValue}>{t('common.open')}</Text>
                  <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
                </TouchableOpacity>
              </View>

              {/* CAN Scan Row */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Scan CAN (ID)</Text>
                <TouchableOpacity
                  style={styles.settingValueContainer}
                  activeOpacity={0.7}
                  onPress={() => router.push('/can-scan')}
                >
                  <Text style={styles.settingValue}>{t('common.open')}</Text>
                  <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Version Text */}
        <TouchableOpacity style={styles.versionContainer} activeOpacity={1} onPress={handleVersionTap}>
          {/* Store app: the version and nothing else (team decision, 2026-09-14). The
              build number, commit, flavour and licence move under dev mode,
              where the team reads them off for a bug report. */}
          <Text style={styles.versionText}>{`v${appVersionLabel()}`}</Text>
          {devMode && (
            <Text style={styles.versionText}>
              <Text style={styles.versionBuildEmphasis}>
                {`${Platform.OS === 'ios' ? 'iOS' : 'Android'} build ${appBuildLabel()}`}
                {appCommitLabel() ? ` · ${appCommitLabel()}` : ''}
              </Text>
              {` · ${isBetaBuild() ? 'Beta' : 'Store'} · GPLv3`}
            </Text>
          )}
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 120,
  },
  settingsContainer: {
    gap: Spacing.settingRow.gap,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.settingRow.paddingVertical,
    paddingHorizontal: Spacing.settingRow.paddingHorizontal,
    backgroundColor: colors.cardBackground,
  },
  settingLabel: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.settingRow,
    lineHeight: Typography.lineHeight.settingRow,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
    flex: 1,
  },
  settingValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.settingRow.valueGap,
  },
  settingValue: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
  },
  versionContainer: {
    paddingVertical: Spacing.screen.gap,
    paddingHorizontal: Spacing.screen.horizontal,
    alignItems: 'center',
  },
  versionText: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.small,
    lineHeight: Typography.lineHeight.small,
    letterSpacing: Typography.letterSpacing.small,
    // Alpha-blended instead of a wrapping opacity: RN doesn't reliably let a
    // nested <Text> span opt back to full opacity against a parent's
    // opacity, since text runs get flattened into one attributed string
    // rather than composited as separate layers. This still reads the same
    // as before, but versionBuildEmphasis below can now sit at full contrast.
    color: colors.text + '80',
    textAlign: 'center',
  },
  versionBuildEmphasis: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.text,
  },
});
