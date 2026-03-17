import React from 'react';
import { StyleSheet, ScrollView, View, Text, Switch, TouchableOpacity } from 'react-native';
import * as Application from 'expo-application';
import { useTranslation } from 'react-i18next';
import { useColors, useTheme, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { getCurrentLanguageCode } from '@/locales';

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

  const currentLanguageCode = getCurrentLanguageCode();
  const currentLanguageLabel = t(`languages.${currentLanguageCode}`, {
    defaultValue: currentLanguageCode.toUpperCase(),
  });

  return (
    <View style={styles.screenContainer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer} bounces={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        </View>

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

          {/* Language Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.language')}</Text>
            <TouchableOpacity
              style={styles.settingValueContainer}
              activeOpacity={0.7}
              onPress={() => router.push('/language-select')}
            >
              <Text style={styles.settingValue}>{currentLanguageLabel}</Text>
              <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* RPC Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.rpc')}</Text>
            <TouchableOpacity style={styles.settingValueContainer} activeOpacity={0.7}>
              <Text style={styles.settingValue}>{t('common.select')}</Text>
              <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* Smart Contract Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.smartContract')}</Text>
            <TouchableOpacity style={styles.settingValueContainer} activeOpacity={0.7}>
              <Text style={styles.settingValue}>{t('common.select')}</Text>
              <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* French ID Test Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Test French ID</Text>
            <TouchableOpacity
              style={styles.settingValueContainer}
              activeOpacity={0.7}
              onPress={() => router.push('/french-id-test')}
            >
              <Text style={styles.settingValue}>Ouvrir</Text>
              <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* ID Test Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Test ID</Text>
            <TouchableOpacity
              style={styles.settingValueContainer}
              activeOpacity={0.7}
              onPress={() => router.push('/id-test')}
            >
              <Text style={styles.settingValue}>Ouvrir</Text>
              <CaretRightIcon color={colors.icon} size={Spacing.icon.size} />
            </TouchableOpacity>
          </View>

          {/* Passport Test Row */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Test Passport</Text>
            <TouchableOpacity
              style={styles.settingValueContainer}
              activeOpacity={0.7}
              onPress={() => router.push('/passport-test')}
            >
              <Text style={styles.settingValue}>Ouvrir</Text>
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
        </View>

        {/* Version Text */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>
            {t('settings.version', {
              version: Application.nativeApplicationVersion || '1.0.0',
              build: Application.nativeBuildVersion || '1',
            })}
          </Text>
        </View>

        {/* Empty spacer for tab bar */}
        <View style={styles.tabBarSpacer} />
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
    paddingBottom: Spacing.tabBar.containerHeight,
  },
  headerSection: {
    backgroundColor: colors.cardBackground,
    paddingTop: Spacing.screen.top,
    paddingHorizontal: Spacing.screen.horizontal,
    paddingBottom: Spacing.settingRow.paddingVertical,
  },
  headerTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
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
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
    backgroundColor: 'transparent',
  },
});
