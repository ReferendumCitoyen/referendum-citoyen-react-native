import React from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors, Typography } from '@/constants/theme';
import { scanDocument, testPassportDetection } from '@/modules/e-document';

type MRZData = {
  docType: string;
  issuingCountry: string;
  lastName: string;
  firstName: string;
  docNumber: string;
  nationality: string;
  dob: string;
  gender: string;
  expiry: string;
};

type ScanSuccess = {
  success: true;
  name: string;
  mrz: MRZData | null;
  photoB64: string | null;
  dg1Size: number;
  sodSize: number;
  dg15Size: number;
  dg11Size: number;
  aaPresent: boolean;
};

type StrategyResult = ScanSuccess | { success: false; error: string } | null;

// ── MRZ parsing ──────────────────────────────────────────────────────────────

function parseTD3MRZ(dg1: Uint8Array): MRZData | null {
  // Walk TLV to find 0x5F1F (MRZ Data tag)
  let i = 0;
  while (i < dg1.length - 3) {
    if (dg1[i] === 0x5F && dg1[i + 1] === 0x1F) {
      i += 2;
      let len = dg1[i++];
      if (len & 0x80) {
        const n = len & 0x7F;
        len = 0;
        for (let j = 0; j < n; j++) len = (len << 8) | dg1[i++];
      }
      const mrz = Array.from(dg1.slice(i, i + len))
        .map(b => String.fromCharCode(b))
        .join('');
      if (mrz.length < 88) return null;
      const l1 = mrz.slice(0, 44);
      const l2 = mrz.slice(44, 88);
      const nameParts = l1.slice(5).split('<<');
      return {
        docType: l1[0] === 'P' ? 'Passport' : l1.slice(0, 2),
        issuingCountry: l1.slice(2, 5).replace(/</g, ''),
        lastName: nameParts[0].replace(/</g, ' ').trim(),
        firstName: (nameParts[1] || '').replace(/</g, ' ').trim(),
        docNumber: l2.slice(0, 9).replace(/</g, ''),
        nationality: l2.slice(10, 13).replace(/</g, ''),
        dob: l2.slice(13, 19),
        gender: l2[20],
        expiry: l2.slice(21, 27),
      };
    }
    i++;
  }
  return null;
}

function fmtMRZDate(yymmdd: string): string {
  if (yymmdd.length !== 6 || /[<\s]/.test(yymmdd)) return yymmdd;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const year = yy <= new Date().getFullYear() % 100 + 10 ? 2000 + yy : 1900 + yy;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd} ${months[mm - 1] || '?'} ${year}`;
}

function fmtGender(g: string): string {
  return g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Unspecified';
}

const COUNTRIES: Record<string, string> = {
  CHN: 'China', FRA: 'France', GBR: 'United Kingdom', DEU: 'Germany',
  USA: 'United States', ITA: 'Italy', ESP: 'Spain', PRT: 'Portugal',
  BEL: 'Belgium', NLD: 'Netherlands', POL: 'Poland', RUS: 'Russia',
  JPN: 'Japan', KOR: 'South Korea', IND: 'India', BRA: 'Brazil',
  AUS: 'Australia', CAN: 'Canada', CHE: 'Switzerland', SWE: 'Sweden',
};
const countryName = (code: string) => COUNTRIES[code] ?? code;

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
      const mrz = data.dg1Bytes?.length ? parseTD3MRZ(data.dg1Bytes) : null;

      // ── Full diagnostic dump ──────────────────────────────────────────
      console.log('[PASSPORT DIAG] ═══ Strategy:', s.label, '═══');
      console.log('[PASSPORT DIAG] docCode:', data.docCode);
      const { passportImageRaw: _img, ...pNoPhoto } = p;
      console.log('[PASSPORT DIAG] personDetails (raw from iOS):', JSON.stringify(pNoPhoto, null, 2));
      console.log('[PASSPORT DIAG] MRZ parsed:', mrz ? JSON.stringify(mrz, null, 2) : 'dg1 empty or parse failed');
      console.log('[PASSPORT DIAG] DG sizes:');
      console.log('  dg1 (MRZ):', data.dg1Bytes?.length ?? 0, 'bytes');
      console.log('  sod (signatures):', data.sodBytes?.length ?? 0, 'bytes');
      console.log('  dg11 (supplementary):', data.dg11Bytes?.length ?? 0, 'bytes');
      console.log('  dg15 (AA pubkey):', data.dg15Bytes?.length ?? 0, 'bytes');
      console.log('  aaSignature:', data.aaSignature?.length ?? 0, 'bytes');
      if (data.dg1Bytes?.length) {
        console.log('[PASSPORT DIAG] DG1 hex:', Array.from(data.dg1Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
      if (data.dg11Bytes?.length) {
        console.log('[PASSPORT DIAG] DG11 hex:', Array.from(data.dg11Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        // Parse DG11 TLV fields
        try {
          const dg11 = data.dg11Bytes;
          const DG11_TAGS: Record<string, string> = {
            '5f0e': 'Full Name', '5f0f': 'Other Names', '5f10': 'Personal Number',
            '5f2b': 'Full DOB', '5f11': 'Place of Birth', '5f42': 'Address',
            '5f12': 'Phone', '5f13': 'Profession',
          };
          let di = 0;
          // skip outer 6B tag+len
          if (dg11[di] === 0x6B) { di++; if (dg11[di] & 0x80) di += (dg11[di] & 0x7F) + 1; else di++; }
          while (di < dg11.length) {
            if (dg11[di] === 0x5C) { di++; di += dg11[di] + 1; continue; } // skip tag list
            let tag = (dg11[di] & 0x1F) === 0x1F
              ? (dg11[di++].toString(16).padStart(2,'0') + dg11[di++].toString(16).padStart(2,'0'))
              : dg11[di++].toString(16).padStart(2,'0');
            let flen = dg11[di++];
            if (flen & 0x80) { const n = flen & 0x7F; flen = 0; for (let j=0;j<n;j++) flen=(flen<<8)|dg11[di++]; }
            const val = Array.from(dg11.slice(di, di+flen)).map(b=>String.fromCharCode(b)).join('').replace(/</g,' ').trim();
            console.log(`[PASSPORT DIAG] DG11 ${DG11_TAGS[tag] ?? tag}: "${val}"`);
            di += flen;
          }
        } catch {}
      }
      if (data.dg15Bytes?.length) {
        console.log('[PASSPORT DIAG] DG15 hex:', Array.from(data.dg15Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        // Identify AA key algorithm from known OIDs
        const d15 = Array.from(data.dg15Bytes);
        const matchBytes = (seq: number[]) => d15.some((_,i) => seq.every((b,j) => d15[i+j] === b));
        const aaAlgo =
          matchBytes([0x2b,0x24,0x03,0x03,0x02,0x08,0x01,0x01,0x0d]) ? 'EC brainpoolP512r1 (512-bit)' :
          matchBytes([0x2b,0x24,0x03,0x03,0x02,0x08,0x01,0x01,0x0b]) ? 'EC brainpoolP384r1 (384-bit)' :
          matchBytes([0x2b,0x24,0x03,0x03,0x02,0x08,0x01,0x01,0x07]) ? 'EC brainpoolP256r1 (256-bit)' :
          matchBytes([0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07])       ? 'EC NIST P-256 (256-bit)' :
          matchBytes([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01]) ? 'RSA' : 'Unknown';
        console.log('[PASSPORT DIAG] DG15 AA key algorithm:', aaAlgo);
        // EC uncompressed point starts with 04 after the BIT STRING tag
        const ptIdx = d15.indexOf(0x04, 20);
        if (ptIdx >= 0) {
          const coordLen = (data.dg15Bytes.length - ptIdx - 1) / 2;
          console.log('[PASSPORT DIAG] DG15 AA key size:', coordLen * 8, 'bits (EC uncompressed point)');
        }
      }
      if (data.aaSignature?.length) {
        const sigLen = data.aaSignature.length;
        const sigType = sigLen === 64 ? 'ECDSA P-256/brainpool256 (r=32, s=32)' :
                        sigLen === 96 ? 'ECDSA P-384/brainpool384 (r=48, s=48)' :
                        sigLen === 128 ? 'ECDSA P-512 or RSA-1024 (128 bytes)' :
                        sigLen >= 256 ? `RSA-${sigLen*8}` : `${sigLen} bytes`;
        console.log('[PASSPORT DIAG] AA signature type:', sigType);
        console.log('[PASSPORT DIAG] AA signature hex:', Array.from(data.aaSignature).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
      if (data.sodBytes?.length) {
        const sod = Array.from(data.sodBytes.slice(0, 64));
        console.log('[PASSPORT DIAG] SOD (first 64 bytes):', sod.map(b => b.toString(16).padStart(2, '0')).join(' '));
        // Identify hash algorithm from SOD
        const hashOIDs: Record<string, string> = {
          '608648016503040201': 'SHA-256',
          '608648016503040202': 'SHA-384',
          '608648016503040203': 'SHA-512',
          '2a864886f70d020900': 'SHA-1',
        };
        const sodHex = Array.from(data.sodBytes.slice(0, 128)).map(b=>b.toString(16).padStart(2,'0')).join('');
        const hashAlgo = Object.entries(hashOIDs).find(([oid]) => sodHex.includes(oid));
        console.log('[PASSPORT DIAG] SOD hash algorithm:', hashAlgo ? hashAlgo[1] : 'unknown');
      }
      if (p.passportImageRaw) {
        const ph = p.passportImageRaw;
        console.log('[PASSPORT DIAG] photo:', `${ph.length} chars — ${ph.slice(0, 20)}...${ph.slice(-20)}`);
      } else {
        console.log('[PASSPORT DIAG] photo: absent');
      }
      console.log('[PASSPORT DIAG] ═══════════════════════════════════');
      setResults(r => ({ ...r, [s.id]: {
        success: true,
        name,
        mrz,
        photoB64: p.passportImageRaw ?? null,
        dg1Size: data.dg1Bytes?.length ?? 0,
        sodSize: data.sodBytes?.length ?? 0,
        dg15Size: data.dg15Bytes?.length ?? 0,
        dg11Size: data.dg11Bytes?.length ?? 0,
        aaPresent: (data.aaSignature?.length ?? 0) > 0,
      } }));
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
        {res != null && !res.success && (
          <View style={[styles.strategyResult, { borderLeftColor: '#EF4444' }]}>
            <Text style={[styles.strategyResultText, { color: '#EF4444' }]}>
              {`✗ ${friendlyError(res.error)}`}
            </Text>
          </View>
        )}
        {res != null && res.success && (
          <View style={styles.richResult}>
            {/* Photo + identity side by side */}
            <View style={styles.richRow}>
              {res.photoB64 ? (
                <Image
                  source={{ uri: `data:image/png;base64,${res.photoB64}` }}
                  style={styles.photo}
                />
              ) : null}
              <View style={styles.richFields}>
                {res.mrz ? (
                  <>
                    <Text style={styles.richName}>
                      {[res.mrz.firstName, res.mrz.lastName].filter(Boolean).join(' ') || res.name}
                    </Text>
                    <Text style={styles.richField}>📄 {res.mrz.docType} · {res.mrz.docNumber}</Text>
                    <Text style={styles.richField}>🌍 {countryName(res.mrz.nationality)} ({res.mrz.nationality})</Text>
                    <Text style={styles.richField}>🎂 {fmtMRZDate(res.mrz.dob)}</Text>
                    <Text style={styles.richField}>⏳ Expires {fmtMRZDate(res.mrz.expiry)}</Text>
                    <Text style={styles.richField}>⚥ {fmtGender(res.mrz.gender)}</Text>
                    <Text style={styles.richField}>🏛 Issued by {countryName(res.mrz.issuingCountry)}</Text>
                  </>
                ) : (
                  <Text style={styles.richName}>{res.name}</Text>
                )}
              </View>
            </View>
            {/* Chip info */}
            <View style={styles.chipInfo}>
              <Text style={styles.chipInfoTitle}>Chip data</Text>
              <Text style={styles.chipInfoRow}>DG1 (MRZ) · {res.dg1Size} bytes</Text>
              <Text style={styles.chipInfoRow}>SOD (signatures) · {res.sodSize} bytes</Text>
              {res.dg11Size > 0 && <Text style={styles.chipInfoRow}>DG11 (supplementary) · {res.dg11Size} bytes</Text>}
              {res.dg15Size > 0 && <Text style={styles.chipInfoRow}>DG15 (AA public key) · {res.dg15Size} bytes</Text>}
              <Text style={[styles.chipInfoRow, { color: res.aaPresent ? '#10B981' : colors.textSecondary }]}>
                {res.aaPresent ? '✓ Active Authentication (clone-proof chip)' : '— No Active Authentication'}
              </Text>
            </View>
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
    richResult: {
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 12,
      gap: 10,
      marginTop: 4,
    },
    richRow: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
    },
    photo: {
      width: 72,
      height: 90,
      borderRadius: 6,
      backgroundColor: colors.border,
    },
    richFields: {
      flex: 1,
      gap: 3,
    },
    richName: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    richField: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    chipInfo: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
      gap: 3,
    },
    chipInfoTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 11,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    chipInfoRow: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
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
