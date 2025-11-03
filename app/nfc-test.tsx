import { Colors, Spacing, Typography } from "@/constants/theme";
import { useRouter } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import NfcManager, { NfcTech } from "react-native-nfc-manager";
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-text-recognition";
import { Worklets } from "react-native-worklets-core";
import { parse } from "mrz";
import { getRandomValues } from "expo-crypto";

export default function NFCTestScreen() {
  const router = useRouter();
  const [tagData, setTagData] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanStatus, setScanStatus] = React.useState<string>("");

  // MRZ data for passport reading
  const [documentNo, setDocumentNo] = React.useState("");
  const [birthDate, setBirthDate] = React.useState(""); // YYMMDD format
  const [expiryDate, setExpiryDate] = React.useState(""); // YYMMDD format

  // Camera for MRZ scanning
  const [showCamera, setShowCamera] = React.useState(false);
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin' });

  // Listen to EDocument scan events
  React.useEffect(() => {
    let listeners: any[] = [];

    const setupEventListeners = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import('@/modules/e-document');

        listeners = [
          EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
            setScanStatus("📱 Approchez votre passeport du téléphone");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus("🔐 Authentification avec le passeport...");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus("📖 Lecture des données du passeport...");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus("✅ Authentification active...");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus("✅ Lecture réussie !");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus("❌ Erreur de lecture");
          }),
        ];
      } catch (error) {
        console.warn("Failed to setup event listeners:", error);
      }
    };

    setupEventListeners();

    return () => {
      listeners.forEach(listener => {
        try {
          listener.remove();
        } catch (error) {
          // Ignore cleanup errors
        }
      });
    };
  }, []);

  // MRZ Parser for passports
  const parseMRZ = React.useCallback((lines: string[]) => {
    try {
      const numlinesToCheck = 2;
      const possibleMRZLines = lines?.slice(-numlinesToCheck);

      if (!possibleMRZLines?.length || possibleMRZLines.length !== numlinesToCheck) return;

      const tdLength = 44;
      const sanitizedMRZLines = possibleMRZLines.map(el => {
        return el.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
      });

      sanitizedMRZLines[0] = sanitizedMRZLines[0].padEnd(tdLength, '<').toUpperCase();

      return parse(sanitizedMRZLines, { autocorrect: true });
    } catch (err) {
      console.log("MRZ parse error:", err);
      return null;
    }
  }, []);

  // Convert YYMMDD to YYYY-MM-DD
  const convertMRZDate = (yymmdd: string): string => {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd;

    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);

    // If year >= 50, it's 19YY (1950-1999), otherwise 20YY (2000-2049)
    const yyyy = yy >= 50 ? `19${yy}` : `20${yy}`;

    return `${yyyy}-${mm}-${dd}`;
  };

  // Convert YYYY-MM-DD back to YYMMDD for BAC
  const convertToMRZFormat = (date: string): string => {
    if (!date) return date;
    // If already in YYMMDD format, return as-is
    if (date.length === 6 && !date.includes('-')) return date;

    // Parse YYYY-MM-DD format
    const parts = date.split('-');
    if (parts.length !== 3) return date;

    const yyyy = parts[0];
    const mm = parts[1];
    const dd = parts[2];

    // Get last 2 digits of year
    const yy = yyyy.substring(2, 4);

    return `${yy}${mm}${dd}`;
  };

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    try {
      const result = parseMRZ(lines);

      if (result?.valid) {
        console.log("✅ MRZ Detected:", result.fields);

        // Auto-fill the form with converted dates
        setDocumentNo(result.fields.documentNumber || "");
        setBirthDate(convertMRZDate(result.fields.birthDate || ""));
        setExpiryDate(convertMRZDate(result.fields.expirationDate || ""));

        // Close camera
        setShowCamera(false);
        setError(null);
      }
    } catch (err) {
      console.log("MRZ detection error:", err);
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    runAtTargetFps(2, () => {
      'worklet';

      const data = scanText(frame);

      try {
        let resultText: string = '';

        if (data) {
          if (Array.isArray(data) && data.length) {
            resultText = data.map((el: any) => el.resultText).join('\n');
          } else if (data && 'resultText' in data) {
            resultText = (data as any).resultText as string;
          }

          if (resultText) {
            onMRZDetected(resultText.split('\n'));
          }
        }
      } catch (err) {
        console.log("Frame processing error:", err);
      }
    });
  }, [scanText, onMRZDetected]);

  async function openMRZScanner() {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        setError("Permission caméra refusée");
        return;
      }
    }
    setShowCamera(true);
    setError(null);
  }

  async function readNdef() {
    try {
      setIsScanning(true);
      setError(null);
      setTagData(null);

      // register for the NFC tag with NDEF in it
      await NfcManager.requestTechnology(NfcTech.Ndef);
      // the resolved tag object will contain `ndefMessage` property
      console.log(NfcManager.ndefHandler.getNdefMessage(), "HERE");
      const tag = await NfcManager.getTag();

      console.log("=== FULL TAG DATA ===");
      console.log("Tag object:", JSON.stringify(tag, null, 2));
      console.log("Tag keys:", Object.keys(tag || {}));
      console.log("NDEF message:", tag?.ndefMessage);
      console.log("=====================");

      setTagData(tag);
    } catch (ex: any) {
      console.warn("Oops!", ex);
      setError(ex?.message || "Unknown error");
    } finally {
      // stop the nfc scanning
      NfcManager.cancelTechnologyRequest();
      setIsScanning(false);
    }
  }

  async function readIsoDep() {
    try {
      setIsScanning(true);
      setError(null);
      setTagData(null);

      // register for IsoDep (for passports/ID cards)
      await NfcManager.requestTechnology(NfcTech.IsoDep);
      console.log(NfcManager.ndefHandler.getNdefMessage(), "HERE");
      const tag = await NfcManager.getTag();

      console.log("=== FULL ISODEP TAG DATA ===");
      console.log("Tag object:", JSON.stringify(tag, null, 2));
      console.log("Tag keys:", Object.keys(tag || {}));
      console.log("============================");

      setTagData(tag);
    } catch (ex: any) {
      console.warn("Oops!", ex);
      setError(ex?.message || "Unknown error");
    } finally {
      NfcManager.cancelTechnologyRequest();
      setIsScanning(false);
    }
  }

  async function readPassportWithEDocument() {
    try {
      setIsScanning(true);
      setError(null);
      setTagData(null);
      setScanStatus("");

      if (!documentNo || !birthDate || !expiryDate) {
        setError("Veuillez remplir tous les champs MRZ");
        setIsScanning(false);
        setScanStatus("");
        return;
      }

      console.log("=== STARTING EDOCUMENT READER ===");
      console.log("Document No:", documentNo);
      console.log("Birth Date:", birthDate);
      console.log("Expiry Date:", expiryDate);

      const { scanDocument } = await import('@/modules/e-document');

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));

      // Convert dates to YYMMDD format for BAC
      const bacBirthDate = convertToMRZFormat(birthDate);
      const bacExpiryDate = convertToMRZFormat(expiryDate);

      console.log("BAC Birth Date:", bacBirthDate);
      console.log("BAC Expiry Date:", bacExpiryDate);

      const result = await scanDocument('P', {
        documentNumber: documentNo,
        dateOfBirth: bacBirthDate,
        dateOfExpiry: bacExpiryDate,
      }, challenge);

      console.log("=== EDOCUMENT FULL RESULT ===");
      console.log(JSON.stringify(result, null, 2));
      console.log("=== EDOCUMENT PERSON DETAILS ===");
      console.log(JSON.stringify(result.personDetails, null, 2));
      console.log("=====================");

      console.log("✅ Scan completed successfully, updating UI...");
      console.log("Result object keys:", Object.keys(result || {}));
      console.log("personDetails exists?", !!result.personDetails);
      if (result.personDetails) {
        console.log("personDetails keys:", Object.keys(result.personDetails));
      }
      setScanStatus("✅ Scan terminé avec succès !");
      setTagData(result);
      setError(null);
    } catch (ex: any) {
      console.warn("EDocument error:", ex);
      setError(ex?.message || "Unknown error");
      setScanStatus("");
    } finally {
      console.log("Finally block: setting isScanning to false");
      setIsScanning(false);
      setTimeout(() => {
        console.log("Clearing scan status");
        setScanStatus("");
      }, 3000); // Clear status after 3 seconds
    }
  }

  return (
    <View style={styles.screenContainer}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Content */}
        <View style={styles.content}>
          {/* Camera Scanner */}
          {showCamera && device && (
            <View style={styles.cameraContainer}>
              <Camera
                style={styles.camera}
                device={device}
                isActive={showCamera}
                frameProcessor={frameProcessor}
              />
              <TouchableOpacity
                style={styles.closeCameraButton}
                onPress={() => setShowCamera(false)}
              >
                <Text style={styles.closeCameraText}>✕ Fermer</Text>
              </TouchableOpacity>
              <View style={styles.cameraOverlay}>
                <Text style={styles.cameraInstructions}>
                  Scannez les 2 lignes MRZ au bas du passeport
                </Text>
              </View>
            </View>
          )}

          {/* MRZ Input Section */}
          <View style={styles.mrzSection}>
            <Text style={styles.sectionTitle}>Données MRZ (au dos du passeport)</Text>

            <TouchableOpacity
              style={styles.cameraButton}
              onPress={openMRZScanner}
              activeOpacity={0.7}
            >
              <Text style={styles.cameraButtonText}>📷 Scanner avec caméra</Text>
            </TouchableOpacity>

            <Text style={styles.orText}>ou saisir manuellement:</Text>

            <TextInput
              style={styles.input}
              placeholder="Numéro de document (ex: 12AB34567)"
              value={documentNo}
              onChangeText={setDocumentNo}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Date de naissance (AAMMJJ)"
              value={birthDate}
              onChangeText={setBirthDate}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TextInput
              style={styles.input}
              placeholder="Date d'expiration (AAMMJJ)"
              value={expiryDate}
              onChangeText={setExpiryDate}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>

          {/* Passport Reading Buttons */}
          <Text style={styles.sectionTitle}>Lecture complète du passeport:</Text>

          <TouchableOpacity
            style={[styles.scanButton, styles.scanButtonSecondary, isScanning && styles.scanButtonDisabled]}
            onPress={readPassportWithEDocument}
            disabled={isScanning}
            activeOpacity={0.7}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? "Scan en cours..." : "📄 EDocument Module"}
            </Text>
          </TouchableOpacity>

          {/* Basic NFC Test Buttons */}
          <Text style={styles.sectionTitle}>Tests NFC basiques:</Text>

          <TouchableOpacity
            style={[styles.scanButton, styles.scanButtonTest, isScanning && styles.scanButtonDisabled]}
            onPress={readNdef}
            disabled={isScanning}
            activeOpacity={0.7}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? "Scan en cours..." : "Scanner Tag NDEF"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.scanButton,
              styles.scanButtonTest,
              isScanning && styles.scanButtonDisabled,
            ]}
            onPress={readIsoDep}
            disabled={isScanning}
            activeOpacity={0.7}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? "Scan en cours..." : "Scanner IsoDep (Passport)"}
            </Text>
          </TouchableOpacity>

          {scanStatus && isScanning && (
            <View style={styles.statusContainer}>
              <Text style={styles.statusText}>{scanStatus}</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>Erreur:</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {tagData && (
            <View style={styles.resultContainer}>
              <Text style={styles.resultTitle}>✅ Passeport scanné avec succès</Text>

              {tagData.personDetails ? (
                <>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Nom:</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.lastName || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Prénom:</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.firstName || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Date de naissance:</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.dateOfBirth || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Nationalité:</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.nationality || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>N° Document:</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.documentNumber || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Date d'expiration:</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.dateOfExpiry || 'N/A'}</Text>
                  </View>
                </>
              ) : (
                <Text style={styles.infoValue}>Données du passeport disponibles dans les logs</Text>
              )}

              <TouchableOpacity
                style={styles.viewRawButton}
                onPress={() => console.log("Full data:", JSON.stringify(tagData, null, 2))}
              >
                <Text style={styles.viewRawButtonText}>📋 Voir données brutes (logs)</Text>
              </TouchableOpacity>
            </View>
          )}

          {!error && !tagData && !isScanning && (
            <View style={styles.instructionContainer}>
              <Text style={styles.instructionText}>
                Appuyez sur le bouton et approchez un tag NFC de votre appareil.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: Spacing.screen.gap,
  },
  content: {
    padding: Spacing.screen.horizontal,
    gap: Spacing.screen.gap,
  },
  cameraContainer: {
    position: 'relative',
    width: '100%',
    height: 400,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  closeCameraButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  closeCameraText: {
    color: '#fff',
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 16,
  },
  cameraInstructions: {
    color: '#fff',
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    textAlign: 'center',
  },
  mrzSection: {
    backgroundColor: Colors.white,
    padding: Spacing.screen.horizontal,
    borderRadius: 12,
    gap: 12,
  },
  sectionTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.primary,
    marginTop: 8,
  },
  cameraButton: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cameraButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
  orText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: Colors.primary,
    textAlign: 'center',
    opacity: 0.6,
  },
  input: {
    backgroundColor: "#F3F4F6",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: Colors.primary,
  },
  scanButton: {
    paddingVertical: Spacing.screen.gap,
    paddingHorizontal: Spacing.screen.horizontal,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButtonPrimary: {
    backgroundColor: "#10B981",
  },
  scanButtonSecondary: {
    backgroundColor: "#3B82F6",
  },
  scanButtonTest: {
    backgroundColor: "#6B7280",
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
  statusContainer: {
    backgroundColor: "#DBEAFE",
    padding: Spacing.screen.horizontal,
    borderRadius: 12,
  },
  statusText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: "#1E40AF",
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: "#FEE2E2",
    padding: Spacing.screen.horizontal,
    borderRadius: 12,
  },
  errorTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: "#991B1B",
    marginBottom: 8,
  },
  errorText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: "#991B1B",
  },
  resultContainer: {
    backgroundColor: "#D1FAE5",
    padding: Spacing.screen.horizontal,
    borderRadius: 12,
  },
  resultTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: "#065F46",
    marginBottom: 16,
    textAlign: 'center',
  },
  resultText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: "#065F46",
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#A7F3D0',
  },
  infoLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    color: "#065F46",
    flex: 1,
  },
  infoValue: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: "#047857",
    flex: 2,
    textAlign: 'right',
  },
  viewRawButton: {
    marginTop: 16,
    backgroundColor: "#059669",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewRawButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    color: Colors.white,
  },
  instructionContainer: {
    backgroundColor: Colors.white,
    padding: Spacing.screen.horizontal,
    borderRadius: 12,
  },
  instructionText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: Colors.primary,
    textAlign: "center",
  },
});
