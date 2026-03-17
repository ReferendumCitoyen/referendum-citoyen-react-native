import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { supportedLanguages, getCurrentLanguageCode } from '@/locales';
import { Svg, Path } from 'react-native-svg';

const CheckIcon = ({ color, size = 20 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M5 13L9 17L19 7"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default function LanguageSelectScreen() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const styles = createStyles(colors);
  const currentLanguageCode = getCurrentLanguageCode();

  const handleSelect = (langCode: string) => {
    i18n.changeLanguage(langCode);
    router.back();
  };

  return (
    <View style={styles.container}>
      {supportedLanguages.map((langCode) => {
        const label = t(`languages.${langCode}`, { defaultValue: langCode.toUpperCase() });
        const isSelected = langCode === currentLanguageCode;

        return (
          <TouchableOpacity
            key={langCode}
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => handleSelect(langCode)}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{label}</Text>
            {isSelected && <CheckIcon color={colors.primary} size={Spacing.icon.size} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.settingRow.paddingVertical,
    paddingHorizontal: Spacing.settingRow.paddingHorizontal,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
  },
  labelSelected: {
    fontFamily: Typography.fontFamily.semibold,
    color: colors.primary,
  },
});
