import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors, Typography, Spacing } from '@/constants/theme';
import SiteLinkCard from '@/components/SiteLinkCard';
import { PETITIONS_URL } from '@/constants/urls';

/** "Pétitions en cours": what a petition is, and one button to the site. */
export default function PetitionsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.screenContainer}>
      <Stack.Screen options={{ title: t('petitions.title'), headerShown: true }} />
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <Text style={styles.title}>{t('petitions.title')}</Text>
        <SiteLinkCard text={t('petitions.text')} buttonLabel={t('petitions.button')} url={PETITIONS_URL} />
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    screenContainer: { flex: 1, backgroundColor: colors.background },
    contentContainer: { padding: Spacing.screen.horizontal, gap: 16 },
    title: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.h1,
      lineHeight: Typography.lineHeight.h1,
      letterSpacing: Typography.letterSpacing.h1,
      color: colors.text,
    },
  });
