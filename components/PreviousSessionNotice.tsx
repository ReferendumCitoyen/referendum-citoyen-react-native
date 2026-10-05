import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors, Typography } from '@/constants/theme';
import {
  claimPreviousSessionOffer,
  clearPreviousSessionLog,
  readPreviousSessionLog,
} from '@/utils/logger';
import { sendPreviousSessionReport } from '@/utils/error-reporter';

export default function PreviousSessionNotice() {
  const { t } = useTranslation();
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);
  const resolved = useRef(false);

  const offerRequest = useRef<Promise<boolean> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      offerRequest.current ??= claimPreviousSessionOffer();
      offerRequest.current
        .then(async (offer) => offer && Boolean(await readPreviousSessionLog()))
        .then((offer) => {
          if (mounted && !resolved.current) setVisible(offer);
        })
        .catch(() => {});
      return () => {
        mounted = false;
      };
    }, [])
  );

  if (!visible) return null;

  const decline = () => {
    if (sending.current) return;
    resolved.current = true;
    setVisible(false);
    void clearPreviousSessionLog().catch(() => {});
  };
  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      // The existing sender owns preparation, consent and transport.
      const outcome = await sendPreviousSessionReport();
      resolved.current = true;
      setVisible(false);
      if (outcome === 'cancelled') await clearPreviousSessionLog();
    } catch {
      setFailed(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <Text style={[styles.text, { color: colors.text }]}>
        {t(failed ? 'errorReport.previousSessionFailed' : 'errorReport.previousSessionNotice')}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={send}
        accessibilityState={{ disabled: busy, busy }}
        style={styles.button}
      >
        <Text style={[styles.text, { color: colors.secondary }]}>
          {t('settings.sendPreviousLog')}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={decline} style={styles.button}>
        <Text style={[styles.text, { color: colors.text }]}>
          {t('errorReport.previousSessionDecline')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, margin: 12, borderRadius: 12 },
  text: { fontFamily: Typography.fontFamily.medium, fontSize: Typography.fontSize.body },
  button: { paddingVertical: 12 },
});
