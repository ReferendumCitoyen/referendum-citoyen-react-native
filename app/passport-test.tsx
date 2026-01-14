import { Colors, Spacing, Typography } from "@/constants/theme";
import { useRouter, Stack } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import DateTimePicker from '@react-native-community/datetimepicker';
import NfcManager, { NfcTech } from "react-native-nfc-manager";
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-text-recognition";
import { Worklets } from "react-native-worklets-core";
import { parse } from "mrz";
import { getRandomValues } from "expo-crypto";
import { Rarime, RarimePassport, RarimeUtils, DocumentStatus } from "@rarimo/rarime-rn-sdk";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";

// Rarime Testnet Configuration
const RARIME_TESTNET_CONFIG = {
  contractsConfiguration: {
    stateKeeperAddress: '0x12883d5F530AF7EC2adD7cEC29Cf84215efCf4D8',
    registerSimpleContractAddress: '0x1b6ae4b80F0f26DC53731D1d7aA31fc3996B513B',
    poseidonSmtAddress: '0xb8bAac4C443097d697F87CC35C5d6B06dDe64D60',
  },
  apiConfiguration: {
    jsonRpcEvmUrl: 'https://rpc.qtestnet.org',
    rarimeApiUrl: 'https://api.orgs.app.stage.rarime.com',
  },
};

const PRIVATE_KEY_STORAGE_KEY = 'rarime_bjj_private_key';

// Helper function to convert base64 to Uint8Array (React Native compatible)
const base64ToUint8Array = (base64: string): Uint8Array => {
  // Use Buffer which is polyfilled for React Native
  const buffer = Buffer.from(base64, 'base64');
  return new Uint8Array(buffer);
};

export default function PassportTestScreen() {
  const router = useRouter();
  const [tagData, setTagData] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanStatus, setScanStatus] = React.useState<string>("");

  // MRZ data for passport reading
  const [documentNo, setDocumentNo] = React.useState("");
  const [birthDate, setBirthDate] = React.useState(""); // JJ/MM/AA format for display
  const [expiryDate, setExpiryDate] = React.useState(""); // JJ/MM/AA format for display

  // Date picker state
  const [showBirthDatePicker, setShowBirthDatePicker] = React.useState(false);
  const [showExpiryDatePicker, setShowExpiryDatePicker] = React.useState(false);
  const [birthDateObj, setBirthDateObj] = React.useState(new Date(1990, 0, 1));
  const [expiryDateObj, setExpiryDateObj] = React.useState(new Date(2030, 11, 31));

  // Camera for MRZ scanning
  const [showCamera, setShowCamera] = React.useState(false);
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin' });

  // Store challenge for RarimePassport
  const challengeRef = React.useRef<Uint8Array | null>(null);

  // Rarime state
  const [privateKey, setPrivateKey] = React.useState<string | null>(null);
  const [profileKey, setProfileKey] = React.useState<string | null>(null);
  const [documentStatus, setDocumentStatus] = React.useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = React.useState(false);
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [registrationTxHash, setRegistrationTxHash] = React.useState<string | null>(null);
  const rarimePassportRef = React.useRef<RarimePassport | null>(null);

  // Load or generate BJJ private key on mount
  React.useEffect(() => {
    const initPrivateKey = async () => {
      try {
        console.log('=== RARIME TESTNET INIT ===');
        let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);

        if (!storedKey) {
          console.log('No stored private key found, generating new one...');
          storedKey = RarimeUtils.generateBJJPrivateKey();
          await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
          console.log('New private key generated and stored');
        } else {
          console.log('Loaded existing private key from storage');
        }

        setPrivateKey(storedKey);
        const derivedProfileKey = RarimeUtils.getProfileKey(storedKey);
        setProfileKey(derivedProfileKey);

        console.log(`Private Key: ${storedKey.substring(0, 8)}...${storedKey.substring(56)}`);
        console.log(`Profile Key: ${derivedProfileKey.substring(0, 8)}...${derivedProfileKey.substring(56)}`);
        console.log('=== RARIME TESTNET INIT COMPLETE ===');
      } catch (error) {
        console.error('Failed to initialize private key:', error);
      }
    };

    initPrivateKey();
  }, []);

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

  // MRZ Parser for passports (TD3: 2 lines, 44 chars)
  const parseMRZ = React.useCallback((lines: string[]) => {
    if (lines.length < 2) return null;

    try {
      // Take last 2 lines for TD3 passport format
      const td3Lines = lines.slice(-2);

      // Normalize each line to exactly 44 chars
      const sanitized = td3Lines.map(line => {
        const cleaned = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
        if (cleaned.length > 44) return cleaned.substring(0, 44);
        return cleaned.padEnd(44, '<');
      });

      console.log("Trying TD3 parse:", sanitized);

      const result = parse(sanitized, { autocorrect: true });
      if (result?.valid && result.format === 'TD3') {
        console.log("✅ TD3 Passport detected:", result.fields);
        return result;
      }
    } catch (err) {
      console.log("TD3 parse error:", err);
    }

    return null;
  }, []);

  // Convert YYMMDD to DD/MM/YY (French format)
  const convertMRZDateToFrench = (yymmdd: string): string => {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd;

    const yy = yymmdd.substring(0, 2);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);

    return `${dd}/${mm}/${yy}`;
  };

  // Convert DD/MM/YY (French format) to YYMMDD for BAC
  const convertFrenchDateToMRZ = (frenchDate: string): string => {
    if (!frenchDate) return frenchDate;

    // Remove any spaces
    const cleaned = frenchDate.replace(/\s/g, '');

    // If already in YYMMDD format (6 digits, no slashes), return as-is
    if (cleaned.length === 6 && !cleaned.includes('/')) return cleaned;

    // Parse DD/MM/YY format
    const parts = cleaned.split('/');
    if (parts.length !== 3) return frenchDate;

    const dd = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    const yy = parts[2].padStart(2, '0');

    return `${yy}${mm}${dd}`;
  };

  // Convert Date object to French format DD/MM/YY
  const formatDateToFrench = (date: Date): string => {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).substring(2);
    return `${dd}/${mm}/${yy}`;
  };

  // Handle date picker changes
  const onBirthDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowBirthDatePicker(false);
    }
    if (selectedDate) {
      setBirthDateObj(selectedDate);
      setBirthDate(formatDateToFrench(selectedDate));
    }
  };

  const onExpiryDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowExpiryDatePicker(false);
    }
    if (selectedDate) {
      setExpiryDateObj(selectedDate);
      setExpiryDate(formatDateToFrench(selectedDate));
    }
  };

  const closeBirthDatePicker = () => {
    setShowBirthDatePicker(false);
  };

  const closeExpiryDatePicker = () => {
    setShowExpiryDatePicker(false);
  };

  // Smart date input formatter with validation
  const formatDateInput = (text: string): string => {
    // Remove all non-digits
    const digits = text.replace(/\D/g, '');

    // Limit to 6 digits
    const limited = digits.substring(0, 6);

    if (limited.length === 0) return '';

    // Extract day, month, year
    let day = limited.substring(0, 2);
    let month = limited.substring(2, 4);
    let year = limited.substring(4, 6);

    // Validate and constrain day (01-31)
    if (day.length === 2) {
      const dayNum = parseInt(day, 10);
      if (dayNum === 0) day = '01';
      if (dayNum > 31) day = '31';
    } else if (day.length === 1) {
      const dayNum = parseInt(day, 10);
      // If first digit is > 3, prepend 0
      if (dayNum > 3) day = '0' + day;
    }

    // Validate and constrain month (01-12)
    if (month.length === 2) {
      const monthNum = parseInt(month, 10);
      if (monthNum === 0) month = '01';
      if (monthNum > 12) month = '12';
    } else if (month.length === 1) {
      const monthNum = parseInt(month, 10);
      // If first digit is > 1, prepend 0
      if (monthNum > 1) month = '0' + month;
    }

    // Format with slashes
    if (limited.length <= 2) {
      return day;
    } else if (limited.length <= 4) {
      return `${day}/${month}`;
    } else {
      return `${day}/${month}/${year}`;
    }
  };

  const handleBirthDateChange = (text: string) => {
    const formatted = formatDateInput(text);
    setBirthDate(formatted);
  };

  const handleExpiryDateChange = (text: string) => {
    const formatted = formatDateInput(text);
    setExpiryDate(formatted);
  };

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    try {
      const result = parseMRZ(lines);

      if (result?.valid) {
        console.log("✅ MRZ Detected:", result.fields);

        // Auto-fill the form with dates in French format (DD/MM/YY)
        setDocumentNo((result.fields.documentNumber || "").trim().toUpperCase());
        setBirthDate(convertMRZDateToFrench(result.fields.birthDate || ""));
        setExpiryDate(convertMRZDateToFrench(result.fields.expirationDate || ""));

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

  // Register identity on testnet
  async function registerIdentityOnTestnet() {
    if (!privateKey || !rarimePassportRef.current) {
      setError("No passport scanned or private key not available");
      return;
    }

    console.log('\n=== REGISTERING IDENTITY ON TESTNET ===');
    setIsRegistering(true);
    setRegistrationTxHash(null);

    try {
      const rarime = new Rarime({
        ...RARIME_TESTNET_CONFIG,
        userConfiguration: {
          userPrivateKey: privateKey,
        },
      });

      console.log('Starting identity registration (this may take ~5 seconds)...');
      const txHash = await rarime.registerIdentity(rarimePassportRef.current);
      console.log(`Registration TX Hash: ${txHash}`);
      setRegistrationTxHash(txHash.toString());
      setDocumentStatus(DocumentStatus.RegisteredWithThisPk);
      console.log('=== REGISTRATION COMPLETE ===\n');
    } catch (regError) {
      console.error('Registration failed:', regError);
      setError('Registration failed: ' + (regError as Error).message);
    } finally {
      setIsRegistering(false);
    }
  }

  // Reset private key (for testing)
  async function resetPrivateKey() {
    console.log('Resetting private key...');
    await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
    const newKey = RarimeUtils.generateBJJPrivateKey();
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, newKey);
    setPrivateKey(newKey);
    setProfileKey(RarimeUtils.getProfileKey(newKey));
    setDocumentStatus(null);
    setRegistrationTxHash(null);
    console.log('New private key generated');
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
      console.log("Birth Date (input):", birthDate);
      console.log("Expiry Date (input):", expiryDate);

      const { scanDocument } = await import('@/modules/e-document');

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));
      challengeRef.current = challenge; // Store for RarimePassport

      // Convert dates from French format (DD/MM/YY) to YYMMDD format for BAC
      const bacBirthDate = convertFrenchDateToMRZ(birthDate);
      const bacExpiryDate = convertFrenchDateToMRZ(expiryDate);

      console.log("BAC Birth Date (YYMMDD):", bacBirthDate);
      console.log("BAC Expiry Date (YYMMDD):", bacExpiryDate);

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

      // === RARIME SDK INTEGRATION ===
      console.log('\n=== RARIME SDK INTEGRATION (TESTNET) ===');
      console.log('Step 1: Converting NFC data to Uint8Array...');

      const dg1 = base64ToUint8Array(result.dg1Bytes);
      const sod = base64ToUint8Array(result.sodBytes);
      const dg15 = result.dg15Bytes ? base64ToUint8Array(result.dg15Bytes) : undefined;
      const aaSignature = result.aaSignature ? base64ToUint8Array(result.aaSignature) : undefined;

      console.log('Step 2: Creating RarimePassport instance...');
      console.log(`  - DG1 length: ${dg1.length} bytes`);
      console.log(`  - SOD length: ${sod.length} bytes`);
      console.log(`  - DG15: ${dg15 ? `${dg15.length} bytes` : 'not present'}`);
      console.log(`  - AA Signature: ${aaSignature ? `${aaSignature.length} bytes` : 'not present'}`);
      console.log(`  - AA Challenge: ${challengeRef.current ? `${challengeRef.current.length} bytes` : 'not present'}`);

      try {
        const rarimePassport = new RarimePassport({
          dataGroup1: dg1,
          sod: sod,
          dataGroup15: dg15,
          aaSignature: aaSignature,
          aaChallenge: challengeRef.current || undefined,
        });

        // Store passport reference for registration
        rarimePassportRef.current = rarimePassport;

        console.log('Step 3: Extracting passport data from RarimePassport...');
        console.log(`  - Passport Key: ${rarimePassport.getPassportKey()}`);
        console.log(`  - Passport Hash: ${rarimePassport.getPassportHash()}`);
        console.log(`  - DG Hash Algorithm: ${rarimePassport.extractDGHashAlgo()}`);
        console.log(`  - Signature Algorithm: ${rarimePassport.getSignatureAlgorithm()}`);

        console.log('Step 4: RarimePassport created successfully!');

        // Step 5: Check document status on testnet
        if (privateKey) {
          console.log('Step 5: Checking document status on TESTNET...');
          setIsCheckingStatus(true);
          setDocumentStatus(null);

          try {
            const rarime = new Rarime({
              ...RARIME_TESTNET_CONFIG,
              userConfiguration: {
                userPrivateKey: privateKey,
              },
            });

            const status = await rarime.getDocumentStatus(rarimePassport);
            console.log(`  - Document Status: ${status}`);
            setDocumentStatus(status);

            if (status === DocumentStatus.NotRegistered) {
              console.log('  → Document is NOT registered on testnet');
            } else if (status === DocumentStatus.RegisteredWithThisPk) {
              console.log('  → Document is registered with YOUR private key');
            } else if (status === DocumentStatus.RegisteredWithOtherPk) {
              console.log('  → Document is registered with ANOTHER private key');
            }

            console.log('Step 6: Document status check complete!');
          } catch (statusError) {
            console.error('Failed to check document status:', statusError);
            setDocumentStatus('ERROR: ' + (statusError as Error).message);
          } finally {
            setIsCheckingStatus(false);
          }
        } else {
          console.log('Step 5: Skipped - No private key available');
        }

        console.log('=== RARIME SDK INTEGRATION COMPLETE ===\n');
      } catch (rarimeError) {
        console.error('Rarime SDK Error:', rarimeError);
        console.log('=== RARIME SDK INTEGRATION FAILED ===\n');
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
    <>
      <Stack.Screen
        options={{
          title: "Test Passeport",
          headerShown: true,
          headerBackTitle: "Retour",
          headerTintColor: Colors.primary,
          headerStyle: {
            backgroundColor: Colors.white,
          },
          headerTitleStyle: {
            fontFamily: Typography.fontFamily.bold,
            fontSize: Typography.fontSize.h3,
            color: Colors.primary,
          },
        }}
      />
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
                  Scannez les 2 lignes MRZ en bas du passeport
                </Text>
              </View>
            </View>
          )}

          {/* Rarime Testnet Status */}
          <View style={styles.rarimeSection}>
            <Text style={styles.sectionTitle}>Rarime Testnet</Text>

            <View style={styles.infoRow}>
              <Text style={styles.rarimeLabel}>Profile Key:</Text>
              <Text style={styles.rarimeValue} numberOfLines={1}>
                {profileKey ? `${profileKey.substring(0, 12)}...` : 'Loading...'}
              </Text>
            </View>

            {documentStatus && (
              <View style={[
                styles.statusBadge,
                documentStatus === DocumentStatus.NotRegistered && styles.statusNotRegistered,
                documentStatus === DocumentStatus.RegisteredWithThisPk && styles.statusRegisteredOwn,
                documentStatus === DocumentStatus.RegisteredWithOtherPk && styles.statusRegisteredOther,
                documentStatus.startsWith('ERROR') && styles.statusError,
              ]}>
                <Text style={styles.statusBadgeText}>
                  {documentStatus === DocumentStatus.NotRegistered && '⚪ Not Registered'}
                  {documentStatus === DocumentStatus.RegisteredWithThisPk && '✅ Registered (Your Key)'}
                  {documentStatus === DocumentStatus.RegisteredWithOtherPk && '⚠️ Registered (Other Key)'}
                  {documentStatus.startsWith('ERROR') && `❌ ${documentStatus}`}
                </Text>
              </View>
            )}

            {isCheckingStatus && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#3B82F6" />
                <Text style={styles.loadingText}>Checking status on testnet...</Text>
              </View>
            )}

            {documentStatus === DocumentStatus.NotRegistered && rarimePassportRef.current && (
              <TouchableOpacity
                style={[styles.registerButton, isRegistering && styles.scanButtonDisabled]}
                onPress={registerIdentityOnTestnet}
                disabled={isRegistering}
                activeOpacity={0.7}
              >
                {isRegistering ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.registerButtonText}>Registering (~5s)...</Text>
                  </View>
                ) : (
                  <Text style={styles.registerButtonText}>Register Identity on Testnet</Text>
                )}
              </TouchableOpacity>
            )}

            {registrationTxHash && (
              <View style={styles.txHashContainer}>
                <Text style={styles.txHashLabel}>TX Hash:</Text>
                <Text style={styles.txHashValue} numberOfLines={1}>{registrationTxHash}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.resetButton}
              onPress={resetPrivateKey}
              activeOpacity={0.7}
            >
              <Text style={styles.resetButtonText}>🔄 Reset Private Key</Text>
            </TouchableOpacity>
          </View>

          {/* MRZ Input Section */}
          <View style={styles.mrzSection}>
            <Text style={styles.sectionTitle}>Données MRZ (en bas du passeport)</Text>

            <TouchableOpacity
              style={styles.cameraButton}
              onPress={openMRZScanner}
              activeOpacity={0.7}
            >
              <Text style={styles.cameraButtonText}>📷 Scanner avec caméra</Text>
            </TouchableOpacity>

            <Text style={styles.orText}>ou saisir manuellement:</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Numéro de passeport</Text>
              <TextInput
                style={styles.input}
                placeholder="12AB34567"
                placeholderTextColor="#9CA3AF"
                value={documentNo}
                onChangeText={(text) => setDocumentNo(text.trim().toUpperCase())}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Date de naissance</Text>
              <View style={styles.dateInputRow}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  placeholder="JJ/MM/AA"
                  placeholderTextColor="#9CA3AF"
                  value={birthDate}
                  onChangeText={handleBirthDateChange}
                  keyboardType="numeric"
                  maxLength={8}
                />
                <TouchableOpacity
                  style={styles.calendarButton}
                  onPress={() => setShowBirthDatePicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.calendarButtonText}>📅</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Date d'expiration</Text>
              <View style={styles.dateInputRow}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  placeholder="JJ/MM/AA"
                  placeholderTextColor="#9CA3AF"
                  value={expiryDate}
                  onChangeText={handleExpiryDateChange}
                  keyboardType="numeric"
                  maxLength={8}
                />
                <TouchableOpacity
                  style={styles.calendarButton}
                  onPress={() => setShowExpiryDatePicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.calendarButtonText}>📅</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Debug Log Button */}
            <TouchableOpacity
              style={styles.debugButton}
              onPress={() => {
                console.log("=== DEBUG: Current Input Values ===");
                console.log("Document Number:", documentNo);
                console.log("Birth Date (Display):", birthDate);
                console.log("Birth Date (YYMMDD):", convertFrenchDateToMRZ(birthDate));
                console.log("Expiry Date (Display):", expiryDate);
                console.log("Expiry Date (YYMMDD):", convertFrenchDateToMRZ(expiryDate));
                console.log("===================================");
                alert(`Debug logged to console:\nDoc: ${documentNo}\nBirth: ${birthDate} → ${convertFrenchDateToMRZ(birthDate)}\nExpiry: ${expiryDate} → ${convertFrenchDateToMRZ(expiryDate)}`);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.debugButtonText}>🐛 Log Debug Info</Text>
            </TouchableOpacity>

            {/* Birth Date Picker Modal */}
            {Platform.OS === 'ios' ? (
              <Modal
                visible={showBirthDatePicker}
                transparent={true}
                animationType="slide"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>Date de naissance</Text>
                      <TouchableOpacity
                        onPress={closeBirthDatePicker}
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
                      textColor={Colors.primary}
                      themeVariant="light"
                    />
                  </View>
                </View>
              </Modal>
            ) : (
              showBirthDatePicker && (
                <DateTimePicker
                  value={birthDateObj}
                  mode="date"
                  display="default"
                  onChange={onBirthDateChange}
                  maximumDate={new Date()}
                />
              )
            )}

            {/* Expiry Date Picker Modal */}
            {Platform.OS === 'ios' ? (
              <Modal
                visible={showExpiryDatePicker}
                transparent={true}
                animationType="slide"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>Date d'expiration</Text>
                      <TouchableOpacity
                        onPress={closeExpiryDatePicker}
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
                      textColor={Colors.primary}
                      themeVariant="light"
                    />
                  </View>
                </View>
              </Modal>
            ) : (
              showExpiryDatePicker && (
                <DateTimePicker
                  value={expiryDateObj}
                  mode="date"
                  display="default"
                  onChange={onExpiryDateChange}
                  minimumDate={new Date()}
                />
              )
            )}
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
                    <Text style={styles.infoLabel}>N° Passeport:</Text>
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
                Appuyez sur le bouton et approchez votre passeport du téléphone.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
    </>
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
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    color: Colors.primary,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: Colors.primary,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  dateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateInput: {
    flex: 1,
  },
  calendarButton: {
    backgroundColor: "#3B82F6",
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    height: 44,
  },
  calendarButtonText: {
    fontSize: 20,
  },
  debugButton: {
    backgroundColor: '#F59E0B',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  debugButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    width: '100%',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Typography.fontFamily.bold,
    color: Colors.primary,
  },
  modalCloseButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#3B82F6',
    borderRadius: 8,
  },
  modalCloseText: {
    fontSize: 16,
    fontFamily: Typography.fontFamily.bold,
    color: '#FFFFFF',
  },
  datePicker: {
    width: '100%',
    height: 200,
    alignSelf: 'center',
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
  // Rarime Testnet styles
  rarimeSection: {
    backgroundColor: '#EEF2FF',
    padding: Spacing.screen.horizontal,
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  rarimeLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    color: '#4338CA',
    flex: 1,
  },
  rarimeValue: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: '#6366F1',
    flex: 2,
    textAlign: 'right',
  },
  statusBadge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statusNotRegistered: {
    backgroundColor: '#F3F4F6',
  },
  statusRegisteredOwn: {
    backgroundColor: '#D1FAE5',
  },
  statusRegisteredOther: {
    backgroundColor: '#FEF3C7',
  },
  statusError: {
    backgroundColor: '#FEE2E2',
  },
  statusBadgeText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    color: '#1F2937',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: '#3B82F6',
  },
  registerButton: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  registerButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
  txHashContainer: {
    backgroundColor: '#D1FAE5',
    padding: 12,
    borderRadius: 8,
  },
  txHashLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    color: '#065F46',
  },
  txHashValue: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: '#047857',
  },
  resetButton: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  resetButtonText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: '#6B7280',
  },
});
