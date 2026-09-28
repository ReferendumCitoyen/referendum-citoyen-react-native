import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import SettingsIcon from './icons/SettingsIcon';
import { useColors, Spacing } from '@/constants/theme';

export default function SettingsButton() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      onPress={() => router.push('/parametres')}
      style={styles.button}
      activeOpacity={0.7}
      // Icon only: screen readers need a name (QA 2.0.2, item 6).
      accessibilityRole="button"
      accessibilityLabel={t('settings.title')}
    >
      <SettingsIcon color={colors.icon} size={Spacing.icon.size} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
});
