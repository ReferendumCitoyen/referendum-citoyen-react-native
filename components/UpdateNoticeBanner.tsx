import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface UpdateNoticeBannerProps {
  /** Minimum supported version published in the proposal index. */
  minVersion: string;
  /** Called when the user dismisses the notice (persisted per minVersion —
   * the banner reappears only if the published minimum moves higher). */
  onDismiss: () => void;
}

/**
 * Dismissible "please update the app" banner shown on the home screen when
 * the installed native version is older than the
 * `min_supported_app_versions` block of the signed proposal index.
 */
const UpdateNoticeBanner: React.FC<UpdateNoticeBannerProps> = ({ minVersion, onDismiss }) => {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.warningBackground }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.warningText }]}>
          {t('home.updateNoticeTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>
          {t('home.updateNoticeBody', { min: minVersion })}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.closeButton}
      >
        <Text style={[styles.closeText, { color: colors.warningText }]}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    marginBottom: 2,
  },
  body: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
  },
  closeButton: {
    paddingLeft: 4,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

export default UpdateNoticeBanner;
