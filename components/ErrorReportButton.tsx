import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors, Typography } from '@/constants/theme';
import { useErrorReporter } from '@/contexts/ErrorReportContext';
import { ReportContext, sendErrorReport } from '@/utils/error-reporter';

interface Props {
  error: unknown;
  context?: ReportContext;
  /**
   * Show the button even for an error `isExpected` would normally suppress.
   *
   * Why this exists: `isExpected` hides the button for environment noise we
   * don't need reports about — "offline", "network request failed", a
   * cancelled scan. But those same transport strings are ALSO how a
   * registration- or vote-relayer failure surfaces (see
   * `isServiceUnavailableError`), and at those terminal steps a report is
   * exactly what we need — it's the only thing that tells apart "relayer down"
   * from "the proof reverted on chain". So the two callers on those screens
   * pass `forceShow` when the failure is a service failure, recovering the
   * report the suppression would otherwise eat. Truly self-explanatory errors
   * (expired passport, already voted) are not service failures, so they stay
   * suppressed.
   */
  forceShow?: boolean;
}

// Single-tap UX: prepare the report (if not already prepared) AND open the
// OS mail composer / share sheet in one tap. The previous two-tap design
// confused users — they tapped once, nothing visible happened, and they
// thought the button was broken.
export const ErrorReportButton: React.FC<Props> = ({ error, context, forceShow }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const { pendingReport, reportError, isExpected } = useErrorReporter();
  const styles = makeStyles(colors);

  if (!forceShow && isExpected(error)) return null;

  const onPress = async () => {
    const report = pendingReport ?? (await reportError(error, context));
    if (!report) return;
    try {
      // The whole report, so a proof generated before the failure travels
      // with it (see prepareErrorReport).
      await sendErrorReport(report);
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
