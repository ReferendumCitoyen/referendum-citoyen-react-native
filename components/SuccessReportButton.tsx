import React, { useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, Typography } from '@/constants/theme';
import { prepareSuccessReport, sendErrorReport, type ReportContext } from '@/utils/error-reporter';

interface Props {
  context?: ReportContext;
}

/**
 * "Send the logs of this vote" — the success-screen twin of ErrorReportButton.
 *
 * Failures have had a report button for months; a vote that worked left
 * nothing anyone could send, and the circuit author needs the WORKING case
 * most of all. One tap: write the report and the unredacted artifacts JSON,
 * open the mail composer. Opt-in by construction — nothing leaves the phone
 * until the tester taps. Beta only, like the attachment.
 */
export const SuccessReportButton: React.FC<Props> = ({ context }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const report = await prepareSuccessReport(context);
      await sendErrorReport(report);
    } catch (e) {
      console.warn('[vote-report] send failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, (pressed || busy) && styles.pressed]}
    >
      <Text style={styles.text}>{t('errorReport.successButton')}</Text>
    </Pressable>
  );
};

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    button: {
      marginTop: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    pressed: { opacity: 0.6 },
    text: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 15,
      color: colors.text,
    },
  });
