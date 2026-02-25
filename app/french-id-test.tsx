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
  Modal,
  ActivityIndicator,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
} from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-text-recognition";
import { Worklets } from "react-native-worklets-core";
import { parse } from "mrz";
import { getRandomValues } from "expo-crypto";
import {
  Rarime,
  RarimePassport,
  RarimeUtils,
  DocumentStatus,
} from "@rarimo/rarime-rn-sdk";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import { Svg, Path } from "react-native-svg";

// --- Constants ---

const RARIME_TESTNET_CONFIG = {
  contractsConfiguration: {
    stateKeeperAddress: "0x12883d5F530AF7EC2adD7cEC29Cf84215efCf4D8",
    registerSimpleContractAddress:
      "0x1b6ae4b80F0f26DC53731D1d7aA31fc3996B513B",
    poseidonSmtAddress: "0xb8bAac4C443097d697F87CC35C5d6B06dDe64D60",
  },
  apiConfiguration: {
    jsonRpcEvmUrl: "https://rpc.qtestnet.org",
    rarimeApiUrl: "https://api.orgs.app.stage.rarime.com",
  },
};

const PRIVATE_KEY_STORAGE_KEY = "rarime_bjj_private_key";

// --- Icons ---

const ArrowLeftIcon = ({
  color,
  size = 24,
}: {
  color: string;
  size?: number;
}) => (
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

// --- Helpers ---

const shortenValue = (value: any, maxLength = 50): string => {
  if (value === null || value === undefined) return "N/A";
  const str = String(value);
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
};

const getByteLength = (base64: string | undefined): string => {
  if (!base64) return "N/A";
  try {
    return `${Buffer.from(base64, "base64").length} bytes`;
  } catch {
    return "N/A";
  }
};

// --- Date helpers ---

const convertMRZDateToFrench = (yymmdd: string): string => {
  if (!yymmdd || yymmdd.length !== 6) return yymmdd;
  return `${yymmdd.substring(4, 6)}/${yymmdd.substring(2, 4)}/${yymmdd.substring(0, 2)}`;
};

const convertFrenchDateToMRZ = (frenchDate: string): string => {
  if (!frenchDate) return frenchDate;
  const cleaned = frenchDate.replace(/\s/g, "");
  if (cleaned.length === 6 && !cleaned.includes("/")) return cleaned;
  const parts = cleaned.split("/");
  if (parts.length !== 3) return frenchDate;
  return `${parts[2].padStart(2, "0")}${parts[1].padStart(2, "0")}${parts[0].padStart(2, "0")}`;
};

const formatDateToFrench = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).substring(2);
  return `${dd}/${mm}/${yy}`;
};

const formatDateInput = (text: string): string => {
  const digits = text.replace(/\D/g, "").substring(0, 6);
  if (digits.length === 0) return "";

  let day = digits.substring(0, 2);
  let month = digits.substring(2, 4);
  const year = digits.substring(4, 6);

  if (day.length === 2) {
    const n = parseInt(day, 10);
    if (n === 0) day = "01";
    if (n > 31) day = "31";
  } else if (day.length === 1 && parseInt(day, 10) > 3) {
    day = "0" + day;
  }

  if (month.length === 2) {
    const n = parseInt(month, 10);
    if (n === 0) month = "01";
    if (n > 12) month = "12";
  } else if (month.length === 1 && parseInt(month, 10) > 1) {
    month = "0" + month;
  }

  if (digits.length <= 2) return day;
  if (digits.length <= 4) return `${day}/${month}`;
  return `${day}/${month}/${year}`;
};

// =============================================================================
// Component
// =============================================================================

export default function FrenchIDTestScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = createStyles(colors);

  // --- State ---

  const [documentNo, setDocumentNo] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [expiryDate, setExpiryDate] = React.useState("");
  const [can] = React.useState(""); // CAN disabled — causes scan failures on iOS

  const [isScanning, setIsScanning] = React.useState(false);
  const [scanStatus, setScanStatus] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [tagData, setTagData] = React.useState<any>(null);

  const [nfcProgress, setNfcProgress] = React.useState(0);
  const progressQueueRef = React.useRef<number[]>([]);
  const isProcessingProgressRef = React.useRef(false);

  const [nfcLogs, setNfcLogs] = React.useState<string[]>([]);
  const [showLogs, setShowLogs] = React.useState(true);

  // NFC Diagnostic
  const [isDiagnosticRunning, setIsDiagnosticRunning] = React.useState(false);
  const [diagnosticResult, setDiagnosticResult] = React.useState<any>(null);

  // Date pickers
  const [showBirthDatePicker, setShowBirthDatePicker] = React.useState(false);
  const [showExpiryDatePicker, setShowExpiryDatePicker] = React.useState(false);
  const [birthDateObj, setBirthDateObj] = React.useState(new Date(1990, 0, 1));
  const [expiryDateObj, setExpiryDateObj] = React.useState(
    new Date(2030, 11, 31)
  );

  // Camera
  const [showCamera, setShowCamera] = React.useState(false);
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: "latin" });

  // Rarime
  const [privateKey, setPrivateKey] = React.useState<string | null>(null);
  const [profileKey, setProfileKey] = React.useState<string | null>(null);
  const [documentStatus, setDocumentStatus] = React.useState<string | null>(
    null
  );
  const [isCheckingStatus, setIsCheckingStatus] = React.useState(false);
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [registrationTxHash, setRegistrationTxHash] = React.useState<
    string | null
  >(null);
  const challengeRef = React.useRef<Uint8Array | null>(null);
  const rarimePassportRef = React.useRef<RarimePassport | null>(null);

  // --- Effects ---

  // Init BJJ private key
  React.useEffect(() => {
    (async () => {
      try {
        let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
        if (!storedKey) {
          storedKey = RarimeUtils.generateBJJPrivateKey();
          await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
        }
        setPrivateKey(storedKey);
        setProfileKey(RarimeUtils.getProfileKey(storedKey));
      } catch (err) {
        console.error("Failed to initialize private key:", err);
      }
    })();
  }, []);

  // Progress queue processor
  const processProgressQueue = React.useCallback(() => {
    if (progressQueueRef.current.length === 0) {
      isProcessingProgressRef.current = false;
      return;
    }
    isProcessingProgressRef.current = true;
    const next = progressQueueRef.current.shift()!;
    setNfcProgress(next);
    setTimeout(() => processProgressQueue(), 400);
  }, []);

  const queueProgressUpdate = React.useCallback(
    (value: number) => {
      if (Platform.OS !== "android") return;
      progressQueueRef.current.push(value);
      if (!isProcessingProgressRef.current) processProgressQueue();
    },
    [processProgressQueue]
  );

  // NFC event listeners
  React.useEffect(() => {
    let listeners: any[] = [];

    const setup = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import(
          "@/modules/e-document"
        );

        listeners = [
          EDocumentModuleListener(
            EDocumentModuleEvents.RequestPresentPassport,
            () => {
              setScanStatus("Approchez votre carte d'identite");
              queueProgressUpdate(10);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.AuthenticatingWithPassport,
            () => {
              setScanStatus("Authentification PACE...");
              queueProgressUpdate(25);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.ReadingDataGroupProgress,
            () => {
              setScanStatus("Lecture des donnees...");
              queueProgressUpdate(60);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.ActiveAuthentication,
            () => {
              setScanStatus("Verification du chip...");
              queueProgressUpdate(85);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.SuccessfulRead,
            () => {
              setScanStatus("Lecture reussie !");
              queueProgressUpdate(100);
            }
          ),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus("Erreur de lecture");
            progressQueueRef.current = [];
            isProcessingProgressRef.current = false;
            setNfcProgress(0);
          }),
          EDocumentModuleListener(
            EDocumentModuleEvents.DebugLog,
            (event: unknown) => {
              const { message } = event as { message: string };
              console.log("[FrenchID]", message);
              const ts = new Date().toISOString().split("T")[1].slice(0, 8);
              setNfcLogs((prev) => [...prev, `${ts} ${message}`]);
            }
          ),
        ];
      } catch (err) {
        console.warn("Failed to setup event listeners:", err);
      }
    };

    setup();

    return () => {
      listeners.forEach((l) => {
        try {
          l.remove();
        } catch {}
      });
    };
  }, [queueProgressUpdate]);

  // --- MRZ Parser ---

  const parseMRZ = React.useCallback((lines: string[]) => {
    if (lines.length < 3) return null;
    try {
      const td1Lines = lines.slice(-3);
      const sanitized = td1Lines.map((line) => {
        const cleaned = line
          .replaceAll("\u00AB", "<<")
          .replaceAll(" ", "")
          .toUpperCase();
        return cleaned.length > 30
          ? cleaned.substring(0, 30)
          : cleaned.padEnd(30, "<");
      });
      const result = parse(sanitized, { autocorrect: true });
      if (result?.valid && result.format === "TD1") return result;
    } catch {}
    return null;
  }, []);

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    try {
      const result = parseMRZ(lines);
      if (result?.valid) {
        setDocumentNo(
          (result.fields.documentNumber || "").trim().toUpperCase()
        );
        setBirthDate(convertMRZDateToFrench(result.fields.birthDate || ""));
        setExpiryDate(
          convertMRZDateToFrench(result.fields.expirationDate || "")
        );
        setShowCamera(false);
        setError(null);
      }
    } catch {}
  });

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      runAtTargetFps(2, () => {
        "worklet";
        const data = scanText(frame);
        try {
          let resultText = "";
          if (data) {
            if (Array.isArray(data) && data.length) {
              resultText = data.map((el: any) => el.resultText).join("\n");
            } else if (data && "resultText" in data) {
              resultText = (data as any).resultText as string;
            }
            if (resultText) onMRZDetected(resultText.split("\n"));
          }
        } catch {}
      });
    },
    [scanText, onMRZDetected]
  );

  // --- Handlers ---

  const openMRZScanner = async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        setError("Permission camera refusee");
        return;
      }
    }
    setShowCamera(true);
    setError(null);
  };

  const onBirthDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") setShowBirthDatePicker(false);
    if (selectedDate) {
      setBirthDateObj(selectedDate);
      setBirthDate(formatDateToFrench(selectedDate));
    }
  };

  const onExpiryDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") setShowExpiryDatePicker(false);
    if (selectedDate) {
      setExpiryDateObj(selectedDate);
      setExpiryDate(formatDateToFrench(selectedDate));
    }
  };

  const handleScan = async () => {
    if (!documentNo || !birthDate || !expiryDate) {
      setError("Veuillez remplir tous les champs MRZ");
      return;
    }
    setIsScanning(true);
    setError(null);
    setTagData(null);
    setScanStatus("");
    progressQueueRef.current = [];
    isProcessingProgressRef.current = false;
    setNfcProgress(0);

    try {
      const { scanDocument } = await import("@/modules/e-document");
      const challenge = getRandomValues(new Uint8Array(32));
      challengeRef.current = challenge;

      const bacBirthDate = convertFrenchDateToMRZ(birthDate);
      const bacExpiryDate = convertFrenchDateToMRZ(expiryDate);

      const result = await scanDocument(
        "I",
        {
          documentNumber: documentNo,
          dateOfBirth: bacBirthDate,
          dateOfExpiry: bacExpiryDate,
        },
        challenge
      );

      console.log("=== FRENCH ID SCAN RESULT ===");
      const { passportImageRaw, ...personSummary } = result.personDetails;
      console.log("Person:", personSummary);
      console.log("Image:", passportImageRaw ? `${passportImageRaw.length} chars` : "none");

      // --- Rarime SDK integration ---
      const dg1 = new Uint8Array(result.dg1Bytes);
      const sod = new Uint8Array(result.sodBytes);

      try {
        // French ID cards don't have DG15 or Active Authentication
        const rarimePassport = new RarimePassport({
          dataGroup1: dg1,
          sod: sod,
        });
        rarimePassportRef.current = rarimePassport;

        // Check document status
        if (privateKey) {
          setIsCheckingStatus(true);
          setDocumentStatus(null);
          try {
            const rarime = new Rarime({
              ...RARIME_TESTNET_CONFIG,
              userConfiguration: { userPrivateKey: privateKey },
            });
            const status = await rarime.getDocumentStatus(rarimePassport);
            setDocumentStatus(status);
          } catch (statusErr) {
            setDocumentStatus(
              "ERROR: " + (statusErr as Error).message
            );
          } finally {
            setIsCheckingStatus(false);
          }
        }
      } catch (rarimeErr) {
        console.error("Rarime SDK Error:", rarimeErr);
      }

      setScanStatus("Scan termine avec succes !");
      setTagData(result);
      setError(null);
    } catch (ex: any) {
      console.warn("EDocument error:", ex);
      setError(ex?.message || "Erreur inconnue");
      setScanStatus("");
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanStatus(""), 3000);
    }
  };

  const registerIdentity = async () => {
    if (!privateKey || !rarimePassportRef.current) {
      setError(
        "Carte d'identite non scannee ou cle privee non disponible"
      );
      return;
    }
    setIsRegistering(true);
    setRegistrationTxHash(null);
    try {
      const rarime = new Rarime({
        ...RARIME_TESTNET_CONFIG,
        userConfiguration: { userPrivateKey: privateKey },
      });
      const txHash = await rarime.registerIdentity(
        rarimePassportRef.current
      );
      setRegistrationTxHash(txHash.toString());
      setDocumentStatus(DocumentStatus.RegisteredWithThisPk);
    } catch (regErr) {
      setError("Registration failed: " + (regErr as Error).message);
    } finally {
      setIsRegistering(false);
    }
  };

  const resetPrivateKey = async () => {
    await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
    const newKey = RarimeUtils.generateBJJPrivateKey();
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, newKey);
    setPrivateKey(newKey);
    setProfileKey(RarimeUtils.getProfileKey(newKey));
    setDocumentStatus(null);
    setRegistrationTxHash(null);
  };

  const handleNfcDiagnostic = async () => {
    setIsDiagnosticRunning(true);
    setDiagnosticResult(null);
    setError(null);
    setNfcLogs([]);

    try {
      const { testNfcDetection } = await import("@/modules/e-document");
      const result = await testNfcDetection(30);
      setDiagnosticResult(result);
    } catch (ex: any) {
      setError("Diagnostic: " + (ex?.message || "Erreur inconnue"));
    } finally {
      setIsDiagnosticRunning(false);
    }
  };

  // --- Render ---

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeftIcon color={colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Test French ID</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* iOS Info Notice */}
        {Platform.OS === "ios" && (
          <View style={styles.iosNotice}>
            <Text style={styles.iosNoticeTitle}>
              Lecture NFC sur iPhone
            </Text>
            <Text style={styles.iosNoticeText}>
              La lecture NFC des cartes d'identite francaises est supportee.
              La lecture peut etre plus lente que sur Android.
            </Text>
          </View>
        )}

        {/* NFC Diagnostic (iOS only) */}
        {Platform.OS === "ios" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Diagnostic NFC</Text>
            <Text style={styles.diagnosticHelpText}>
              Teste la detection NFC brute sans PassportReader. Permet de
              verifier si le tag est detecte et quels AID sont disponibles.
            </Text>

            <TouchableOpacity
              style={[
                styles.diagnosticButton,
                isDiagnosticRunning && styles.buttonDisabled,
              ]}
              onPress={handleNfcDiagnostic}
              disabled={isDiagnosticRunning}
            >
              {isDiagnosticRunning ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.diagnosticButtonText}>
                    Detection en cours...
                  </Text>
                </View>
              ) : (
                <Text style={styles.diagnosticButtonText}>
                  Tester la detection NFC
                </Text>
              )}
            </TouchableOpacity>

            {diagnosticResult && (
              <View style={styles.diagnosticResults}>
                {/* Tag detected? */}
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Tag detecte:</Text>
                  <Text
                    style={[
                      styles.resultValue,
                      {
                        color: diagnosticResult.tagDetected
                          ? "#10B981"
                          : "#EF4444",
                      },
                    ]}
                  >
                    {diagnosticResult.tagDetected ? "OUI" : "NON"}
                  </Text>
                </View>

                {/* Tag info */}
                {diagnosticResult.tags?.map((tag: any, idx: number) => (
                  <View key={idx}>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Type:</Text>
                      <Text style={styles.resultValue}>{tag.type}</Text>
                    </View>
                    {tag.identifier && (
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>UID:</Text>
                        <Text style={styles.resultValue}>
                          {tag.identifier}
                        </Text>
                      </View>
                    )}
                    {tag.initialSelectedAID !== undefined && (
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>AID initial:</Text>
                        <Text style={styles.resultValue}>
                          {tag.initialSelectedAID || "(vide)"}
                        </Text>
                      </View>
                    )}
                    {tag.historicalBytes && (
                      <View style={styles.resultRow}>
                        <Text style={styles.resultLabel}>Hist. bytes:</Text>
                        <Text style={styles.resultValue}>
                          {tag.historicalBytes}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}

                {/* AID Probes */}
                {diagnosticResult.aidProbeResults?.length > 0 && (
                  <>
                    <Text style={styles.sectionSubtitle}>SELECT AID:</Text>
                    {diagnosticResult.aidProbeResults.map(
                      (probe: any, idx: number) => (
                        <View style={styles.resultRow} key={idx}>
                          <Text style={styles.resultLabel}>
                            {probe.name.split("(")[0].trim()}:
                          </Text>
                          <Text
                            style={[
                              styles.resultValue,
                              {
                                color: probe.success ? "#10B981" : "#EF4444",
                              },
                            ]}
                          >
                            {probe.success ? "OK" : "FAIL"} (SW={probe.sw})
                          </Text>
                        </View>
                      )
                    )}
                  </>
                )}

                {/* CardAccess */}
                {diagnosticResult.cardAccessProbe && (
                  <>
                    <Text style={styles.sectionSubtitle}>
                      EF.CardAccess:
                    </Text>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Status:</Text>
                      <Text
                        style={[
                          styles.resultValue,
                          {
                            color: diagnosticResult.cardAccessProbe.success
                              ? "#10B981"
                              : "#EF4444",
                          },
                        ]}
                      >
                        {diagnosticResult.cardAccessProbe.success
                          ? `OK (${diagnosticResult.cardAccessProbe.dataLength} bytes)`
                          : `FAIL at ${diagnosticResult.cardAccessProbe.step}`}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        )}

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
              <Text style={styles.closeCameraText}>Fermer</Text>
            </TouchableOpacity>
            <View style={styles.cameraOverlay}>
              <Text style={styles.cameraInstructions}>
                Scannez les 3 lignes MRZ au dos de la carte d'identite
              </Text>
            </View>
          </View>
        )}

        {/* Rarime Testnet Status */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rarime Testnet</Text>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Profile Key:</Text>
            <Text style={styles.resultValue} numberOfLines={1}>
              {profileKey
                ? `${profileKey.substring(0, 12)}...`
                : "Loading..."}
            </Text>
          </View>

          {documentStatus && (
            <View
              style={[
                styles.statusBadge,
                documentStatus === DocumentStatus.NotRegistered &&
                  styles.statusNotRegistered,
                documentStatus === DocumentStatus.RegisteredWithThisPk &&
                  styles.statusRegisteredOwn,
                documentStatus === DocumentStatus.RegisteredWithOtherPk &&
                  styles.statusRegisteredOther,
                typeof documentStatus === "string" &&
                  documentStatus.startsWith("ERROR") &&
                  styles.statusError,
              ]}
            >
              <Text style={styles.statusBadgeText}>
                {documentStatus === DocumentStatus.NotRegistered &&
                  "Not Registered"}
                {documentStatus === DocumentStatus.RegisteredWithThisPk &&
                  "Registered (Your Key)"}
                {documentStatus === DocumentStatus.RegisteredWithOtherPk &&
                  "Registered (Other Key)"}
                {typeof documentStatus === "string" &&
                  documentStatus.startsWith("ERROR") &&
                  documentStatus}
              </Text>
            </View>
          )}

          {isCheckingStatus && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>
                Checking status on testnet...
              </Text>
            </View>
          )}

          {documentStatus === DocumentStatus.NotRegistered &&
            rarimePassportRef.current && (
              <TouchableOpacity
                style={[
                  styles.registerButton,
                  isRegistering && styles.buttonDisabled,
                ]}
                onPress={registerIdentity}
                disabled={isRegistering}
              >
                {isRegistering ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.registerButtonText}>
                      Registering (~5s)...
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.registerButtonText}>
                    Register Identity on Testnet
                  </Text>
                )}
              </TouchableOpacity>
            )}

          {registrationTxHash && (
            <View style={styles.txHashContainer}>
              <Text style={styles.resultLabel}>TX Hash:</Text>
              <Text style={styles.resultValue} numberOfLines={1}>
                {registrationTxHash}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.resetButton}
            onPress={resetPrivateKey}
          >
            <Text style={styles.resetButtonText}>Reset Private Key</Text>
          </TouchableOpacity>
        </View>

        {/* MRZ Input Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Donnees MRZ (au dos de la carte)
          </Text>

          <TouchableOpacity
            style={styles.cameraButton}
            onPress={openMRZScanner}
          >
            <Text style={styles.cameraButtonText}>
              Scanner avec camera
            </Text>
          </TouchableOpacity>

          <Text style={styles.orText}>ou saisir manuellement:</Text>

          {/* Document number */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Numero de document</Text>
            <TextInput
              style={styles.input}
              placeholder="12AB34567"
              placeholderTextColor={colors.textSecondary}
              value={documentNo}
              onChangeText={(t) => setDocumentNo(t.trim().toUpperCase())}
              autoCapitalize="characters"
              editable={!isScanning}
            />
          </View>

          {/* Birth date */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Date de naissance</Text>
            <View style={styles.dateInputRow}>
              <TextInput
                style={[styles.input, styles.dateInput]}
                placeholder="JJ/MM/AA"
                placeholderTextColor={colors.textSecondary}
                value={birthDate}
                onChangeText={(t) => setBirthDate(formatDateInput(t))}
                keyboardType="numeric"
                maxLength={8}
                editable={!isScanning}
              />
              <TouchableOpacity
                style={styles.calendarButton}
                onPress={() => setShowBirthDatePicker(true)}
              >
                <Text style={styles.calendarButtonText}>Cal.</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Expiry date */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Date d'expiration</Text>
            <View style={styles.dateInputRow}>
              <TextInput
                style={[styles.input, styles.dateInput]}
                placeholder="JJ/MM/AA"
                placeholderTextColor={colors.textSecondary}
                value={expiryDate}
                onChangeText={(t) => setExpiryDate(formatDateInput(t))}
                keyboardType="numeric"
                maxLength={8}
                editable={!isScanning}
              />
              <TouchableOpacity
                style={styles.calendarButton}
                onPress={() => setShowExpiryDatePicker(true)}
              >
                <Text style={styles.calendarButtonText}>Cal.</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Date Picker Modals */}
          {Platform.OS === "ios" ? (
            <>
              <Modal
                visible={showBirthDatePicker}
                transparent
                animationType="slide"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>
                        Date de naissance
                      </Text>
                      <TouchableOpacity
                        onPress={() => setShowBirthDatePicker(false)}
                        style={styles.modalCloseButton}
                      >
                        <Text style={styles.modalCloseText}>Fermer</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={birthDateObj}
                      mode="date"
                      display="spinner"
                      onChange={onBirthDateChange}
                      maximumDate={new Date()}
                      style={styles.datePicker}
                      locale="fr-FR"
                      textColor={colors.text}
                      themeVariant="light"
                    />
                  </View>
                </View>
              </Modal>
              <Modal
                visible={showExpiryDatePicker}
                transparent
                animationType="slide"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>
                        Date d'expiration
                      </Text>
                      <TouchableOpacity
                        onPress={() => setShowExpiryDatePicker(false)}
                        style={styles.modalCloseButton}
                      >
                        <Text style={styles.modalCloseText}>Fermer</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={expiryDateObj}
                      mode="date"
                      display="spinner"
                      onChange={onExpiryDateChange}
                      minimumDate={new Date()}
                      style={styles.datePicker}
                      locale="fr-FR"
                      textColor={colors.text}
                      themeVariant="light"
                    />
                  </View>
                </View>
              </Modal>
            </>
          ) : (
            <>
              {showBirthDatePicker && (
                <DateTimePicker
                  value={birthDateObj}
                  mode="date"
                  display="default"
                  onChange={onBirthDateChange}
                  maximumDate={new Date()}
                />
              )}
              {showExpiryDatePicker && (
                <DateTimePicker
                  value={expiryDateObj}
                  mode="date"
                  display="default"
                  onChange={onExpiryDateChange}
                  minimumDate={new Date()}
                />
              )}
            </>
          )}
        </View>

        {/* Scan Button */}
        <TouchableOpacity
          style={[
            styles.scanButton,
            (!documentNo || !birthDate || !expiryDate || isScanning) &&
              styles.buttonDisabled,
          ]}
          onPress={handleScan}
          disabled={!documentNo || !birthDate || !expiryDate || isScanning}
        >
          <Text style={styles.scanButtonText}>
            {isScanning ? "Scan en cours..." : "Scanner la carte NFC"}
          </Text>
        </TouchableOpacity>

        {/* Progress (Android) */}
        {Platform.OS === "android" && isScanning && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${nfcProgress}%` }]}
              />
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

        {/* Results */}
        {tagData?.personDetails && (
          <View style={styles.resultCard}>
            <Text style={styles.cardTitle}>
              Carte d'identite scannee
            </Text>

            <Text style={styles.sectionSubtitle}>Champs disponibles:</Text>
            <Text style={styles.fieldsListText}>
              {Object.keys(tagData).join(", ")}
            </Text>

            {tagData.personDetails.passportImageRaw && (
              <Image
                source={{
                  uri: `data:image/jpeg;base64,${tagData.personDetails.passportImageRaw}`,
                }}
                style={styles.photo}
                resizeMode="cover"
              />
            )}

            <Text style={styles.sectionSubtitle}>Details personnels:</Text>
            {Object.entries(tagData.personDetails).map(([key, value]) => (
              <View style={styles.resultRow} key={key}>
                <Text style={styles.resultLabel}>{key}:</Text>
                <Text style={styles.resultValue}>
                  {shortenValue(value)}
                </Text>
              </View>
            ))}

            <Text style={styles.sectionSubtitle}>Donnees brutes:</Text>
            {(
              [
                ["SOD", tagData.sodBytes],
                ["DG1", tagData.dg1Bytes],
                ["DG11", tagData.dg11Bytes],
              ] as [string, string | undefined][]
            ).map(([label, val]) => (
              <View style={styles.resultRow} key={label}>
                <Text style={styles.resultLabel}>{label}:</Text>
                <Text style={styles.resultValue}>
                  {getByteLength(val)}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={styles.viewRawButton}
              onPress={() =>
                console.log(
                  "Full data:",
                  JSON.stringify(tagData, null, 2)
                )
              }
            >
              <Text style={styles.viewRawButtonText}>
                Voir donnees brutes (logs)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* NFC Debug Logs */}
        <View style={styles.logsSection}>
          <TouchableOpacity
            style={styles.logsHeader}
            onPress={() => setShowLogs(!showLogs)}
          >
            <Text style={styles.logsTitle}>
              {showLogs ? "\u25BC" : "\u25B6"} NFC Debug Logs (
              {nfcLogs.length})
            </Text>
            <TouchableOpacity
              onPress={() => setNfcLogs([])}
              style={styles.clearLogsButton}
            >
              <Text style={styles.clearLogsText}>Clear</Text>
            </TouchableOpacity>
          </TouchableOpacity>

          {showLogs && (
            <ScrollView
              style={styles.logsContainer}
              nestedScrollEnabled
              contentContainerStyle={styles.logsContentContainer}
            >
              {nfcLogs.length === 0 ? (
                <Text style={styles.logLine}>
                  No logs yet. Start a scan to see NFC debug output.
                </Text>
              ) : (
                nfcLogs.map((log, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.logLine,
                      log.includes("[TX]") && styles.logTx,
                      log.includes("[RX]") && styles.logRx,
                      log.includes("[ERROR]") && styles.logError,
                      log.includes("===") && styles.logHeader,
                    ]}
                  >
                    {log}
                  </Text>
                ))
              )}
            </ScrollView>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: Spacing.screen.top,
      paddingHorizontal: Spacing.screen.horizontal,
      paddingBottom: 16,
      backgroundColor: colors.cardBackground,
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: "center",
      alignItems: "center",
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

    // iOS notice
    iosNotice: {
      backgroundColor: "#DBEAFE",
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: "#3B82F6",
    },
    iosNoticeTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#1E40AF",
      marginBottom: 8,
    },
    iosNoticeText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: "#1E40AF",
      lineHeight: 20,
    },

    // NFC Diagnostic
    diagnosticHelpText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    diagnosticButton: {
      backgroundColor: "#7C3AED",
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: "center",
    },
    diagnosticButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#FFFFFF",
    },
    diagnosticResults: {
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 12,
      gap: 2,
    },

    // Cards
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
    sectionSubtitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
    },
    fieldsListText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.textSecondary,
    },

    // Inputs
    inputGroup: {
      gap: 6,
    },
    inputLabel: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
    },
    labelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      fontFamily: Typography.fontFamily.medium,
      color: colors.text,
      backgroundColor: colors.cardBackground,
    },
    inputValid: {
      borderColor: "#10B981",
      borderWidth: 2,
    },
    inputWarning: {
      borderColor: "#F59E0B",
      borderWidth: 2,
    },
    validationIndicator: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 12,
    },
    validationOk: {
      color: "#10B981",
    },
    validationPending: {
      color: "#F59E0B",
    },
    dateInputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    dateInput: {
      flex: 1,
    },
    calendarButton: {
      backgroundColor: colors.primary,
      padding: 12,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 44,
      height: 44,
    },
    calendarButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },
    orText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
    },

    // Camera
    cameraContainer: {
      position: "relative",
      width: "100%",
      height: 400,
      backgroundColor: "#000",
      borderRadius: 12,
      overflow: "hidden",
    },
    camera: {
      width: "100%",
      height: "100%",
    },
    closeCameraButton: {
      position: "absolute",
      top: 16,
      right: 16,
      backgroundColor: "rgba(0,0,0,0.6)",
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
    },
    closeCameraText: {
      color: "#fff",
      fontFamily: Typography.fontFamily.bold,
      fontSize: 14,
    },
    cameraOverlay: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: "rgba(0,0,0,0.6)",
      padding: 16,
    },
    cameraInstructions: {
      color: "#fff",
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      textAlign: "center",
    },
    cameraButton: {
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    cameraButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#FFFFFF",
    },

    // Scan button
    scanButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      padding: 18,
      alignItems: "center",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    scanButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 18,
      color: "#FFFFFF",
    },

    // Progress
    progressContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    progressBar: {
      flex: 1,
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.primary,
    },
    progressText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.text,
      width: 40,
    },

    // Status
    statusContainer: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      alignItems: "center",
    },
    statusText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 16,
      color: colors.text,
    },

    // Error
    errorContainer: {
      backgroundColor: "#FEE2E2",
      borderRadius: 12,
      padding: 16,
    },
    errorTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#DC2626",
      marginBottom: 4,
    },
    errorText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: "#DC2626",
    },

    // Results
    resultCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      gap: 4,
    },
    resultRow: {
      flexDirection: "row",
      justifyContent: "space-between",
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
      textAlign: "right",
    },
    photo: {
      width: 120,
      height: 150,
      borderRadius: 8,
      alignSelf: "center",
      marginVertical: 12,
    },
    viewRawButton: {
      marginTop: 12,
      backgroundColor: colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center",
    },
    viewRawButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },

    // Rarime status badges
    statusBadge: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    statusNotRegistered: {
      backgroundColor: colors.border,
    },
    statusRegisteredOwn: {
      backgroundColor: "#D1FAE5",
    },
    statusRegisteredOther: {
      backgroundColor: "#FEF3C7",
    },
    statusError: {
      backgroundColor: "#FEE2E2",
    },
    statusBadgeText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    loadingText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
    },
    registerButton: {
      backgroundColor: "#10B981",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center",
    },
    registerButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#FFFFFF",
    },
    txHashContainer: {
      backgroundColor: colors.border,
      padding: 12,
      borderRadius: 8,
    },
    resetButton: {
      backgroundColor: colors.border,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
      alignItems: "center",
    },
    resetButtonText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
    },

    // Date picker modal
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 40,
      alignItems: "center",
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      width: "100%",
    },
    modalTitle: {
      fontSize: 18,
      fontFamily: Typography.fontFamily.bold,
      color: colors.text,
    },
    modalCloseButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      backgroundColor: colors.primary,
      borderRadius: 8,
    },
    modalCloseText: {
      fontSize: 16,
      fontFamily: Typography.fontFamily.bold,
      color: "#FFFFFF",
    },
    datePicker: {
      width: "100%",
      height: 200,
      alignSelf: "center",
    },

    // NFC Debug Logs
    logsSection: {
      backgroundColor: "#1F2937",
      borderRadius: 12,
      overflow: "hidden",
    },
    logsHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 12,
      backgroundColor: "#374151",
    },
    logsTitle: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: 16,
      color: "#F9FAFB",
    },
    clearLogsButton: {
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: "#4B5563",
      borderRadius: 6,
    },
    clearLogsText: {
      color: "#EF4444",
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
    },
    logsContainer: {
      maxHeight: 300,
    },
    logsContentContainer: {
      padding: 12,
    },
    logLine: {
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      fontSize: 11,
      color: "#D1D5DB",
      marginBottom: 2,
      lineHeight: 16,
    },
    logTx: {
      color: "#60A5FA",
    },
    logRx: {
      color: "#34D399",
    },
    logError: {
      color: "#EF4444",
    },
    logHeader: {
      color: "#FBBF24",
      fontFamily: Typography.fontFamily.bold,
    },
  });
