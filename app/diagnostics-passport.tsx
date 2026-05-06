import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useColors } from '@/constants/theme';
import { NfcPassportDiagnosticCard } from '@/components/diagnostics/NfcPassportDiagnosticCard';

export default function DiagnosticsPassportScreen() {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <NfcPassportDiagnosticCard />
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 16,
      gap: 16,
      paddingBottom: 120,
    },
  });
