import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useErrorReporter } from '@/contexts/ErrorReportContext';
import { LightColors, DarkColors } from '@/contexts/ThemeContext';

interface State { error: unknown }

// Class component is required for getDerivedStateFromError / componentDidCatch.
// Must be rendered INSIDE the ErrorReportProvider so the Fallback can use the
// useErrorReporter hook. See app/_layout.tsx wiring in Task 14.
//
// Sits OUTSIDE CustomThemeProvider so it can catch theme-provider errors,
// which means useColors() is unavailable here. The Fallback reads the OS
// colour scheme directly via useColorScheme() and applies LightColors /
// DarkColors itself.
export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    // Log so it lands in the buffer; the report itself is prepared lazily
    // by the Fallback when it mounts.
    console.error('[RootErrorBoundary]', error);
  }

  render() {
    if (this.state.error != null) {
      return <Fallback error={this.state.error} reset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function Fallback({ error, reset }: { error: unknown; reset: () => void }) {
  const { t } = useTranslation();
  const { reportError, pendingReport, sendPending } = useErrorReporter();
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? DarkColors : LightColors;
  const styles = makeStyles(colors);

  React.useEffect(() => {
    // User is staring at a broken screen — prepare the report eagerly so the
    // button can send immediately on first tap.
    reportError(error, { source: 'RootErrorBoundary' });
  }, [error, reportError]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('errorReport.fallbackTitle')}</Text>
      <Text style={styles.message}>{t('errorReport.fallbackMessage')}</Text>
      {pendingReport && (
        <Pressable onPress={sendPending} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{t('errorReport.button')}</Text>
        </Pressable>
      )}
      <Pressable onPress={reset} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>{t('common.retry', { defaultValue: 'Retry' })}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: typeof LightColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 16,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    message: {
      fontSize: 16,
      textAlign: 'center',
      color: colors.text,
    },
    primaryButton: {
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 64,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      marginTop: 8,
    },
    primaryButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.buttonText,
    },
    secondaryButton: {
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 64,
      borderWidth: 1,
      borderColor: colors.secondary,
      alignItems: 'center',
    },
    secondaryButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.secondary,
    },
    pressed: { opacity: 0.6 },
  });
