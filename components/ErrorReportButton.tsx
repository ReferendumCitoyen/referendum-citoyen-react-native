import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, Typography } from '@/constants/theme';
import { useErrorReporter } from '@/contexts/ErrorReportContext';
import { ReportContext } from '@/utils/error-reporter';

interface Props {
  error: unknown;
  context?: ReportContext;
}

// Two-tap UX:
//   First tap  — prepares the report (snapshots the buffer, writes a temp file).
//   Second tap — opens the OS mail composer / share sheet.
// Keeps file I/O off the render path. The button shows the same label both
// times; the visible state change is intentional minimal noise.
export const ErrorReportButton: React.FC<Props> = ({ error, context }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const { pendingReport, reportError, sendPending, isExpected } = useErrorReporter();
  const styles = makeStyles(colors);

  if (isExpected(error)) return null;

  const onPress = async () => {
    if (pendingReport) {
      await sendPending();
    } else {
      await reportError(error, context);
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
