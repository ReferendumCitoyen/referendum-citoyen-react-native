import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useErrorReporter } from '@/contexts/ErrorReportContext';

interface State { error: unknown }

// Class component is required for getDerivedStateFromError / componentDidCatch.
// Must be rendered INSIDE the ErrorReportProvider so the Fallback can use the
// useErrorReporter hook. See app/_layout.tsx wiring in Task 14.
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
        <Pressable onPress={sendPending} style={styles.button}>
          <Text style={styles.buttonText}>{t('errorReport.button')}</Text>
        </Pressable>
      )}
      <Pressable onPress={reset} style={styles.button}>
        <Text style={styles.buttonText}>{t('common.retry', { defaultValue: 'Retry' })}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  message: { fontSize: 16, textAlign: 'center' },
  button: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, borderWidth: 1 },
  buttonText: { fontSize: 16 },
});
