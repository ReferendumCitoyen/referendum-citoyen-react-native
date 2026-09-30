import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, Typography, Spacing } from '@/constants/theme';
import SettingsButton from '@/components/SettingsButton';
import SiteLinkCard from '@/components/SiteLinkCard';
import { CONTRIBUTE_URL } from '@/constants/urls';

/**
 * Fourth tab. Says who pays for the votes and sends to the site's Contribuer
 * page — the app itself takes no payment (App Store rules) and nothing in
 * the link says who voted or on what.
 */
export default function ContribuerScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.screenContainer}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View style={styles.headerSection}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{t('contribuer.title')}</Text>
            <SettingsButton />
          </View>
        </View>
        <View style={styles.body}>
          <SiteLinkCard text={t('contribuer.text')} buttonLabel={t('contribuer.button')} url={CONTRIBUTE_URL} />
        </View>
        <View style={styles.tabBarSpacer} />
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    screenContainer: { flex: 1, backgroundColor: colors.background },
    // The tab bar is absolute over the bottom 120 dp (CustomTabBar): the
    // content pads it, like the home and "Comprendre" (2026-09-25).
    contentContainer: { gap: Spacing.screen.sectionGap, paddingBottom: Spacing.tabBar.containerHeight },
    headerSection: {
      backgroundColor: colors.cardBackground,
      paddingTop: Spacing.screen.top,
      paddingHorizontal: Spacing.screen.horizontal,
      paddingBottom: 16,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.h1,
      lineHeight: Typography.lineHeight.h1,
      letterSpacing: Typography.letterSpacing.h1,
      color: colors.text,
    },
    body: { paddingHorizontal: Spacing.screen.horizontal },
    tabBarSpacer: { height: Spacing.tabBar.containerHeight },
  });
