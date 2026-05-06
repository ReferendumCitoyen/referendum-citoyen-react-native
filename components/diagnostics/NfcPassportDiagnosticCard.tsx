import React from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors, Typography } from '@/constants/theme';
import { scanDocument, testPassportDetection } from '@/modules/e-document';

type StrategyResult = { success: true; name: string } | { success: false; error: string } | null;

function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('step2im') || m.includes('pace-im') || m.includes('im not yet'))
    return 'Format PACE-IM non supporté';
  if (m.includes('more than one') || m.includes('plusieurs tag'))
    return 'Plusieurs cartes détectées';
  if (m.includes('tagnotvalid') || m.includes('tag not valid'))
    return 'Document non reconnu par le lecteur';
  if (m.includes('connectionerror') || m.includes('connection error'))
    return 'Connexion NFC perdue — réessayez';
  if (m.includes('timeout') || m.includes('aucun tag') || m.includes('no tag'))
    return 'Délai dépassé — rapprochez le document';
  if (m.includes('invalid mrz') || m.includes('données mrz'))
    return 'Données MRZ incorrectes';
  if (m.includes('6982') || m.includes('security status'))
    return 'Authentification refusée';
  if (m.includes('6985') || m.includes('conditions of use'))
    return "Conditions d'accès non remplies";
  if (m.includes('authentification') || m.includes('authentication'))
    return 'Authentification échouée';
  if (m.includes('pace') || m.includes('cardaccess'))
    return 'PACE non abouti';
  if (m.includes('nfc'))
    return 'Erreur NFC — réessayez';
  const first = raw.split('\n')[0]
    .replace(/^[❌✓⚠️]\s*/, '')
    .replace(/^\w+Error:\s*/i, '')
    .trim();
  return first.length > 48 ? first.slice(0, 45) + '…' : first || 'Échec inattendu';
}

const fmtDate = (digits: string): string => {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const toMRZ = (digits: string): string =>
  digits.length === 6
    ? `${digits.slice(4, 6)}${digits.slice(2, 4)}${digits.slice(0, 2)}`
    : '000000';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Délai dépassé (${label}) — réapprochez le document et réessayez`)),
        ms
      )
    ),
  ]);
}

type Strategy = {
  id: string;
  label: string;
  desc: string;
  type: 'I' | 'P';
  needs: ('can' | 'mrz')[];
  primary?: boolean;
  buildParams: (can: string, docNumber: string, dob: string, expiry: string) => object;
};

// Passports don't use CAN — all strategies are MRZ-only or credential-free.
// NOTE: scan buttons currently require a new build to detect Type B passports.
// The NFCPassportReader library adds .pace to the NFC session regardless of
// skipPACE, which blocks Type B passport detection. Fix: make .pace conditional
// on !skipPACE in the eklchan fork. Until then, only the detection button works.

const PRODUCTION_STRATEGY: Strategy = {
  id: 'mrz_bac',
  label: 'BAC + MRZ (flux production)',
  desc: 'skipPACE=true + MRZ — identique à nfc-scan-modal et passport-test',
  type: 'P',
  needs: ['mrz'],
  primary: true,
  buildParams: (_can, docNumber, dob, expiry) => ({
    documentNumber: docNumber,
    dateOfBirth: dob,
    dateOfExpiry: expiry,
  }),
};

// type I — PACE activé (no CAN — standard passports don't use CAN-PACE)
const PACE_STRATEGIES: Strategy[] = [
  {
    id: 'mrz_pace',
    label: 'PACE + MRZ',
    desc: 'PACE activé + MRZ — si le passeport supporte PACE',
    type: 'I',
    needs: ['mrz'],
    buildParams: (_can, docNumber, dob, expiry) => ({
      documentNumber: docNumber,
      dateOfBirth: dob,
      dateOfExpiry: expiry,
    }),
  },
  {
    id: 'pace_dummy',
    label: 'PACE sans credential',
    desc: "PACE avec données vides — le passeport accepte-t-il n'importe quoi?",
    type: 'I',
    needs: [],
    buildParams: () => ({}),
  },
];

// type P — skipPACE=true (mode BAC, no CAN)
const BAC_STRATEGIES: Strategy[] = [
  {
    id: 'open',
    label: 'BAC sans credential',
    desc: 'skipPACE + aucune donnée — passeport entièrement ouvert?',
    type: 'P',
    needs: [],
    buildParams: () => ({}),
  },
];

export function NfcPassportDiagnosticCard() {
  const colors = useColors();
  const styles = createStyles(colors);

  // Detection state
  const [isDetecting, setIsDetecting] = React.useState(false);
  const [detection, setDetection] = React.useState<any>(null);
  const [detectionError, setDetectionError] = React.useState<string | null>(null);

  // Inputs — no CAN (passports don't use it)
  const [docNumber, setDocNumber] = React.useState('');
  const [dob, setDob] = React.useState('');
  const [expiry, setExpiry] = React.useState('');

  // Scan results
  const [running, setRunning] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, StrategyResult>>({});

  if (Platform.OS !== 'ios') return null;

  const hasMrz = docNumber.length >= 3 && dob.length === 6 && expiry.length === 6;

  const isEnabled = (needs: ('can' | 'mrz')[]) =>
    running === null && needs.every(n => n === 'mrz' ? hasMrz : false);

  const runDetection = async () => {
    setIsDetecting(true);
    setDetection(null);
    setDetectionError(null);
    try {
      const r = await withTimeout(testPassportDetection(30), 35_000, 'détection passeport');
      setDetection(r);
    } catch (ex: any) {
      setDetectionError(ex?.message || 'Erreur inconnue');
    } finally {
      setIsDetecting(false);
    }
  };

  const runStrategy = async (s: Strategy) => {
    setRunning(s.id);
    setResults(r => ({ ...r, [s.id]: null }));
    try {
      const params = s.buildParams('', docNumber, toMRZ(dob), toMRZ(expiry));
      const data = await withTimeout(
        scanDocument(s.type, params, new Uint8Array(32)),
        45_000,
        s.label
      );
      const p = data.personDetails;
      const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || '(nom vide)';
      setResults(r => ({ ...r, [s.id]: { success: true, name } }));
    } catch (ex: any) {
      setResults(r => ({ ...r, [s.id]: { success: false, error: ex?.message || 'Erreur inconnue' } }));
    } finally {
      setRunning(null);
    }
  };

  const renderStrategy = (s: Strategy) => {
    const enabled = isEnabled(s.needs);
    const res = results[s.id];
    return (
      <View key={s.id} style={styles.strategyRow}>
        <TouchableOpacity
          style={[
            s.primary ? styles.primaryButton : styles.strategyButton,
            !enabled && styles.disabled,
          ]}
          onPress={() => runStrategy(s)}
          disabled={!enabled}
        >
          {running === s.id ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.strategyButtonText}>{s.label}</Text>
            </View>
          ) : (
            <Text style={styles.strategyButtonText}>{s.label}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.strategyDesc}>{s.desc}</Text>
        {res != null && (
          <View style={[styles.strategyResult, { borderLeftColor: res.success ? '#10B981' : '#EF4444' }]}>
            <Text style={[styles.strategyResultText, { color: res.success ? '#10B981' : '#EF4444' }]}>
              {res.success ? `✓ ${res.name}` : `✗ ${friendlyError(res.error)}`}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.card}>
      {/* ── Detection ── */}
      <Text style={styles.cardTitle}>Détection NFC Passeport</Text>
      <Text style={styles.helpText}>
        Polling iso14443 sans PACE pour les passeports (Type B). Bougez
        lentement — jusqu'à 30 secondes.
      </Text>
      <View style={styles.positionHint}>
        <Text style={styles.positionHintText}>
          Placez la 4e de couverture du passeport (dos) contre le haut du
          iPhone, puce vers le téléphone. La puce est dans la couverture,
          pas dans les pages.
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.button, isDetecting && styles.disabled]}
        onPress={runDetection}
        disabled={isDetecting}
      >
        {isDetecting ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.buttonText}>Detection en cours...</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Tester la detection (Passeport)</Text>
        )}
      </TouchableOpacity>

      {detectionError && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{detectionError}</Text>
        </View>
      )}

      {detection && (
        <View style={styles.results}>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Tag detecte:</Text>
            <Text style={[styles.resultValue, { color: detection.tagDetected ? '#10B981' : '#EF4444' }]}>
              {detection.tagDetected ? 'OUI' : 'NON'}
            </Text>
          </View>
          {detection.tags?.map((tag: any, idx: number) => (
            <View key={idx}>
              {tag.identifier && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>UID:</Text>
                  <Text style={styles.resultValue}>{tag.identifier}</Text>
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
          {detection.aidProbeResults?.length > 0 && (
            <>
              <Text style={styles.sectionSubtitle}>SELECT AID:</Text>
              {detection.aidProbeResults.map((probe: any, idx: number) => (
                <View style={styles.resultRow} key={idx}>
                  <Text style={styles.resultLabel}>{probe.name.split('(')[0].trim()}:</Text>
                  <Text style={[styles.resultValue, { color: probe.success ? '#10B981' : '#EF4444' }]}>
                    {probe.success ? 'OK' : 'FAIL'} (SW={probe.sw})
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>
      )}

      {/* ── Scan limitation banner ── */}
      <View style={styles.warningBanner}>
        <Text style={styles.warningText}>
          Les boutons de scan ne détectent pas encore les passeports (Type B) —
          le lecteur NFC utilise le polling PACE qui bloque les passeports.
          Un nouveau build est nécessaire pour corriger cela.
          La détection ci-dessus fonctionne.
        </Text>
      </View>

      {/* ── Inputs (no CAN — passports don't use it) ── */}
      <Text style={styles.sectionTitle}>Scan PassportReader</Text>
      <Text style={styles.helpText}>
        N° passeport + dates depuis la zone MRZ (page 2 du passeport). Pas de CAN.
      </Text>
      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>N° passeport (MRZ, 9 chars)</Text>
          <TextInput
            style={styles.textInput}
            value={docNumber}
            onChangeText={setDocNumber}
            placeholder="XXXXXXXXX"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
      </View>
      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Naissance (JJ/MM/AA)</Text>
          <TextInput
            style={styles.textInput}
            value={fmtDate(dob)}
            onChangeText={t => setDob(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="JJ/MM/AA"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            maxLength={8}
            autoCorrect={false}
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Expiration (JJ/MM/AA)</Text>
          <TextInput
            style={styles.textInput}
            value={fmtDate(expiry)}
            onChangeText={t => setExpiry(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="JJ/MM/AA"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            maxLength={8}
            autoCorrect={false}
          />
        </View>
      </View>

      {/* ── Production ── */}
      <View style={styles.groupHeader}>
        <Text style={styles.groupHeaderText}>Flux production</Text>
        <Text style={styles.groupHeaderHint}>N° passeport + naissance + expiration</Text>
      </View>
      {renderStrategy(PRODUCTION_STRATEGY)}

      {/* ── PACE (type I) ── */}
      <View style={[styles.groupHeader, { marginTop: 8 }]}>
        <Text style={styles.groupHeaderText}>Tests PACE (type I)</Text>
        <Text style={styles.groupHeaderHint}>PACE activé — 4 variantes de credentials</Text>
      </View>
      {PACE_STRATEGIES.map(renderStrategy)}

      {/* ── Sans PACE / BAC (type P) ── */}
      <View style={[styles.groupHeader, { marginTop: 8 }]}>
        <Text style={styles.groupHeaderText}>Tests sans PACE (type P)</Text>
        <Text style={styles.groupHeaderHint}>PACE contourné — 3 variantes de credentials</Text>
      </View>
      {BAC_STRATEGIES.map(renderStrategy)}
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
    sectionTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: colors.text,
      marginTop: 4,
    },
    helpText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    button: {
      backgroundColor: '#1D4ED8',
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    primaryButton: {
      backgroundColor: '#059669',
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    strategyButton: {
      backgroundColor: '#5B21B6',
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    disabled: { opacity: 0.4 },
    buttonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: '#FFFFFF',
    },
    strategyButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
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
    inputRow: { flexDirection: 'row', gap: 10 },
    inputGroup: { flex: 1, gap: 4 },
    inputLabel: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 11,
      color: colors.textSecondary,
    },
    textInput: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
    },
    positionHint: {
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 10,
      borderLeftWidth: 3,
      borderLeftColor: '#1D4ED8',
    },
    positionHintText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    warningBanner: {
      backgroundColor: '#FEF3C7',
      borderRadius: 8,
      padding: 12,
      borderLeftWidth: 3,
      borderLeftColor: '#F59E0B',
    },
    warningText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: '#92400E',
      lineHeight: 17,
    },
    groupHeader: {
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 2,
    },
    groupHeaderText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 13,
      color: colors.text,
    },
    groupHeaderHint: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 11,
      color: colors.textSecondary,
    },
    strategyRow: { gap: 4 },
    strategyDesc: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 11,
      color: colors.textSecondary,
      paddingHorizontal: 2,
    },
    strategyResult: {
      borderLeftWidth: 3,
      paddingLeft: 8,
      paddingVertical: 4,
      marginTop: 2,
    },
    strategyResultText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 12,
    },
  });
