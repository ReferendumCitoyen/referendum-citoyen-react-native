import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getRandomValues } from 'expo-crypto';
import { Buffer } from 'buffer';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
} from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { Worklets } from 'react-native-worklets-core';
import { parse } from 'mrz';
import { SOD, DG14, DG15 } from '@li0ard/tsemrtd';
import { useDevMode } from '@/contexts/DevModeContext';
import { Spacing, Typography, useColors } from '@/constants/theme';

// Mirrors the existing example-passport.json shape (see the reference file
// at the repo root). Loaded forgivingly by `utils/dev-example-passport.ts`
// AND by inid-app's referendum-debug `extractHex` (both top-level and
// `dgHex.*`). Hex strings here are raw (no "0x" prefix) to match the
// reference; consumers tolerate both forms but matching exactly keeps a
// round-trip through the dev-fixture paste flow byte-identical.
type DgKey = 'dg1' | 'dg11' | 'dg12' | 'dg14' | 'dg15' | 'sod' | 'aaSignature';
const DG_KEYS: DgKey[] = ['dg1', 'dg11', 'dg12', 'dg14', 'dg15', 'sod', 'aaSignature'];

interface CapturedMrz {
  docType: string;
  issuingCountry: string;
  lastName: string;
  firstName: string;
  docNumber: string;
  nationality: string;
  dob: string;
  gender: string;
  expiry: string;
}

interface DerivedInfo {
  sodDgHashList: number[] | null;
  sodDscSigAlgo: string | null;
  sodHashAlgo: string | null;
  dg14Protocols: string | null;
  dg15AaAlgo: string | null;
  dg15AaKeyBits: number | null;
}

interface ExportedPassport {
  scannedAt: string;
  platform: 'ios' | 'android';
  strategy: { id: string; label: string };
  docCode: string;
  personDetails: Record<string, string | null>;
  mrz: CapturedMrz | null;
  personalNumber: string | null;
  dgSizes: Record<DgKey, number>;
  dgHex: Record<DgKey, string | null>;
  derived: DerivedInfo;
}

// OID → human-readable name maps. Mirrors the friendly labels in the
// reference example-passport.json (e.g. "RSA-SHA256", "SHA-256").
const HASH_OID_TO_NAME: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.4': 'SHA-224',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};
const SIG_OID_TO_NAME: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.5': 'RSA-SHA1',
  '1.2.840.113549.1.1.11': 'RSA-SHA256',
  '1.2.840.113549.1.1.12': 'RSA-SHA384',
  '1.2.840.113549.1.1.13': 'RSA-SHA512',
  '1.2.840.113549.1.1.14': 'RSA-SHA224',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.10045.4.1': 'ECDSA-SHA1',
  '1.2.840.10045.4.3.1': 'ECDSA-SHA224',
  '1.2.840.10045.4.3.2': 'ECDSA-SHA256',
  '1.2.840.10045.4.3.3': 'ECDSA-SHA384',
  '1.2.840.10045.4.3.4': 'ECDSA-SHA512',
};
const PUBKEY_OID_TO_NAME: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.10045.2.1': 'ECDSA',
};

// DG14 protocol OID prefixes (BSI TR-03110). Returned as a comma-separated
// string of distinct protocol families, e.g. "PACE" or "PACE,ChipAuth".
const DG14_PROTOCOL_PREFIXES: { prefix: string; name: string }[] = [
  { prefix: '0.4.0.127.0.7.2.2.4', name: 'PACE' },
  { prefix: '0.4.0.127.0.7.2.2.3', name: 'ChipAuth' },
  { prefix: '0.4.0.127.0.7.2.2.2', name: 'TerminalAuth' },
];

function deriveInfo(scanResult: any): DerivedInfo {
  const out: DerivedInfo = {
    sodDgHashList: null,
    sodDscSigAlgo: null,
    sodHashAlgo: null,
    dg14Protocols: null,
    dg15AaAlgo: null,
    dg15AaKeyBits: null,
  };

  try {
    if (scanResult.sodBytes?.length) {
      const sod = SOD.load(scanResult.sodBytes);
      out.sodHashAlgo = HASH_OID_TO_NAME[sod.ldsObject.algorithm.algorithm] ?? sod.ldsObject.algorithm.algorithm;
      out.sodDgHashList = (sod.ldsObject.hashes ?? []).map((h: any) => h.number).sort((a, b) => a - b);
      const sigOid: string | undefined = sod.signatures?.[0]?.signatureAlgorithm?.algorithm;
      if (sigOid) out.sodDscSigAlgo = SIG_OID_TO_NAME[sigOid] ?? sigOid;
    }
  } catch (e) {
    console.warn('[export-passport] SOD parse failed:', e);
  }

  try {
    if (scanResult.dg14Bytes?.length) {
      const infos = DG14.load(scanResult.dg14Bytes) as any[];
      const families = new Set<string>();
      for (const info of infos ?? []) {
        const oid: string | undefined = info?.protocol ?? info?.algorithm?.algorithm;
        if (!oid) continue;
        for (const { prefix, name } of DG14_PROTOCOL_PREFIXES) {
          if (oid === prefix || oid.startsWith(prefix + '.')) families.add(name);
        }
      }
      if (families.size) out.dg14Protocols = Array.from(families).join(',');
    }
  } catch (e) {
    console.warn('[export-passport] DG14 parse failed:', e);
  }

  try {
    if (scanResult.dg15Bytes?.length) {
      const spki: any = DG15.load(scanResult.dg15Bytes);
      const algoOid: string | undefined = spki?.algorithm?.algorithm;
      if (algoOid) out.dg15AaAlgo = PUBKEY_OID_TO_NAME[algoOid] ?? algoOid;
      // BitString bit length — for RSA this is ~modulus+overhead, good enough
      // as a "key bits" approximation matching what the reference file logs.
      const bitLen: number | undefined =
        spki?.subjectPublicKey?.byteLength != null
          ? spki.subjectPublicKey.byteLength * 8
          : undefined;
      if (bitLen) out.dg15AaKeyBits = bitLen;
    }
  } catch (e) {
    console.warn('[export-passport] DG15 parse failed:', e);
  }

  return out;
}

const bytesToHexRaw = (b: ArrayLike<number> | null | undefined): string | null => {
  if (!b || (b as any).length === 0) return null;
  return Buffer.from(b as any).toString('hex');
};

const bytesLen = (b: ArrayLike<number> | null | undefined): number =>
  (b as any)?.length ?? 0;

function buildExportedPassport(
  scanResult: any,
  capturedMrz: CapturedMrz | null,
  bacInputs: { documentNumber: string; birthDate: string; expiryDate: string },
): ExportedPassport {
  const dgSizes = {} as Record<DgKey, number>;
  const dgHex = {} as Record<DgKey, string | null>;
  for (const key of DG_KEYS) {
    const src = key === 'sod'
      ? scanResult.sodBytes
      : key === 'dg1'
      ? scanResult.dg1Bytes
      : key === 'aaSignature'
      ? scanResult.aaSignature
      : scanResult[`${key}Bytes`];
    dgSizes[key] = bytesLen(src);
    dgHex[key] = bytesToHexRaw(src);
  }

  // Derive the `mrz` block from the camera capture when available; fall
  // back to BAC inputs + personDetails so the field is always present (the
  // reference file always has it).
  const pd = scanResult.personDetails ?? {};
  const mrz: CapturedMrz = capturedMrz ?? {
    docType: 'Passport',
    issuingCountry: pd.issuingAuthority ?? pd.nationality ?? '',
    lastName: pd.lastName ?? '',
    firstName: pd.firstName ?? '',
    docNumber: pd.documentNumber ?? bacInputs.documentNumber,
    nationality: pd.nationality ?? '',
    dob: pd.birthDate ?? bacInputs.birthDate,
    gender: pd.gender ?? '',
    expiry: pd.expiryDate ?? bacInputs.expiryDate,
  };

  return {
    scannedAt: new Date().toISOString(),
    platform: Platform.OS as 'ios' | 'android',
    strategy: { id: 'mrz_bac', label: 'Scanner le passeport' },
    docCode: scanResult.docCode ?? 'P',
    personDetails: pd,
    mrz,
    personalNumber: null,
    dgSizes,
    dgHex,
    derived: deriveInfo(scanResult),
  };
}

// Cheap pre-filter that decides whether a line "looks like" MRZ before
// running the full TD3 parser. Same heuristic Step5 / passport-test use.
const isMRZLike = (line: string): boolean => {
  const cleaned = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
  const hasMRZPattern = cleaned.includes('<<') || cleaned.startsWith('P<');
  const validChars = cleaned.replace(/[A-Z0-9<]/g, '').length < 5;
  const goodLength = cleaned.length >= 30;
  return hasMRZPattern && validChars && goodLength;
};

export default function ExportPassportScreen() {
  const router = useRouter();
  const { devMode } = useDevMode();
  const colors = useColors();
  const styles = createStyles(colors);

  useEffect(() => {
    if (!devMode) router.replace('/');
  }, [devMode, router]);

  const [documentNumber, setDocumentNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportedPassport | null>(null);

  // MRZ camera state
  const [showCamera, setShowCamera] = useState(false);
  const [scanProgress, setScanProgress] = useState<'idle' | 'scanning' | 'partial' | 'success'>('idle');
  const [detectedLines, setDetectedLines] = useState(0);
  const [lastMRZKey, setLastMRZKey] = useState<string | null>(null);
  const [capturedMrz, setCapturedMrz] = useState<CapturedMrz | null>(null);
  const consecutiveMatchRef = useRef(0);

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const { scanText } = useTextRecognition({ language: 'latin' });

  const parseMRZ = useCallback((lines: string[]): { valid: boolean; linesFound: number; fields?: any } | null => {
    const mrzLikeLines = lines.filter(isMRZLike);
    const linesFound = Math.min(mrzLikeLines.length, 2);
    if (lines.length < 2) return { valid: false, linesFound };

    try {
      const td3Lines = lines.slice(-2);
      const sanitized = td3Lines.map((line) => {
        const cleaned = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
        if (cleaned.length > 44) return cleaned.substring(0, 44);
        return cleaned.padEnd(44, '<');
      });
      const result = parse(sanitized, { autocorrect: true });
      if (result?.valid && result.format === 'TD3') {
        return { valid: true, linesFound: 2, fields: result.fields };
      }
      // Android: OCR often misses the last digit (composite check). Accept
      // when that's the only failure — same as passport-test.tsx.
      if (Platform.OS === 'android' && result?.format === 'TD3' && result?.fields) {
        const details = (result as any).details || [];
        const invalidFields = details.filter((d: any) => !d.valid);
        if (invalidFields.length === 1 && invalidFields[0].field === 'compositeCheckDigit') {
          return { valid: true, linesFound: 2, fields: result.fields };
        }
      }
    } catch {
      // swallow — wait for the next frame
    }
    return { valid: false, linesFound };
  }, []);

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    const result = parseMRZ(lines);
    if (result?.valid && result.fields) {
      const mrzKey = `${result.fields.documentNumber}-${result.fields.birthDate}-${result.fields.expirationDate}`;
      if (Platform.OS === 'android') {
        if (mrzKey === lastMRZKey) consecutiveMatchRef.current += 1;
        else {
          consecutiveMatchRef.current = 1;
          setLastMRZKey(mrzKey);
        }
        if (consecutiveMatchRef.current < 2) {
          setScanProgress('partial');
          setDetectedLines(2);
          return;
        }
      }
      setScanProgress('success');
      setDocumentNumber((result.fields.documentNumber || '').trim().toUpperCase());
      setBirthDate(result.fields.birthDate || '');
      setExpiryDate(result.fields.expirationDate || '');
      // Capture the raw MRZ parse so the exported JSON's `mrz` block carries
      // the OCR-extracted values exactly (matching example-passport.json).
      const f = result.fields;
      setCapturedMrz({
        docType: f.documentCode === 'P' ? 'Passport' : (f.documentCode ?? 'Passport'),
        issuingCountry: f.issuingState ?? '',
        lastName: (f.lastName ?? '').trim(),
        firstName: (f.firstName ?? '').trim(),
        docNumber: (f.documentNumber ?? '').trim(),
        nationality: f.nationality ?? '',
        dob: f.birthDate ?? '',
        gender: f.sex ?? '',
        expiry: f.expirationDate ?? '',
      });
      consecutiveMatchRef.current = 0;
      setLastMRZKey(null);
      setTimeout(() => {
        setShowCamera(false);
        setError(null);
      }, 500);
    } else if (result && result.linesFound > 0) {
      setScanProgress('partial');
      setDetectedLines(result.linesFound);
    } else {
      setScanProgress('scanning');
    }
  });

  // Lower FPS on Android — OCR is noisier; iOS handles 2 fps fine.
  const scanFps = Platform.OS === 'android' ? 1 : 2;
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAtTargetFps(scanFps, () => {
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
            if (resultText) onMRZDetected(resultText.split('\n'));
          }
        } catch {
          // worklet errors crash the whole camera — swallow.
        }
      });
    },
    [scanText, onMRZDetected],
  );

  const openMRZScanner = async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        setError('Permission caméra refusée');
        return;
      }
    }
    setScanProgress('scanning');
    setDetectedLines(0);
    setShowCamera(true);
    setError(null);
  };

  const handleScan = async () => {
    setError(null);
    setExported(null);
    if (!documentNumber || !birthDate || !expiryDate) {
      setError('Renseigne les 3 champs MRZ (n° passeport, YYMMDD naissance, YYMMDD expiration), ou scanne la MRZ.');
      return;
    }
    if (birthDate.length !== 6 || expiryDate.length !== 6) {
      setError('Les dates doivent faire 6 chiffres au format YYMMDD.');
      return;
    }
    setIsScanning(true);
    try {
      const { scanDocument } = await import('@/modules/e-document');
      const challenge = getRandomValues(new Uint8Array(32));
      const result: any = await scanDocument(
        'P',
        {
          documentNumber: documentNumber.toUpperCase(),
          dateOfBirth: birthDate,
          dateOfExpiry: expiryDate,
        },
        challenge,
      );
      const built = buildExportedPassport(result, capturedMrz, {
        documentNumber,
        birthDate,
        expiryDate,
      });
      setExported(built);
      console.log('[export-passport] scan OK — dgSizes:', built.dgSizes);
    } catch (e: any) {
      console.error('[export-passport] scan failed:', e);
      setError(e?.message ?? 'Échec du scan NFC');
    } finally {
      setIsScanning(false);
    }
  };

  const handleCopy = async () => {
    if (!exported) return;
    await Clipboard.setStringAsync(JSON.stringify(exported, null, 2));
    Alert.alert('Copié', 'JSON passeport copié dans le presse-papiers.');
  };

  const handleShare = async () => {
    if (!exported) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Indisponible', 'Le partage natif n’est pas disponible sur cet appareil.');
        return;
      }
      const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!dir) {
        Alert.alert('Erreur', 'Répertoire d’écriture introuvable.');
        return;
      }
      const stamp = exported.scannedAt.replace(/[:.]/g, '-');
      const path = `${dir}example-passport-${stamp}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(exported, null, 2));
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: 'Partager le passeport (JSON)',
        UTI: 'public.json',
      });
    } catch (e: any) {
      console.error('[export-passport] share failed:', e);
      Alert.alert('Erreur', e?.message ?? 'Échec du partage.');
    }
  };

  if (!devMode) return null;

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.helper}>
          Scanne la MRZ avec la caméra, puis approche ton passeport pour la
          lecture NFC. Tu pourras ensuite copier ou partager le JSON au format
          example-passport — utilisable par l’écran Fixture passeport (dev) et
          par le debug d’inid-app. Réservé au débogage : le JSON contient les
          données complètes du passeport.
        </Text>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={openMRZScanner}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>📷 Scanner la MRZ (caméra)</Text>
        </TouchableOpacity>

        <View style={styles.field}>
          <Text style={styles.label}>N° passeport (BAC)</Text>
          <TextInput
            style={styles.input}
            value={documentNumber}
            onChangeText={setDocumentNumber}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ex: 17EE3177"
            placeholderTextColor={colors.text + '66'}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Naissance (YYMMDD)</Text>
          <TextInput
            style={styles.input}
            value={birthDate}
            onChangeText={setBirthDate}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="ex: 441231"
            placeholderTextColor={colors.text + '66'}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Expiration (YYMMDD)</Text>
          <TextInput
            style={styles.input}
            value={expiryDate}
            onChangeText={setExpiryDate}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="ex: 271002"
            placeholderTextColor={colors.text + '66'}
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, isScanning && styles.btnDisabled]}
          onPress={handleScan}
          disabled={isScanning}
          activeOpacity={0.8}
        >
          {isScanning ? (
            <ActivityIndicator color={colors.buttonText} />
          ) : (
            <Text style={styles.primaryBtnText}>📡 Scanner le passeport (NFC)</Text>
          )}
        </TouchableOpacity>

        {error && (
          <View style={[styles.statusBox, styles.statusErr]}>
            <Text style={[styles.statusText, { color: colors.errorText }]}>{error}</Text>
          </View>
        )}

        {exported && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>✅ Scan terminé</Text>
            <Text style={styles.kv}>
              Tailles :{' '}
              <Text style={styles.kvVal}>
                {Object.entries(exported.dgSizes).map(([k, v]) => `${k}=${v}o`).join(' · ')}
              </Text>
            </Text>
            {exported.personDetails?.documentNumber ? (
              <Text style={styles.kv}>
                N° : <Text style={styles.kvVal}>{String(exported.personDetails.documentNumber)}</Text>
              </Text>
            ) : null}
            <Text style={styles.kv}>
              Signature : <Text style={styles.kvVal}>{exported.derived.sodDscSigAlgo ?? '—'}</Text>
            </Text>
            <Text style={styles.kv}>
              Hash : <Text style={styles.kvVal}>{exported.derived.sodHashAlgo ?? '—'}</Text>
            </Text>
            <Text style={styles.kv}>
              DGs signés :{' '}
              <Text style={styles.kvVal}>
                {exported.derived.sodDgHashList ? exported.derived.sodDgHashList.join(',') : '—'}
              </Text>
            </Text>
            {exported.derived.dg14Protocols ? (
              <Text style={styles.kv}>
                DG14 : <Text style={styles.kvVal}>{exported.derived.dg14Protocols}</Text>
              </Text>
            ) : null}
            {exported.derived.dg15AaAlgo ? (
              <Text style={styles.kv}>
                AA : <Text style={styles.kvVal}>{exported.derived.dg15AaAlgo}
                {exported.derived.dg15AaKeyBits ? ` (${exported.derived.dg15AaKeyBits} bits)` : ''}</Text>
              </Text>
            ) : null}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleCopy} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>📋 Copier le JSON</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleShare} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>📤 Partager (email, WhatsApp…)</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal visible={showCamera} animationType="slide" onRequestClose={() => setShowCamera(false)}>
        <View style={styles.cameraContainer}>
          {device ? (
            <Camera
              style={styles.cameraView}
              device={device}
              isActive={showCamera}
              frameProcessor={frameProcessor}
            />
          ) : (
            <View style={styles.cameraFallback}>
              <Text style={styles.cameraFallbackText}>Caméra arrière indisponible.</Text>
            </View>
          )}
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraStatus}>
              {scanProgress === 'success'
                ? '✅ MRZ détectée — fermeture…'
                : scanProgress === 'partial'
                ? `📖 Lecture en cours… (${detectedLines}/2 lignes)`
                : '👁  Cadrer les 2 lignes MRZ du passeport'}
            </Text>
            <TouchableOpacity
              style={styles.cameraCancelBtn}
              onPress={() => setShowCamera(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.cameraCancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.screen.horizontal, gap: 16, paddingBottom: 40 },
    helper: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.body,
      lineHeight: Typography.lineHeight.body,
      color: colors.text,
      opacity: 0.7,
    },
    field: { gap: 6 },
    label: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.text + '33',
      borderRadius: 8,
      padding: 12,
      fontFamily: Typography.fontFamily.mono,
      fontSize: Typography.fontSize.body,
      color: colors.text,
      backgroundColor: colors.cardBackground,
    },
    primaryBtn: {
      backgroundColor: colors.secondary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    btnDisabled: { opacity: 0.6 },
    primaryBtnText: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.button,
      color: colors.buttonText,
    },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      gap: 8,
    },
    cardTitle: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.body,
      color: colors.text,
      marginBottom: 4,
    },
    kv: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.body,
      color: colors.text,
      opacity: 0.8,
    },
    kvVal: {
      fontFamily: Typography.fontFamily.mono,
      color: colors.text,
      opacity: 1,
    },
    statusBox: { borderRadius: 8, padding: 12, borderWidth: 1 },
    statusErr: {
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorText,
    },
    statusText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.body,
      lineHeight: Typography.lineHeight.body,
    },
    cameraContainer: { flex: 1, backgroundColor: '#000' },
    cameraView: { flex: 1 },
    cameraFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    cameraFallbackText: { color: '#fff', fontSize: 16 },
    cameraOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 24,
      backgroundColor: 'rgba(0,0,0,0.5)',
      gap: 12,
    },
    cameraStatus: {
      color: '#fff',
      fontSize: 16,
      textAlign: 'center',
      fontFamily: Typography.fontFamily.medium,
    },
    cameraCancelBtn: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    cameraCancelText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: Typography.fontFamily.semibold,
    },
  });
