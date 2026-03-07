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
  ActivityIndicator,
} from "react-native";
import NfcManager, { NfcTech } from "react-native-nfc-manager";
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-text-recognition";
import { Worklets } from "react-native-worklets-core";
import { parse } from "mrz";
import { getRandomValues } from "expo-crypto";
import { Rarime, RarimePassport, RarimeUtils, DocumentStatus } from "@rarimo/rarime-rn-sdk";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import { useTranslation } from "react-i18next";

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

export default function NFCTestScreen() {
  const { t } = useTranslation();
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
            setScanStatus(t("nfcTest.status.presentPassport"));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus(t("nfcTest.status.authenticatingPassport"));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus(t("nfcTest.status.readingPassportData"));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus(t("voting.step6ActiveAuth"));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus(t("voting.step6ReadSuccess"));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus(t("voting.step6ReadError"));
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

  // MRZ Parser for new French ID cards (TD1: 3 lines, 30 chars)
  const parseMRZ = React.useCallback((lines: string[]) => {
    if (lines.length < 3) return null;

    try {
      // Take last 3 lines
      const td1Lines = lines.slice(-3);

      // Normalize each line to exactly 30 chars
      const sanitized = td1Lines.map(line => {
        const cleaned = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
        if (cleaned.length > 30) return cleaned.substring(0, 30);
        return cleaned.padEnd(30, '<');
      });

      console.log("Trying TD1 parse:", sanitized);

      const result = parse(sanitized, { autocorrect: true });
      if (result?.valid && result.format === 'TD1') {
        console.log("✅ TD1 ID Card detected:", result.fields);
        return result;
      }
    } catch (err) {
      console.log("TD1 parse error:", err);
    }

    return null;
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
        setError(t("nfcTest.errors.cameraPermissionDenied"));
        return;
      }
    }
    setShowCamera(true);
    setError(null);
  }

  // Register identity on testnet
  async function registerIdentityOnTestnet() {
    if (!privateKey || !rarimePassportRef.current) {
      setError(t("nfcTest.errors.missingPassportOrKey"));
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
      setError(t('nfcTest.errors.registrationFailed', { message: (regError as Error).message }));
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
      setError(ex?.message || t("nfcTest.errors.unknown"));
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
      setError(ex?.message || t("nfcTest.errors.unknown"));
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
        setError(t("nfcTest.errors.fillAllMrzFields"));
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
      challengeRef.current = challenge; // Store for RarimePassport

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

      setScanStatus(t("nfcTest.status.scanCompleted"));
      setTagData(result);
      setError(null);
    } catch (ex: any) {
      console.warn("EDocument error:", ex);
      setError(ex?.message || t("nfcTest.errors.unknown"));
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
                <Text style={styles.closeCameraText}>{t('nfcTest.closeCamera')}</Text>
              </TouchableOpacity>
              <View style={styles.cameraOverlay}>
                <Text style={styles.cameraInstructions}>
                  {t('nfcTest.scanMrzInstructions')}
                </Text>
              </View>
            </View>
          )}

          {/* Rarime Testnet Status */}
          <View style={styles.rarimeSection}>
            <Text style={styles.sectionTitle}>{t('nfcTest.rarimeTestnet')}</Text>

            <View style={styles.infoRow}>
              <Text style={styles.rarimeLabel}>{t('nfcTest.profileKey')}</Text>
              <Text style={styles.rarimeValue} numberOfLines={1}>
                {profileKey ? `${profileKey.substring(0, 12)}...` : t('nfcTest.loading')}
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
                  {documentStatus === DocumentStatus.NotRegistered && t('nfcTest.notRegistered')}
                  {documentStatus === DocumentStatus.RegisteredWithThisPk && t('nfcTest.registeredOwnKey')}
                  {documentStatus === DocumentStatus.RegisteredWithOtherPk && t('nfcTest.registeredOtherKey')}
                  {documentStatus.startsWith('ERROR') && `❌ ${documentStatus}`}
                </Text>
              </View>
            )}

            {isCheckingStatus && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#3B82F6" />
                <Text style={styles.loadingText}>{t('nfcTest.checkingStatus')}</Text>
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
                    <Text style={styles.registerButtonText}>{t('nfcTest.registering')}</Text>
                  </View>
                ) : (
                  <Text style={styles.registerButtonText}>{t('nfcTest.registerIdentity')}</Text>
                )}
              </TouchableOpacity>
            )}

            {registrationTxHash && (
              <View style={styles.txHashContainer}>
                <Text style={styles.txHashLabel}>{t('nfcTest.txHash')}</Text>
                <Text style={styles.txHashValue} numberOfLines={1}>{registrationTxHash}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.resetButton}
              onPress={resetPrivateKey}
              activeOpacity={0.7}
            >
              <Text style={styles.resetButtonText}>{t('nfcTest.resetPrivateKey')}</Text>
            </TouchableOpacity>
          </View>

          {/* MRZ Input Section */}
          <View style={styles.mrzSection}>
            <Text style={styles.sectionTitle}>{t('nfcTest.mrzData')}</Text>

            <TouchableOpacity
              style={styles.cameraButton}
              onPress={openMRZScanner}
              activeOpacity={0.7}
            >
              <Text style={styles.cameraButtonText}>{t('nfcTest.scanWithCamera')}</Text>
            </TouchableOpacity>

            <Text style={styles.orText}>{t('nfcTest.orManualInput')}</Text>

            <TextInput
              style={styles.input}
              placeholder={t('nfcTest.documentNumberPlaceholder')}
              value={documentNo}
              onChangeText={setDocumentNo}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder={t('nfcTest.birthDatePlaceholder')}
              value={birthDate}
              onChangeText={setBirthDate}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TextInput
              style={styles.input}
              placeholder={t('nfcTest.expiryDatePlaceholder')}
              value={expiryDate}
              onChangeText={setExpiryDate}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>

          {/* Passport Reading Buttons */}
          <Text style={styles.sectionTitle}>{t('nfcTest.fullPassportRead')}</Text>

          <TouchableOpacity
            style={[styles.scanButton, styles.scanButtonSecondary, isScanning && styles.scanButtonDisabled]}
            onPress={readPassportWithEDocument}
            disabled={isScanning}
            activeOpacity={0.7}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? t('nfcTest.scanInProgress') : t('nfcTest.edocumentModule')}
            </Text>
          </TouchableOpacity>

          {/* Basic NFC Test Buttons */}
          <Text style={styles.sectionTitle}>{t('nfcTest.basicNfcTests')}</Text>

          <TouchableOpacity
            style={[styles.scanButton, styles.scanButtonTest, isScanning && styles.scanButtonDisabled]}
            onPress={readNdef}
            disabled={isScanning}
            activeOpacity={0.7}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? t('nfcTest.scanInProgress') : t('nfcTest.scanNdefTag')}
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
              {isScanning ? t('nfcTest.scanInProgress') : t('nfcTest.scanIsoDepPassport')}
            </Text>
          </TouchableOpacity>

          {scanStatus && isScanning && (
            <View style={styles.statusContainer}>
              <Text style={styles.statusText}>{scanStatus}</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>{t('nfcTest.errorLabel')}</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {tagData && (
            <View style={styles.resultContainer}>
              <Text style={styles.resultTitle}>{t('nfcTest.passportScannedSuccess')}</Text>

              {tagData.personDetails ? (
                <>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t('nfcTest.lastName')}</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.lastName || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t('nfcTest.firstName')}</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.firstName || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t('nfcTest.birthDate')}</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.dateOfBirth || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t('nfcTest.nationality')}</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.nationality || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t('nfcTest.documentNumber')}</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.documentNumber || 'N/A'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t('nfcTest.expiryDate')}</Text>
                    <Text style={styles.infoValue}>{tagData.personDetails?.dateOfExpiry || 'N/A'}</Text>
                  </View>
                </>
              ) : (
                <Text style={styles.infoValue}>{t('nfcTest.passportDataInLogs')}</Text>
              )}

              <TouchableOpacity
                style={styles.viewRawButton}
                onPress={() => console.log("Full data:", JSON.stringify(tagData, null, 2))}
              >
                <Text style={styles.viewRawButtonText}>{t('nfcTest.viewRawData')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {!error && !tagData && !isScanning && (
            <View style={styles.instructionContainer}>
              <Text style={styles.instructionText}>
                {t('nfcTest.instruction')}
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
