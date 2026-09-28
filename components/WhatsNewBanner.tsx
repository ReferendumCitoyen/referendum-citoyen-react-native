import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useColors, Typography } from '@/constants/theme';

/** One flag per announcement; a new line means a new key. */
const SEEN_KEY = 'whats_new_seen:1.6.0-id-card';

/**
 * One line on the home screen after the update that brought ID cards:
 * shown until dismissed, then never again on this install.
 */
export default function WhatsNewBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => { if (!cancelled && v !== '1') setShow(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
  };
  return (
    <View style={[styles.container, { backgroundColor: colors.secondary }]}>
      <Text style={[styles.text, { color: colors.buttonText }]} numberOfLines={2}>
        {t('home.whatsNewIdCard')}
      </Text>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={[styles.close, { color: colors.buttonText }]}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  text: {
    flex: 1,
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
  },
  close: {
    fontSize: 16,
    fontWeight: '700',
  },
});
