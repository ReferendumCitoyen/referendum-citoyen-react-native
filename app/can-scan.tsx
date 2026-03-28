import { useColors, Typography, Spacing } from "@/constants/theme";
import { useRouter, Stack } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  Image,
} from "react-native";
import { getRandomValues } from "expo-crypto";
import { Svg, Path } from "react-native-svg";

const ArrowLeftIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M19 12H5M5 12L12 19M5 12L12 5"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default function CanScanScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = createStyles(colors);

  const [can, setCan] = React.useState("");
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanStatus, setScanStatus] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<any>(null);
  const [nfcProgress, setNfcProgress] = React.useState(0);
  const progressQueueRef = React.useRef<number[]>([]);
  const isProcessingProgressRef = React.useRef(false);

  // Progress queue for smooth Android progress bar
  const queueProgressUpdate = React.useCallback((newProgress: number) => {
    if (Platform.OS !== 'android') return;
    progressQueueRef.current.push(newProgress);
    if (!isProcessingProgressRef.current) {
      processProgressQueue();
    }
  }, []);

  const processProgressQueue = React.useCallback(() => {
    if (progressQueueRef.current.length === 0) {
      isProcessingProgressRef.current = false;
      return;
    }
    isProcessingProgressRef.current = true;
    const nextProgress = progressQueueRef.current.shift()!;
    setNfcProgress(nextProgress);
    setTimeout(() => processProgressQueue(), 400);
  }, []);

  // Event listeners for scan progress
  React.useEffect(() => {
    let listeners: any[] = [];

    const setupEventListeners = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import('@/modules/e-document');

        listeners = [
          EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
            setScanStatus("📱 Approchez votre carte d'identité");
            queueProgressUpdate(10);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus("🔐 Authentification PACE...");
            queueProgressUpdate(25);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus("📖 Lecture des données...");
            queueProgressUpdate(60);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus("✅ Verification du chip...");
            queueProgressUpdate(85);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus("✅ Lecture réussie !");
            queueProgressUpdate(100);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus("❌ Erreur");
            progressQueueRef.current = [];
            isProcessingProgressRef.current = false;
            setNfcProgress(0);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.DebugLog, (event: unknown) => {
            const { message } = event as { message: string };
            console.log("[CAN-Scan]", message);
          }),
        ];
      } catch (error) {
        console.warn("Failed to setup event listeners:", error);
      }
    };

    setupEventListeners();

    return () => {
      listeners.forEach(listener => {
        try { listener.remove(); } catch {}
      });
    };
  }, []);

  const handleScan = async () => {
    if (can.length !== 6) {
      setError("Le CAN doit contenir exactement 6 chiffres");
      return;
    }

    setIsScanning(true);
    setError(null);
    setResult(null);
    setScanStatus("");
    progressQueueRef.current = [];
    isProcessingProgressRef.current = false;
    setNfcProgress(0);

    try {
      const { scanDocument } = await import('@/modules/e-document');
      const challenge = getRandomValues(new Uint8Array(32));

      const scanResult = await scanDocument('I', { can }, challenge);

      console.log("=== CAN SCAN RESULT ===");
      console.log("Person:", scanResult.personDetails);

      setResult(scanResult);
      setScanStatus("✅ Carte lue avec succès !");
    } catch (err: any) {
      console.error("Scan error:", err);
      setError(err.message || "Erreur lors de la lecture");
      setScanStatus("");
    } finally {
      setIsScanning(false);
    }
  };

  const isCanValid = can.length === 6;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan CAN</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Instructions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Comment ça marche ?</Text>
          <Text style={styles.cardText}>
            1. Trouvez le CAN (6 chiffres) sur votre carte d'identité{'\n'}
            2. Entrez le CAN ci-dessous{'\n'}
            3. Appuyez sur "Scanner" et approchez votre carte
          </Text>
        </View>

        {/* CAN Input */}
        <View style={styles.card}>
          <Text style={styles.inputLabel}>CAN (6 chiffres)</Text>
          <TextInput
            style={[styles.input, isCanValid && styles.inputValid]}
            value={can}
            onChangeText={(text) => setCan(text.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="numeric"
            maxLength={6}
            placeholder="123456"
            placeholderTextColor={colors.textSecondary}
            editable={!isScanning}
          />
          {isCanValid && (
            <Text style={styles.validText}>✓ CAN valide</Text>
          )}
        </View>

        {/* Scan Button */}
        <TouchableOpacity
          style={[styles.scanButton, (!isCanValid || isScanning) && styles.scanButtonDisabled]}
          onPress={handleScan}
          disabled={!isCanValid || isScanning}
        >
          <Text style={styles.scanButtonText}>
            {isScanning ? "Lecture en cours..." : "Scanner la carte"}
          </Text>
        </TouchableOpacity>

        {/* Progress (Android) */}
        {Platform.OS === 'android' && isScanning && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${nfcProgress}%` }]} />
            </View>
            <Text style={styles.progressText}>{nfcProgress}%</Text>
          </View>
        )}

        {/* Status */}
        {scanStatus ? (
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>{scanStatus}</Text>
          </View>
        ) : null}

        {/* Error */}
        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Erreur:</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Result */}
        {result?.personDetails ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Données lues</Text>

            {result.personDetails.passportImageRaw && (
              <Image
                source={{ uri: `data:image/jpeg;base64,${result.personDetails.passportImageRaw}` }}
                style={styles.photo}
                resizeMode="cover"
              />
            )}

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Nom:</Text>
              <Text style={styles.resultValue}>
                {result.personDetails.lastName || 'N/A'}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Prénom:</Text>
              <Text style={styles.resultValue}>
                {result.personDetails.firstName || 'N/A'}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Date de naissance:</Text>
              <Text style={styles.resultValue}>
                {result.personDetails.birthDate || 'N/A'}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Numéro:</Text>
              <Text style={styles.resultValue}>
                {result.personDetails.documentNumber || 'N/A'}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Nationalité:</Text>
              <Text style={styles.resultValue}>
                {result.personDetails.nationality || 'N/A'}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.screen.top,
    paddingHorizontal: Spacing.screen.horizontal,
    paddingBottom: 16,
    backgroundColor: colors.cardBackground,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 20,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.screen.horizontal,
    gap: 16,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
  },
  cardTitle: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 18,
    color: colors.text,
    marginBottom: 8,
  },
  cardText: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  inputLabel: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 16,
    color: colors.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16,
    fontSize: 24,
    fontFamily: Typography.fontFamily.semibold,
    color: colors.text,
    textAlign: 'center',
    letterSpacing: 8,
  },
  inputValid: {
    borderColor: '#10B981',
    borderWidth: 2,
  },
  validText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: 14,
    color: '#10B981',
    marginTop: 8,
    textAlign: 'center',
  },
  scanButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanButtonText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 18,
    color: '#FFFFFF',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  progressText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: 14,
    color: colors.text,
    width: 40,
  },
  statusContainer: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statusText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: 16,
    color: colors.text,
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 16,
  },
  errorTitle: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 16,
    color: '#DC2626',
    marginBottom: 4,
  },
  errorText: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: 14,
    color: '#DC2626',
  },
  resultCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
  },
  resultTitle: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 18,
    color: colors.text,
    marginBottom: 16,
  },
  photo: {
    width: 120,
    height: 150,
    borderRadius: 8,
    alignSelf: 'center',
    marginBottom: 16,
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
  },
  resultValue: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 14,
    color: colors.text,
  },
});
