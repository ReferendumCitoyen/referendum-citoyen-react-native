import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import type { AppBanner } from '@/utils/update-notice';

interface UpdateNoticeBannerProps {
  /** Which banner, from resolveAppBanner (utils/update-notice.ts). */
  banner: Exclude<AppBanner, null>;
  /** Only the green "recommended" banner can be dismissed (persisted per
   * recommended version: it reappears when a newer one is published). */
  onDismiss?: () => void;
  /** Opens the store page. Never called on its own: a tap only. */
  onUpdate?: () => void;
}

/**
 * The home screen's app-version banner (item 9, R10), driven by the signed
 * proposal index, no request to the stores:
 *   - recommended: green, dismissible, "Une nouvelle version est disponible";
 *   - required: red, not dismissible, "Mettez à jour l'application pour voter"
 *     (the Vote buttons are hidden, results stay readable);
 *   - unsupported: the prover probe says this phone cannot build the proof
 *     (utils/device-support.ts, item 4b); not dismissible, no update link
 *     (an update cannot fix it), and it wins over both.
 */
const UpdateNoticeBanner: React.FC<UpdateNoticeBannerProps> = ({ banner, onDismiss, onUpdate }) => {
  const { t } = useTranslation();
  const colors = useColors();

  const palette =
    banner.kind === 'recommended'
      ? { bg: colors.successBackground, fg: colors.successText }
      : banner.kind === 'required'
        ? { bg: colors.errorBackground, fg: colors.errorText }
        : { bg: colors.warningBackground, fg: colors.warningText };
  const title =
    banner.kind === 'recommended'
      ? t('home.updateRecommendedTitle')
      : banner.kind === 'required'
        ? t('home.updateRequiredTitle')
        : t('home.unsupportedPhoneTitle');
  const body =
    banner.kind === 'recommended'
      ? t('home.updateRecommendedBody', { version: banner.version })
      : banner.kind === 'required'
        ? t('home.updateRequiredBody', { min: banner.min })
        : t('home.unsupportedPhoneBody');

  return (
    <View
      style={[styles.container, { backgroundColor: palette.bg }]}
      accessibilityRole={banner.kind === 'recommended' ? undefined : 'alert'}
      testID={`app-banner-${banner.kind}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: palette.fg }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.text }]}>{body}</Text>
        {banner.kind !== 'unsupported' && onUpdate ? (
          <TouchableOpacity onPress={onUpdate} accessibilityRole="link" style={styles.updateButton}>
            <Text style={[styles.updateText, { color: palette.fg }]}>{t('home.updateButton')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {banner.kind === 'recommended' && onDismiss ? (
        <TouchableOpacity
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.closeButton}
        >
          <Text style={[styles.closeText, { color: palette.fg }]}>✕</Text>
        </TouchableOpacity>
      ) : null}
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
  updateButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  updateText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    textDecorationLine: 'underline',
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
