import React from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors, Typography } from '@/constants/theme';

export function NfcDiagnosticCard() {
  const colors = useColors();
  const styles = createStyles(colors);

  const [isRunning, setIsRunning] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (Platform.OS !== 'ios') return null;

  const run = async () => {
    setIsRunning(true);
    setResult(null);
    setError(null);
    try {
      const { testNfcDetection } = await import('@/modules/e-document');
      const r = await testNfcDetection(30);
      setResult(r);
    } catch (ex: any) {
      setError(ex?.message || 'Erreur inconnue');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Diagnostic NFC</Text>
      <Text style={styles.helpText}>
        Teste la detection NFC brute sans PassportReader. Permet de verifier si
        le tag est detecte et quels AID sont disponibles.
      </Text>

      <TouchableOpacity
        style={[styles.button, isRunning && styles.disabled]}
        onPress={run}
        disabled={isRunning}
      >
        {isRunning ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.buttonText}>Detection en cours...</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Tester la detection NFC</Text>
        )}
      </TouchableOpacity>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Diagnostic: {error}</Text>
        </View>
      )}

      {result && (
        <View style={styles.results}>
          {/* Tag detected? */}
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Tag detecte:</Text>
            <Text
              style={[
                styles.resultValue,
                { color: result.tagDetected ? '#10B981' : '#EF4444' },
              ]}
            >
              {result.tagDetected ? 'OUI' : 'NON'}
            </Text>
          </View>

          {/* Tag info */}
          {result.tags?.map((tag: any, idx: number) => (
            <View key={idx}>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Type:</Text>
                <Text style={styles.resultValue}>{tag.type}</Text>
              </View>
              {tag.identifier && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>UID:</Text>
                  <Text style={styles.resultValue}>{tag.identifier}</Text>
                </View>
              )}
              {tag.initialSelectedAID !== undefined && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>AID initial:</Text>
                  <Text style={styles.resultValue}>
                    {tag.initialSelectedAID || '(vide)'}
                  </Text>
                </View>
              )}
              {tag.historicalBytes && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Hist. bytes:</Text>
                  <Text style={styles.resultValue}>{tag.historicalBytes}</Text>
                </View>
              )}
            </View>
          ))}

          {/* AID Probes */}
          {result.aidProbeResults?.length > 0 && (
            <>
              <Text style={styles.sectionSubtitle}>SELECT AID:</Text>
              {result.aidProbeResults.map((probe: any, idx: number) => (
                <View style={styles.resultRow} key={idx}>
                  <Text style={styles.resultLabel}>
                    {probe.name.split('(')[0].trim()}:
                  </Text>
                  <Text
                    style={[
                      styles.resultValue,
                      { color: probe.success ? '#10B981' : '#EF4444' },
                    ]}
                  >
                    {probe.success ? 'OK' : 'FAIL'} (SW={probe.sw})
                  </Text>
                </View>
              ))}
            </>
          )}

          {/* CardAccess */}
          {result.cardAccessProbe && (
            <>
              <Text style={styles.sectionSubtitle}>EF.CardAccess:</Text>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Status:</Text>
                <Text
                  style={[
                    styles.resultValue,
                    {
                      color: result.cardAccessProbe.success
                        ? '#10B981'
                        : '#EF4444',
                    },
                  ]}
                >
                  {result.cardAccessProbe.success
                    ? `OK (${result.cardAccessProbe.dataLength} bytes)`
                    : `FAIL at ${result.cardAccessProbe.step}`}
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      gap: 12,
    },
    cardTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 18,
      color: colors.text,
    },
    helpText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    button: {
      backgroundColor: '#7C3AED',
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    disabled: {
      opacity: 0.5,
    },
    buttonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: '#FFFFFF',
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    errorContainer: {
      backgroundColor: '#FEE2E2',
      borderRadius: 8,
      padding: 12,
    },
    errorText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: '#DC2626',
    },
    results: {
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 12,
      gap: 2,
    },
    resultRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    resultLabel: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
      flex: 1,
    },
    resultValue: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
      flex: 2,
      textAlign: 'right',
    },
    sectionSubtitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
    },
  });
