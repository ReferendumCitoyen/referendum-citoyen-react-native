import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import SettingsIcon from './icons/SettingsIcon';
import { useColors, Spacing } from '@/constants/theme';

export default function SettingsButton() {
  const router = useRouter();
  const colors = useColors();

  return (
    <TouchableOpacity
      onPress={() => router.push('/parametres')}
      style={styles.button}
      activeOpacity={0.7}
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
