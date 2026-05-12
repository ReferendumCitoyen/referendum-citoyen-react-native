import React from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
import { useColors, Typography } from '@/constants/theme';
import { scanDocument, testPassportDetection } from '@/modules/e-document';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { Worklets } from 'react-native-worklets-core';
import { parse } from 'mrz';
import { CircuitSuiteProbe } from './CircuitSuiteProbe';

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
  dg12Size: number;
  dg14Size: number;
  aaPresent: boolean;
  placeOfBirth: string | null;
  personalNumber: string | null;
  dgHashList: number[];
  dscSigAlgo: string | null;
  issuingAuthority: string | null;
  dateOfIssue: string | null;
  // Raw bytes retained so the CircuitSuiteProbe can re-parse the SOD
  // without going through the native module again.
  dg1Bytes: Uint8Array;
  sodBytes: Uint8Array;
  dg15Bytes?: Uint8Array;
  aaSignature?: Uint8Array;
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

// ── SOD / DSC parsing ────────────────────────────────────────────────────────

// Pattern-scan the SOD for DG hash entries.
// SHA-256 pattern: 30 25 02 01 [DG# 01-10] 04 20 [32-byte hash]
function parseSodDGHashes(sod: Uint8Array): number[] {
  const found: Set<number> = new Set();
  for (let i = 0; i < sod.length - 38; i++) {
    if (
      sod[i]   === 0x30 && sod[i+1] === 0x25 &&
      sod[i+2] === 0x02 && sod[i+3] === 0x01 &&
      sod[i+4] >= 0x01 && sod[i+4] <= 0x10 &&
      sod[i+5] === 0x04 && sod[i+6] === 0x20
    ) {
      found.add(sod[i+4]);
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

// Scan the SOD for the document signing algorithm OID.
function parseSodSigAlgo(sod: Uint8Array): string {
  const arr = Array.from(sod);
  const has = (seq: number[]) =>
    arr.some((_, i) => seq.every((b, j) => arr[i + j] === b));
  if (has([0x2a,0x86,0x48,0xce,0x3d,0x04,0x03,0x04])) return 'ECDSA-SHA512';
  if (has([0x2a,0x86,0x48,0xce,0x3d,0x04,0x03,0x03])) return 'ECDSA-SHA384';
  if (has([0x2a,0x86,0x48,0xce,0x3d,0x04,0x03,0x02])) return 'ECDSA-SHA256';
  if (has([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0d])) return 'RSA-PSS-SHA512';
  if (has([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0c])) return 'RSA-PSS-SHA384';
  if (has([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0b])) return 'RSA-SHA256';
  if (has([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x05])) return 'RSA-SHA1';
  return 'unknown';
}

// Extract the personal number from the MRZ optional field (positions 29-42 of line 2).
function parseMrzOptional(dg1: Uint8Array): string | null {
  let i = 0;
  while (i < dg1.length - 3) {
    if (dg1[i] === 0x5F && dg1[i+1] === 0x1F) {
      i += 2;
      let len = dg1[i++];
      if (len & 0x80) { const n = len & 0x7F; len = 0; for (let j = 0; j < n; j++) len = (len << 8) | dg1[i++]; }
      if (len < 88) return null;
      const line2 = Array.from(dg1.slice(i + 44, i + 88)).map(b => String.fromCharCode(b)).join('');
      // Positions 28-41 (0-indexed) of line 2 = optional/personal number field
      const raw = line2.slice(28, 42).replace(/^<+|<+$/g, '').replace(/</g, ' ').trim();
      return raw || null;
    }
    i++;
  }
  return null;
}

// Parse DG11 for place of birth (5F11) and personal number (5F10).
function parseDG11Fields(dg11: Uint8Array): { placeOfBirth?: string; personalNumber?: string } {
  const result: { placeOfBirth?: string; personalNumber?: string } = {};
  let i = 0;
  if (dg11[i] === 0x6B) { i++; if (dg11[i] & 0x80) i += (dg11[i] & 0x7F) + 1; else i++; }
  while (i < dg11.length - 1) {
    if (dg11[i] === 0x5C) { i++; i += dg11[i] + 1; continue; }
    if (dg11[i] === 0x5F) {
      const tag = (dg11[i] << 8) | dg11[i+1]; i += 2;
      let len = dg11[i++];
      if (len & 0x80) { const n = len & 0x7F; len = 0; for (let j = 0; j < n; j++) len = (len << 8) | dg11[i++]; }
      const val = Array.from(dg11.slice(i, i + len)).map(b => String.fromCharCode(b)).join('').replace(/</g, ' ').trim();
      if (tag === 0x5F11) result.placeOfBirth = val;
      if (tag === 0x5F10) result.personalNumber = val;
      i += len;
    } else { i++; }
  }
  return result;
}

// Parse DG12 for issuing authority (5F19) and date of issue (5F26).
function parseDG12(dg12: Uint8Array): { issuingAuthority?: string; dateOfIssue?: string } {
  const result: { issuingAuthority?: string; dateOfIssue?: string } = {};
  let i = 0;
  if (dg12[i] === 0x6C) { i++; if (dg12[i] & 0x80) i += (dg12[i] & 0x7F) + 1; else i++; }
  while (i < dg12.length - 1) {
    if (dg12[i] === 0x5C) { i++; i += dg12[i] + 1; continue; }
    if (dg12[i] === 0x5F) {
      const tag = (dg12[i] << 8) | dg12[i+1]; i += 2;
      let len = dg12[i++];
      if (len & 0x80) { const n = len & 0x7F; len = 0; for (let j = 0; j < n; j++) len = (len << 8) | dg12[i++]; }
      const val = Array.from(dg12.slice(i, i + len)).map(b => String.fromCharCode(b)).join('').trim();
      if (tag === 0x5F19) result.issuingAuthority = val;
      if (tag === 0x5F26) result.dateOfIssue = val; // YYYYMMDD
      i += len;
    } else { i++; }
  }
  return result;
}

// Summarise DG14 security info OIDs (chip authentication / PACE).
function parseDG14Summary(dg14: Uint8Array): string {
  const arr = Array.from(dg14);
  const has = (seq: number[]) => arr.some((_, i) => seq.every((b, j) => arr[i + j] === b));
  const parts: string[] = [];
  // BSI Chip Authentication OIDs: 0.4.0.127.0.7.2.2.3.x
  if (has([0x04,0x00,0x7f,0x00,0x07,0x02,0x02,0x03])) parts.push('Chip Authentication');
  // BSI PACE OIDs: 0.4.0.127.0.7.2.2.4.x
  if (has([0x04,0x00,0x7f,0x00,0x07,0x02,0x02,0x04])) parts.push('PACE');
  // BSI Terminal Authentication: 0.4.0.127.0.7.2.2.2
  if (has([0x04,0x00,0x7f,0x00,0x07,0x02,0x02,0x02])) parts.push('Terminal Auth');
  return parts.length ? parts.join(', ') : 'no BSI protocols detected';
}

function fmtISODate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  return `${parseInt(yyyymmdd.slice(6, 8), 10)} ${months[m] ?? '?'} ${yyyymmdd.slice(0, 4)}`;
}

// Camera MRZ parser (TD3 — passports, 2×44 chars)
function parseTD3MRZ_cam(lines: string[]): { valid: boolean; linesFound: number; fields?: any } | null {
  const isMRZLike = (line: string) => {
    const c = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
    return (c.includes('<<') || c.startsWith('P<')) && c.replace(/[A-Z0-9<]/g, '').length < 5 && c.length >= 30;
  };
  const mrzLines = lines.filter(isMRZLike);
  if (mrzLines.length < 2) return { valid: false, linesFound: mrzLines.length };
  try {
    const td3 = mrzLines.slice(-2).map(l => {
      const c = l.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
      return c.length > 44 ? c.slice(0, 44) : c.padEnd(44, '<');
    });
    const result = parse(td3, { autocorrect: true });
    if (result?.valid && result.format === 'TD3') return { valid: true, linesFound: 2, fields: result.fields };
  } catch {}
  return { valid: false, linesFound: mrzLines.length };
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
  label: 'Scanner le passeport',
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
  // Per-strategy toggle for the technical-details (CircuitSuiteProbe) panel.
  // Defaults closed; users opt in when they want to see SOD/cert/circuit details.
  const [showProbe, setShowProbe] = React.useState<Record<string, boolean>>({});
  const [showDetails, setShowDetails] = React.useState<Record<string, boolean>>({});

  // Fullscreen photo viewer
  const [fullscreenPhoto, setFullscreenPhoto] = React.useState<string | null>(null);

  // Camera MRZ scanner
  const device = useCameraDevice('back');
  const { hasPermission: camHasPerm, requestPermission: camRequestPerm } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin' });
  const [showCamera, setShowCamera] = React.useState(false);
  const [camProgress, setCamProgress] = React.useState<'scanning' | 'partial' | 'success'>('scanning');
  const lastMRZKeyRef = React.useRef<string | null>(null);
  const consecutiveMatchRef = React.useRef(0);

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    const result = parseTD3MRZ_cam(lines);
    if (result?.valid && result.fields) {
      const key = `${result.fields.documentNumber}-${result.fields.birthDate}-${result.fields.expirationDate}`;
      if (key === lastMRZKeyRef.current) {
        consecutiveMatchRef.current++;
      } else {
        consecutiveMatchRef.current = 1;
        lastMRZKeyRef.current = key;
      }
      if (consecutiveMatchRef.current < 2) { setCamProgress('partial'); return; }
      // Convert YYMMDD (MRZ) → DDMMYY (form state)
      const toDDMMYY = (yymmdd: string) =>
        yymmdd.length === 6 ? yymmdd.slice(4, 6) + yymmdd.slice(2, 4) + yymmdd.slice(0, 2) : '';
      setDocNumber((result.fields.documentNumber || '').trim().toUpperCase());
      setDob(toDDMMYY(result.fields.birthDate || ''));
      setExpiry(toDDMMYY(result.fields.expirationDate || ''));
      setCamProgress('success');
      consecutiveMatchRef.current = 0;
      lastMRZKeyRef.current = null;
      setTimeout(() => setShowCamera(false), 500);
    } else {
      setCamProgress(result && result.linesFound > 0 ? 'partial' : 'scanning');
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    runAtTargetFps(2, () => {
      'worklet';
      const data = scanText(frame);
      try {
        let text = '';
        if (data) {
          if (Array.isArray(data) && data.length) text = (data as any[]).map((el: any) => el.resultText).join('\n');
          else if (data && 'resultText' in data) text = (data as any).resultText as string;
          if (text) onMRZDetected(text.split('\n'));
        }
      } catch {}
    });
  }, [scanText, onMRZDetected]);

  const openMRZCamera = async () => {
    if (!camHasPerm) {
      const ok = await camRequestPerm();
      if (!ok) return;
    }
    setCamProgress('scanning');
    lastMRZKeyRef.current = null;
    consecutiveMatchRef.current = 0;
    setShowCamera(true);
  };

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

      // ── Parse enriched fields ─────────────────────────────────────────
      const dg11Fields = data.dg11Bytes?.length ? parseDG11Fields(data.dg11Bytes) : {};
      const placeOfBirth = dg11Fields.placeOfBirth ?? null;
      const personalNumDG11 = dg11Fields.personalNumber ?? null;
      const personalNumMRZ = data.dg1Bytes?.length ? parseMrzOptional(data.dg1Bytes) : null;
      const personalNumber = personalNumDG11 || personalNumMRZ;
      const dgHashList = data.sodBytes?.length ? parseSodDGHashes(data.sodBytes) : [];
      const dscSigAlgo = data.sodBytes?.length ? parseSodSigAlgo(data.sodBytes) : null;
      const dg12Info = data.dg12Bytes?.length ? parseDG12(data.dg12Bytes) : {};
      const dg14Summary = data.dg14Bytes?.length ? parseDG14Summary(data.dg14Bytes) : null;

      // ── Full diagnostic dump ──────────────────────────────────────────
      console.log('[PASSPORT DIAG] ═══ Strategy:', s.label, '═══');
      console.log('[PASSPORT DIAG] docCode:', data.docCode);
      const { passportImageRaw: _img, ...pNoPhoto } = p;
      console.log('[PASSPORT DIAG] personDetails (raw from iOS):', JSON.stringify(pNoPhoto, null, 2));
      console.log('[PASSPORT DIAG] MRZ parsed:', mrz ? JSON.stringify(mrz, null, 2) : 'dg1 empty or parse failed');
      if (personalNumber) console.log('[PASSPORT DIAG] MRZ personal number:', personalNumber);
      console.log('[PASSPORT DIAG] DG sizes:');
      console.log('  dg1 (MRZ):', data.dg1Bytes?.length ?? 0, 'bytes');
      console.log('  sod (signatures):', data.sodBytes?.length ?? 0, 'bytes');
      console.log('  dg11 (supplementary):', data.dg11Bytes?.length ?? 0, 'bytes');
      console.log('  dg12 (doc details):', data.dg12Bytes?.length ?? 0, 'bytes');
      console.log('  dg14 (chip auth info):', data.dg14Bytes?.length ?? 0, 'bytes');
      console.log('  dg15 (AA pubkey):', data.dg15Bytes?.length ?? 0, 'bytes');
      console.log('  aaSignature:', data.aaSignature?.length ?? 0, 'bytes');
      if (data.dg1Bytes?.length) {
        console.log('[PASSPORT DIAG] DG1 hex:', Array.from(data.dg1Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
      if (data.dg11Bytes?.length) {
        console.log('[PASSPORT DIAG] DG11 hex:', Array.from(data.dg11Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        if (placeOfBirth) console.log('[PASSPORT DIAG] DG11 Place of Birth:', placeOfBirth);
        if (personalNumDG11) console.log('[PASSPORT DIAG] DG11 Personal Number:', personalNumDG11);
      }
      if (data.dg12Bytes?.length) {
        console.log('[PASSPORT DIAG] DG12 hex:', Array.from(data.dg12Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        if (dg12Info.issuingAuthority) console.log('[PASSPORT DIAG] DG12 Issuing Authority:', dg12Info.issuingAuthority);
        if (dg12Info.dateOfIssue) console.log('[PASSPORT DIAG] DG12 Date of Issue:', dg12Info.dateOfIssue, '→', fmtISODate(dg12Info.dateOfIssue));
      } else {
        console.log('[PASSPORT DIAG] DG12: not returned by native module (build with DG12 in tagsToRead)');
      }
      if (data.dg14Bytes?.length) {
        console.log('[PASSPORT DIAG] DG14 hex (first 48 bytes):', Array.from(data.dg14Bytes.slice(0, 48)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.log('[PASSPORT DIAG] DG14 security protocols:', dg14Summary);
      } else {
        console.log('[PASSPORT DIAG] DG14: absent (chip does not advertise extended access control)');
      }
      if (data.dg15Bytes?.length) {
        console.log('[PASSPORT DIAG] DG15 hex:', Array.from(data.dg15Bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        const d15 = Array.from(data.dg15Bytes);
        const matchBytes = (seq: number[]) => d15.some((_,i) => seq.every((b,j) => d15[i+j] === b));
        const aaAlgo =
          matchBytes([0x2b,0x24,0x03,0x03,0x02,0x08,0x01,0x01,0x0d]) ? 'EC brainpoolP512r1 (512-bit)' :
          matchBytes([0x2b,0x24,0x03,0x03,0x02,0x08,0x01,0x01,0x0b]) ? 'EC brainpoolP384r1 (384-bit)' :
          matchBytes([0x2b,0x24,0x03,0x03,0x02,0x08,0x01,0x01,0x07]) ? 'EC brainpoolP256r1 (256-bit)' :
          matchBytes([0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07])      ? 'EC NIST P-256 (256-bit)' :
          matchBytes([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01]) ? 'RSA' : 'Unknown';
        console.log('[PASSPORT DIAG] DG15 AA key algorithm:', aaAlgo);
        const ptIdx = d15.indexOf(0x04, 20);
        if (ptIdx >= 0) {
          const coordLen = (data.dg15Bytes.length - ptIdx - 1) / 2;
          console.log('[PASSPORT DIAG] DG15 AA key size:', coordLen * 8, 'bits');
        }
      }
      if (data.aaSignature?.length) {
        const sigLen = data.aaSignature.length;
        const sigType = sigLen === 64 ? 'ECDSA P-256/brainpool256 (r=32, s=32)' :
                        sigLen === 96 ? 'ECDSA P-384/brainpool384 (r=48, s=48)' :
                        sigLen === 128 ? 'ECDSA P-512 or RSA-1024' :
                        sigLen >= 256 ? `RSA-${sigLen*8}` : `${sigLen} bytes`;
        console.log('[PASSPORT DIAG] AA signature type:', sigType);
        console.log('[PASSPORT DIAG] AA signature hex:', Array.from(data.aaSignature).map(b => b.toString(16).padStart(2, '0')).join(' '));
      }
      if (data.sodBytes?.length) {
        console.log('[PASSPORT DIAG] SOD DG hash list (DGs present on chip):', dgHashList.map(n => `DG${n}`).join(', '));
        console.log('[PASSPORT DIAG] SOD DSC signing algorithm:', dscSigAlgo);
        const hashOIDs: Record<string, string> = {
          '608648016503040201': 'SHA-256', '608648016503040202': 'SHA-384',
          '608648016503040203': 'SHA-512', '2a864886f70d020900': 'SHA-1',
        };
        const sodHex = Array.from(data.sodBytes.slice(0, 128)).map(b=>b.toString(16).padStart(2,'0')).join('');
        const hashAlgo = Object.entries(hashOIDs).find(([oid]) => sodHex.includes(oid));
        console.log('[PASSPORT DIAG] SOD DG hash algorithm:', hashAlgo ? hashAlgo[1] : 'unknown');
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
        dg12Size: data.dg12Bytes?.length ?? 0,
        dg14Size: data.dg14Bytes?.length ?? 0,
        aaPresent: (data.aaSignature?.length ?? 0) > 0,
        placeOfBirth,
        personalNumber,
        dgHashList,
        dscSigAlgo,
        issuingAuthority: dg12Info.issuingAuthority ?? null,
        dateOfIssue: dg12Info.dateOfIssue ?? null,
        dg1Bytes: data.dg1Bytes ?? new Uint8Array(),
        sodBytes: data.sodBytes ?? new Uint8Array(),
        dg15Bytes: data.dg15Bytes,
        aaSignature: data.aaSignature,
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
        {res != null && !res.success && (
          <View style={[styles.strategyResult, { borderLeftColor: '#EF4444' }]}>
            <Text style={[styles.strategyResultText, { color: '#EF4444' }]}>
              {`✗ ${friendlyError(res.error)}`}
            </Text>
          </View>
        )}
        {res != null && res.success && (
          <View style={styles.richResult}>
            {/* Primary: photo + DG1 confirmation */}
            <View style={styles.richRow}>
              {res.photoB64 ? (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setFullscreenPhoto(res.photoB64!)}
                >
                  <Image
                    source={{ uri: `data:image/png;base64,${res.photoB64}` }}
                    style={styles.photo}
                  />
                  <Text style={styles.photoHint}>tap to enlarge</Text>
                </TouchableOpacity>
              ) : null}
              {res.dg1Size > 0 && (
                <View style={styles.dg1Badge}>
                  <Text style={styles.dg1BadgeText}>✓ Passeport lu</Text>
                </View>
              )}
            </View>
            {/* Details — shown by default, user can collapse */}
            <TouchableOpacity
              style={styles.probeToggle}
              onPress={() => setShowDetails(d => ({ ...d, [s.id]: d[s.id] !== false ? false : true }))}
              activeOpacity={0.7}
            >
              <Text style={styles.probeToggleText}>
                {showDetails[s.id] !== false ? '▼ Masquer les détails' : '▶ Voir les détails'}
              </Text>
            </TouchableOpacity>
            {showDetails[s.id] !== false && (
              <>
                {res.mrz ? (
                  <View style={styles.richFields}>
                    <Text style={styles.richName}>
                      {[res.mrz.firstName, res.mrz.lastName].filter(Boolean).join(' ') || res.name}
                    </Text>
                    <Text style={styles.richField}>📄 {res.mrz.docType} · {res.mrz.docNumber}</Text>
                    <Text style={styles.richField}>🌍 {countryName(res.mrz.nationality)} ({res.mrz.nationality})</Text>
                    <Text style={styles.richField}>🎂 {fmtMRZDate(res.mrz.dob)}</Text>
                    <Text style={styles.richField}>⏳ Expires {fmtMRZDate(res.mrz.expiry)}</Text>
                    <Text style={styles.richField}>⚥ {fmtGender(res.mrz.gender)}</Text>
                    <Text style={styles.richField}>🏛 Issued by {countryName(res.mrz.issuingCountry)}</Text>
                  </View>
                ) : (
                  <Text style={styles.richName}>{res.name}</Text>
                )}
                {(res.placeOfBirth || res.personalNumber || res.issuingAuthority || res.dateOfIssue) && (
                  <View style={styles.chipInfo}>
                    <Text style={styles.chipInfoTitle}>Document details</Text>
                    {res.placeOfBirth ? <Text style={styles.chipInfoRow}>🏙 Born in: {res.placeOfBirth}</Text> : null}
                    {res.personalNumber ? <Text style={styles.chipInfoRow}>🔢 Personal №: {res.personalNumber}</Text> : null}
                    {res.issuingAuthority ? <Text style={styles.chipInfoRow}>🏛 Issued by: {res.issuingAuthority}</Text> : null}
                    {res.dateOfIssue ? <Text style={styles.chipInfoRow}>📅 Date of issue: {fmtISODate(res.dateOfIssue)}</Text> : null}
                  </View>
                )}
              </>
            )}
            {/* Circuit-suite probe (read-only inspection of SOD + DG15 + DSC).
                Default-collapsed so the normal diagnostic UX stays clean. */}
            <TouchableOpacity
              style={styles.probeToggle}
              onPress={() => setShowProbe(p => ({ ...p, [s.id]: !p[s.id] }))}
              activeOpacity={0.7}
            >
              <Text style={styles.probeToggleText}>
                {showProbe[s.id] ? '▼ Hide technical details' : '▶ Show technical details'}
              </Text>
            </TouchableOpacity>
            {showProbe[s.id] && res.dg1Bytes && res.sodBytes && (
              <CircuitSuiteProbe
                dg1Bytes={res.dg1Bytes}
                sodBytes={res.sodBytes}
                dg15Bytes={res.dg15Bytes}
                aaSignature={res.aaSignature}
              />
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.card}>
      {/* ── Fullscreen photo modal ── */}
      <Modal
        visible={fullscreenPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenPhoto(null)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.photoModalBg}
          activeOpacity={1}
          onPress={() => setFullscreenPhoto(null)}
        >
          {fullscreenPhoto ? (
            <Image
              source={{ uri: `data:image/png;base64,${fullscreenPhoto}` }}
              style={styles.photoModalImg}
              resizeMode="contain"
            />
          ) : null}
          <View style={styles.photoModalClose}>
            <Text style={styles.photoModalCloseText}>✕</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Detection ── */}
      <Text style={styles.cardTitle}>Détecter votre passeport</Text>
      <Text style={styles.helpText}>
        Vérifiez que votre téléphone détecte bien la puce NFC de votre passeport.
        Déplacez-le lentement — jusqu'à 30 secondes.
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
            <Text style={styles.resultLabel}>Puce détectée :</Text>
            <Text style={[styles.resultValue, { color: detection.tagDetected ? '#10B981' : '#EF4444' }]}>
              {detection.tagDetected ? 'OUI ✓' : 'NON ✗'}
            </Text>
          </View>
        </View>
      )}

      {/* ── Inputs ── */}
      <Text style={styles.sectionTitle}>Scanner votre passeport</Text>
      <Text style={styles.helpText}>
        Scannez d'abord le MRZ (les deux lignes en bas de la page photo), puis approchez la puce.
      </Text>

      {/* MRZ camera scanner */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#7C3AED' }]}
        onPress={openMRZCamera}
        disabled={running !== null}
      >
        <Text style={styles.buttonText}>📷 Scanner le MRZ</Text>
      </TouchableOpacity>

      {showCamera ? (
        <View style={styles.cameraContainer}>
          {device ? (
            <Camera
              style={styles.cameraView}
              device={device}
              isActive={showCamera}
              frameProcessor={frameProcessor}
            />
          ) : (
            <View style={[styles.cameraView, { justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ color: '#fff' }}>Caméra indisponible</Text>
            </View>
          )}
          <View style={styles.cameraOverlayBottom}>
            <View style={[
              styles.mrzFrame,
              camProgress === 'partial' && styles.mrzFramePartial,
              camProgress === 'success' && styles.mrzFrameSuccess,
            ]}>
              <Text style={styles.mrzFrameLine}>P{'<'}XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</Text>
              <Text style={styles.mrzFrameLine}>XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX</Text>
            </View>
            <Text style={styles.cameraStatusLabel}>
              {camProgress === 'scanning' ? 'Cadrez les 2 lignes MRZ...' : camProgress === 'partial' ? 'Détecté — stabilisation...' : '✓ MRZ lu !'}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeCamBtn} onPress={() => setShowCamera(false)}>
            <Text style={styles.closeCamText}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Numéro du passeport</Text>
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

      {renderStrategy(PRODUCTION_STRATEGY)}

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
    probeToggle: {
      marginTop: 8,
      paddingVertical: 6,
      paddingHorizontal: 4,
      alignSelf: 'flex-start',
    },
    probeToggleText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.secondary ?? colors.text,
    },
    strategyRow: { gap: 4 },
    strategyDesc: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 11,
      color: colors.textSecondary,
      paddingHorizontal: 2,
    },
    cameraContainer: {
      width: '100%',
      height: 260,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: '#000',
      position: 'relative',
    },
    cameraView: {
      width: '100%',
      height: '100%',
    },
    cameraOverlayBottom: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 10,
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    mrzFrame: {
      width: '100%',
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.55)',
      borderRadius: 6,
      backgroundColor: 'rgba(0,0,0,0.3)',
      gap: 2,
    },
    mrzFramePartial: { borderColor: '#FBBF24' },
    mrzFrameSuccess: { borderColor: '#10B981', borderWidth: 3 },
    mrzFrameLine: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 7,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      letterSpacing: 0.5,
    },
    cameraStatusLabel: {
      color: '#fff',
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 12,
    },
    closeCamBtn: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 14,
      width: 28,
      height: 28,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeCamText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
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
    photoHint: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 10,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 2,
    },
    dg1Badge: {
      flex: 1,
      justifyContent: 'center',
      paddingLeft: 12,
    },
    dg1BadgeText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 18,
      color: '#10B981',
    },
    photoModalBg: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.96)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    photoModalImg: {
      width: SCREEN_W,
      height: SCREEN_H,
    },
    photoModalClose: {
      position: 'absolute',
      top: 52,
      right: 16,
      backgroundColor: 'rgba(255,255,255,0.25)',
      borderRadius: 22,
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    photoModalCloseText: {
      color: '#fff',
      fontSize: 20,
      fontWeight: '600',
    },
  });
