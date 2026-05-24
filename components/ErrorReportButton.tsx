import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, Typography } from '@/constants/theme';
import { useErrorReporter } from '@/contexts/ErrorReportContext';
import { ReportContext, sendErrorReport } from '@/utils/error-reporter';

interface Props {
  error: unknown;
  context?: ReportContext;
}

// Single-tap UX: prepare the report (if not already prepared) AND open the
// OS mail composer / share sheet in one tap. The previous two-tap design
// confused users — they tapped once, nothing visible happened, and they
// thought the button was broken.
export const ErrorReportButton: React.FC<Props> = ({ error, context }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const { pendingReport, reportError, isExpected } = useErrorReporter();
  const styles = makeStyles(colors);

  if (isExpected(error)) return null;

  const onPress = async () => {
    const report = pendingReport ?? (await reportError(error, context));
    if (!report) return;
    try {
      await sendErrorReport(report.uri);
    } catch (e) {
      console.warn('[error-report] send failed', e);
    }
  };

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={styles.text}>{t('errorReport.button')}</Text>
    </Pressable>
  );
};

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    button: {
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 64,
      borderWidth: 1,
      borderColor: colors.secondary,
      alignItems: 'center',
      marginTop: 16,
    },
    pressed: { opacity: 0.6 },
    text: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.secondary,
    },
  });
