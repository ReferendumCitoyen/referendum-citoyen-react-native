import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, View, Text, Switch, TouchableOpacity, Linking, Alert, TextInput } from 'react-native';
import * as Application from 'expo-application';
import { useTranslation } from 'react-i18next';
import { useColors, useTheme, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useDevMode } from '@/contexts/DevModeContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useExtraProposals } from '@/contexts/ExtraProposalsContext';
import { LEGAL_URLS, CONTACT_EMAIL } from '@/constants/urls';

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
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const colors = useColors();
  const styles = createStyles(colors);
  const darkModeEnabled = theme === 'dark';
  const { devMode, setDevMode, handleVersionTap } = useDevMode();
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
      'Activer le réseau Mainnet ?',
      "Mainnet enregistre votre identité et votre vote de manière permanente sur Rarimo Mainnet (chain 7368). À n'utiliser qu'en connaissance de cause.",
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Continuer', style: 'destructive', onPress: () => setNetwork('mainnet') },
      ],
    );
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
            onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
          >
            <Text style={styles.settingLabel}>{t('settings.contact')}</Text>
            <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
          </TouchableOpacity>

          {devMode && (
            <>
              {/* Hide Dev Tools */}
              <TouchableOpacity
                style={[styles.settingRow, { justifyContent: 'center' }]}
                activeOpacity={0.7}
                onPress={() => setDevMode(false)}
              >
                <Text style={[styles.settingValue, { color: colors.secondary }]}>Hide Dev Tools</Text>
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
                      ? (extraIds.length > 0 ? `Affichés : #${extraIds.join(', #')}` : 'Activé (liste vide)')
                      : 'Désactivé'}
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

              {/* Key management — backup / restore the BJJ private key.
                  Lives behind devMode because exposing a private key is a
                  loaded action; ordinary users should never reach this. */}
              <TouchableOpacity
                style={styles.settingRow}
                activeOpacity={0.7}
                onPress={() => router.push('/key-management' as any)}
              >
                <Text style={styles.settingLabel}>Sauvegarde / Restauration de clé</Text>
                <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
              </TouchableOpacity>

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
          <Text style={styles.versionText}>
            {t('settings.version', {
              version: Application.nativeApplicationVersion || '1.0.0',
              build: Application.nativeBuildVersion || '1',
            })}
          </Text>
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
    color: colors.text,
    opacity: 0.5,
  },
});
