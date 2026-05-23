/**
 * Dev-mode tool: round-trip passport data <-> JSON.
 *
 * Two modes on one screen:
 *
 *   A. Scan -> JSON   Enter MRZ + doc type, scan NFC, get a hex-encoded
 *                     JSON blob. Copy to clipboard or save to
 *                     documentDirectory/passport.json.
 *
 *   B. Load JSON      Paste a JSON blob from clipboard, or read
 *                     documentDirectory/passport.json. Parses + shows a
 *                     summary so you can confirm the round-trip.
 *
 * JSON shape (canonical, matches what voting-flow.tsx already writes at
 * lines 389-402 AND v1.4 register-replay-test.tsx parsePassportJson):
 *
 *   { docCode, dg1, sod, dg15?, aaSignature?, personDetails }
 *
 * dg1 / sod / dg15 / aaSignature are hex strings (no 0x prefix).
 */

import React, { useRef, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { getRandomValues } from 'expo-crypto';
import { useColors, Typography, Spacing } from '@/constants/theme';
import type { PassportData, PersonDetails } from '@/modules/e-document';
import { serializeRichPassportJson } from '@/utils/passport-rich-json';
import { useNetwork } from '@/contexts/NetworkContext';
import { getDefaultProposalId, getRarimeConfig, getFreedomToolConfig } from '@/constants/rarime-config';
import Step5 from '@/components/voting-modal/Step5';

type DocType = 'P' | 'I';

type ParsedSummary = {
  docCode: string;
  dg1Len: number;
  sodLen: number;
  dg15Len?: number;
  aaSigLen?: number;
  personDetails?: Record<string, unknown>;
};

// Full reconstruction including the raw bytes — needed by the inline
// Register/Vote handlers to build a RarimePassport. The screen keeps both
// `loadedSummary` (for the UI summary card) and `loadedPassport` (for SDK
// calls) in sync.
type ParsedFull = ParsedSummary & {
  passport: PassportData;
};

const hexToBytes = (hex: string | undefined | null): Uint8Array => {
  if (!hex) return new Uint8Array();
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array();
  if (clean.length % 2 !== 0) throw new Error(`hex length not even: ${clean.length}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

// Rich serializer lives in utils/passport-rich-json.ts so the dev tool can
// stay focused on UI. It produces { scannedAt, platform, strategy, docCode,
// personDetails, mrz, personalNumber, dgSizes, dgHex, dg11Parsed, dg12Parsed,
// derived, photoBase64 } — matches the shape the team uses for off-device
// diagnostics. parsePassportJson below still accepts the older minimal
// `{ dg1, sod }` shape (and the nested `.dgHex` variant) for round-trip
// compatibility with v1.4's register-replay-test.tsx output.

const parsePassportJson = (jsonText: string): ParsedFull => {
  const obj = JSON.parse(jsonText) as Record<string, unknown>;
  // Accept both shapes: top-level keys (the canonical shape this tool
  // emits + what voting-flow writes) AND a nested `.dgHex` object (the
  // richer v1.4 register-replay shape).
  const dgHex = (obj.dgHex ?? obj) as Record<string, string | null | undefined>;
  if (!dgHex.dg1 || !dgHex.sod) {
    throw new Error('JSON missing dg1 / sod (looked at top-level and at .dgHex)');
  }
  const dg1 = hexToBytes(dgHex.dg1);
  const sod = hexToBytes(dgHex.sod);
  const dg15 = hexToBytes(dgHex.dg15 ?? undefined);
  const aaSig = hexToBytes(dgHex.aaSignature ?? undefined);
  const dg11 = hexToBytes(dgHex.dg11 ?? undefined);
  const dg12 = hexToBytes(dgHex.dg12 ?? undefined);
  const dg14 = hexToBytes(dgHex.dg14 ?? undefined);
  const docCode = (obj.docCode as string) ?? 'P';
  const personDetails = (obj.personDetails as Record<string, unknown> | undefined) ?? {};
  return {
    docCode,
    dg1Len: dg1.length,
    sodLen: sod.length,
    dg15Len: dg15.length || undefined,
    aaSigLen: aaSig.length || undefined,
    personDetails,
    passport: {
      docCode,
      personDetails: personDetails as any,
      dg1Bytes: dg1,
      sodBytes: sod,
      dg15Bytes: dg15.length ? dg15 : undefined,
      aaSignature: aaSig.length ? aaSig : undefined,
      dg11Bytes: dg11.length ? dg11 : undefined,
      dg12Bytes: dg12.length ? dg12 : undefined,
      dg14Bytes: dg14.length ? dg14 : undefined,
    },
  };
};

export default function PassportJsonTool() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  const [docType, setDocType] = useState<DocType>('P');
  const [documentNumber, setDocumentNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [can, setCan] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const handleMrzCaptured = (data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    setDocumentNumber(data.documentNumber);
    setBirthDate(data.birthDate);
    setExpiryDate(data.expiryDate);
    setCameraOpen(false);
  };

  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [resultJson, setResultJson] = useState<string>('');
  const [resultPersonDetails, setResultPersonDetails] = useState<PersonDetails | null>(null);

  const [loadStatus, setLoadStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedSummary, setLoadedSummary] = useState<ParsedSummary | null>(null);
  // Full bytes-aware parse result. Mirrors `loadedSummary` but adds the
  // PassportData for inline Register / Vote calls. Set together so the UI
  // and the SDK paths stay in sync.
  const [loadedPassport, setLoadedPassport] = useState<PassportData | null>(null);

  // Section C — inline Register + Vote against the Rarime SDK. Step-by-step
  // pattern like v1.4's register-replay-test.tsx: discrete buttons, each
  // with its own status panel. Refs hold the SDK instances so Vote can
  // skip re-init after Register on the same network.
  const { network, setNetwork } = useNetwork();
  const [proposalId, setProposalId] = useState<string>(() => getDefaultProposalId(network));
  const [voteAnswer, setVoteAnswer] = useState<string>('0');

  type SdkStatus = 'idle' | 'running' | 'success' | 'failure';
  const [registerStatus, setRegisterStatus] = useState<SdkStatus>('idle');
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const [registerTx, setRegisterTx] = useState<string | null>(null);
  const [voteStatus, setVoteStatus] = useState<SdkStatus>('idle');
  const [voteMsg, setVoteMsg] = useState<string | null>(null);
  const [voteTx, setVoteTx] = useState<string | null>(null);
  const [proposalStatus, setProposalStatus] = useState<SdkStatus>('idle');
  const [proposalMsg, setProposalMsg] = useState<string | null>(null);
  const [loadedProposal, setLoadedProposal] = useState<any | null>(null);

  const rarimeRef = useRef<any>(null);
  const ftRef = useRef<any>(null);
  const rarimePassportRef = useRef<any>(null);
  const sdkNetworkRef = useRef<string | null>(null);

  // Tagged log buffer — mirrors v1.4 register-replay-test.tsx's `tlog` style.
  // Capped FIFO so the UI panel stays bounded. Also fans out to console.log
  // so logs land in Metro / adb logcat / xcrun simctl streams.
  const [tlogs, setTlogs] = useState<string[]>([]);
  const tlog = (tag: string, msg: string) => {
    const stamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const line = `${stamp} [${tag}] ${msg}`;
    console.log(`[replay] ${line}`);
    setTlogs(prev => {
      const next = [...prev, line];
      return next.length > 50 ? next.slice(-50) : next;
    });
  };
  const clearLogs = () => setTlogs([]);

  // Lazy SDK init. Idempotent per (network, passport) pair: rebuilds the
  // refs when either changes so a network flip or a fresh paste/load gives
  // a clean instance. Mirrors the init in app/voting-flow.tsx so the
  // dev-tool path goes through the same SDK call surface.
  const ensureSdk = async (): Promise<{ rarime: any; ft: any; passport: any }> => {
    if (!loadedPassport) {
      throw new Error('Aucun JSON chargé. Colle un JSON ou lis passport.json d’abord.');
    }
    const docNumber = (loadedPassport.personDetails as any)?.documentNumber ?? `dg1@${loadedPassport.dg1Bytes.length}`;
    const cacheKey = `${network}:${docNumber}`;
    if (rarimeRef.current && ftRef.current && rarimePassportRef.current && sdkNetworkRef.current === cacheKey) {
      tlog('sdk', `réutilisation des instances (${cacheKey})`);
      return { rarime: rarimeRef.current, ft: ftRef.current, passport: rarimePassportRef.current };
    }
    tlog('sdk', `init pour ${network} docNo=${docNumber}`);
    tlog('sdk', `import @rarimo/rarime-rn-sdk…`);
    const { Rarime, FreedomTool, RarimePassport } = await import('@rarimo/rarime-rn-sdk');
    // Bundle the TD3 light + heavy register circuits + TD3 query_identity.
    // Mirrors v1.4-readying-for-production:app/voting-flow.tsx (lines 107–
    // 116). The production voting flow on this branch is TD1-only and so
    // omits these, but TD3 passports need them — the SDK routes through
    // `bundled://<name>` after a successful registerBundledCircuit call,
    // and falls back to a download attempt (which fails on the bundled://
    // scheme) when the name isn't registered. Hash-length suffixes match
    // the SOD digest algorithm (160=SHA-1, 224, 256, 384, 512).
    const bundledCircuits: Array<[string, any]> = [
      ['query_identity_td3',                        require('@/assets/circuits/query_identity_td3.json')],
      ['register_light_td3_160',                    require('@/assets/circuits/register_light_td3_160.json')],
      ['register_light_td3_224',                    require('@/assets/circuits/register_light_td3_224.json')],
      ['register_light_td3_256',                    require('@/assets/circuits/register_light_td3_256.json')],
      ['register_light_td3_384',                    require('@/assets/circuits/register_light_td3_384.json')],
      ['register_light_td3_512',                    require('@/assets/circuits/register_light_td3_512.json')],
      ['registerIdentity_1_256_3_5_576_248_NA',     require('@/assets/circuits/registerIdentity_1_256_3_5_576_248_NA.json')],
    ];
    let registered = 0;
    for (const [name, json] of bundledCircuits) {
      try {
        (Rarime as any).registerBundledCircuit(name, json);
        registered++;
      } catch (e: any) {
        // Re-registering on a fresh SDK version throws; benign — the
        // circuit is already in the registry from a previous init.
        tlog('sdk', `${name}: déjà enregistré (${e?.message ?? e})`);
      }
    }
    tlog('sdk', `circuits enregistrés: ${registered}/${bundledCircuits.length}`);
    // Resolve the per-passport BJJ key (also mirrors to the legacy single
    // slot the SDK reads via getOrCreatePrivateKey, but we pass the key
    // explicitly here anyway).
    tlog('sdk', 'résolution de la clé BJJ par passeport…');
    const { getOrCreateKeyForPassport } = await import('@/utils/identity');
    const keyResolved = await getOrCreateKeyForPassport({
      dg1: loadedPassport.dg1Bytes,
      sod: loadedPassport.sodBytes,
      label: (loadedPassport.personDetails as any)?.documentNumber,
    });
    tlog(
      'sdk',
      `clé BJJ: hash=${keyResolved.passportHash.slice(0, 12)}… sk=${keyResolved.privateKey.slice(0, 8)}… ` +
      `isNew=${keyResolved.isNew}`,
    );
    const rarimeCfg = getRarimeConfig(network);
    const ftCfg = getFreedomToolConfig(network);
    tlog('sdk', `RPC: ${rarimeCfg.apiConfiguration.jsonRpcEvmUrl}`);
    tlog('sdk', `relayer: ${rarimeCfg.apiConfiguration.rarimeApiUrl}`);
    const rarime = new (Rarime as any)({
      ...rarimeCfg,
      userConfiguration: { userPrivateKey: keyResolved.privateKey },
    });
    const ft = new (FreedomTool as any)(ftCfg);
    const passport = new (RarimePassport as any)({
      dataGroup1: loadedPassport.dg1Bytes,
      sod: loadedPassport.sodBytes,
    });
    tlog(
      'sdk',
      `Rarime+FT prêts. passport.dg1=${loadedPassport.dg1Bytes.length}B sod=${loadedPassport.sodBytes.length}B`,
    );
    rarimeRef.current = rarime;
    ftRef.current = ft;
    rarimePassportRef.current = passport;
    sdkNetworkRef.current = cacheKey;
    return { rarime, ft, passport };
  };

  const handleRegister = async () => {
    setRegisterStatus('running');
    setRegisterMsg('Initialisation du SDK…');
    setRegisterTx(null);
    tlog('register', `démarrage sur ${network}`);
    const t0 = Date.now();
    try {
      const { rarime, passport } = await ensureSdk();
      tlog('register', 'appel rarime.registerIdentity(passport)…');
      setRegisterMsg(`Soumission registerIdentity (${network})…`);
      const result: any = await rarime.registerIdentity(passport);
      const ms = Date.now() - t0;
      const tx = typeof result === 'string'
        ? result
        : (result?.txHash ?? result?.transactionHash ?? null);
      tlog('register', `OK en ${(ms / 1000).toFixed(1)} s${tx ? ` tx=${tx}` : ''}`);
      setRegisterStatus('success');
      setRegisterMsg(`Register OK en ${(ms / 1000).toFixed(1)} s`);
      setRegisterTx(tx);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      tlog('register', `ÉCHEC en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${msg}`);
      setRegisterStatus('failure');
      setRegisterMsg(msg);
    }
  };

  const handleLoadProposal = async () => {
    setProposalStatus('running');
    setProposalMsg(`Chargement scrutin #${proposalId}…`);
    setLoadedProposal(null);
    tlog('proposal', `getProposalInfo(${proposalId}) sur ${network}`);
    const t0 = Date.now();
    try {
      const { ft } = await ensureSdk();
      const info = await ft.getProposalInfo(proposalId);
      const ms = Date.now() - t0;
      tlog(
        'proposal',
        `OK en ${(ms / 1000).toFixed(1)} s: "${info?.title ?? '?'}" ` +
        `cw=[${(info?.criteria?.citizenshipWhitelist ?? []).map((b: any) => String(b)).join(',')}] ` +
        `selector=${info?.criteria?.selector ?? '?'}`,
      );
      setLoadedProposal(info);
      setProposalStatus('success');
      setProposalMsg(`Scrutin chargé en ${(ms / 1000).toFixed(1)} s`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      tlog('proposal', `ÉCHEC en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${msg}`);
      setProposalStatus('failure');
      setProposalMsg(msg);
    }
  };

  const handleVote = async () => {
    setVoteStatus('running');
    setVoteMsg('Initialisation du SDK…');
    setVoteTx(null);
    const answerIdx = Math.max(0, parseInt(voteAnswer, 10) || 0);
    tlog('vote', `démarrage sur ${network} proposal=#${proposalId} answer=${answerIdx}`);
    const t0 = Date.now();
    try {
      const { rarime, ft, passport } = await ensureSdk();
      tlog('vote', `chargement getProposalInfo(${proposalId})…`);
      setVoteMsg(`Chargement scrutin #${proposalId}…`);
      const proposalInfo = await ft.getProposalInfo(proposalId);
      tlog('vote', `proposal chargée: "${proposalInfo?.title ?? '?'}"`);
      setVoteMsg(`Soumission du vote (réponse ${answerIdx})…`);
      tlog('vote', 'appel ft.submitProposal(...) — ~3-5 min sur preuve lourde');
      const tx: any = await ft.submitProposal({
        answers: [answerIdx],
        proposalInfo,
        rarime,
        passport,
      });
      const ms = Date.now() - t0;
      const txHash = typeof tx === 'string' ? tx : (tx?.txHash ?? tx?.transactionHash ?? null);
      tlog('vote', `OK en ${(ms / 1000).toFixed(1)} s${txHash ? ` tx=${txHash}` : ''}`);
      setVoteStatus('success');
      setVoteMsg(`Vote OK en ${(ms / 1000).toFixed(1)} s`);
      setVoteTx(txHash);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      tlog('vote', `ÉCHEC en ${((Date.now() - t0) / 1000).toFixed(1)} s: ${msg}`);
      setVoteStatus('failure');
      setVoteMsg(msg);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    setScanStatus('Initialisation NFC...');
    setScanError(null);
    setResultJson('');
    setResultPersonDetails(null);
    try {
      const eDocModule = await import('@/modules/e-document');
      const { scanDocument } = eDocModule;
      const challenge = getRandomValues(new Uint8Array(32));

      setScanStatus(docType === 'P' ? 'Tenez le passeport contre l’appareil...' : 'Tenez la carte contre l’appareil...');
      const data: PassportData = await scanDocument(
        docType,
        {
          documentNumber: documentNumber.trim(),
          dateOfBirth: birthDate.trim(),
          dateOfExpiry: expiryDate.trim(),
          can: can.trim() || undefined,
        },
        challenge,
      );
      setScanStatus('Scan réussi.');
      setResultPersonDetails(data.personDetails);
      setResultJson(serializeRichPassportJson(data));
    } catch (err: any) {
      setScanStatus(null);
      setScanError(err?.message ?? String(err));
    } finally {
      setScanning(false);
    }
  };

  const handleCopyJson = async () => {
    if (!resultJson) return;
    await Clipboard.setStringAsync(resultJson);
    Alert.alert('Copié', 'JSON copié dans le presse-papier.');
  };

  const handleSaveJson = async () => {
    if (!resultJson) return;
    try {
      const FS = await import('expo-file-system/legacy');
      const path = (FS.documentDirectory ?? '') + 'passport.json';
      await FS.writeAsStringAsync(path, resultJson);
      Alert.alert('Sauvegardé', `Écrit dans:\n${path}`);
    } catch (err: any) {
      Alert.alert('Échec sauvegarde', err?.message ?? String(err));
    }
  };

  const handlePasteJson = async () => {
    setLoadStatus(null);
    setLoadError(null);
    setLoadedSummary(null);
    setLoadedPassport(null);
    // Reset SDK caches so a new JSON forces a fresh init.
    rarimeRef.current = null; ftRef.current = null; rarimePassportRef.current = null;
    sdkNetworkRef.current = null;
    setRegisterStatus('idle'); setRegisterMsg(null); setRegisterTx(null);
    setVoteStatus('idle'); setVoteMsg(null); setVoteTx(null);
    setProposalStatus('idle'); setProposalMsg(null); setLoadedProposal(null);
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || text.length < 10) throw new Error('Presse-papier vide ou trop court');
      const parsed = parsePassportJson(text);
      setLoadStatus(`Collé (${text.length} caractères), parse OK.`);
      setLoadedSummary(parsed);
      setLoadedPassport(parsed.passport);
    } catch (err: any) {
      setLoadError(err?.message ?? String(err));
    }
  };

  const handleLoadFile = async () => {
    setLoadStatus(null);
    setLoadError(null);
    setLoadedSummary(null);
    setLoadedPassport(null);
    rarimeRef.current = null; ftRef.current = null; rarimePassportRef.current = null;
    sdkNetworkRef.current = null;
    setRegisterStatus('idle'); setRegisterMsg(null); setRegisterTx(null);
    setVoteStatus('idle'); setVoteMsg(null); setVoteTx(null);
    setProposalStatus('idle'); setProposalMsg(null); setLoadedProposal(null);
    try {
      const FS = await import('expo-file-system/legacy');
      const path = (FS.documentDirectory ?? '') + 'passport.json';
      const text = await FS.readAsStringAsync(path);
      const parsed = parsePassportJson(text);
      setLoadStatus(`Lu depuis ${path}, parse OK.`);
      setLoadedSummary(parsed);
      setLoadedPassport(parsed.passport);
    } catch (err: any) {
      setLoadError(err?.message ?? String(err));
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Section A — Scan → JSON */}
      <Text style={styles.sectionTitle}>1. Scanner et exporter en JSON</Text>
      <Text style={styles.help}>
        Saisis les champs MRZ (BAC), choisis le type de document, puis scanne.
        Le résultat apparaît en JSON ci-dessous — copie-le ou écris-le
        dans passport.json pour le recharger plus tard.
      </Text>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.toggleBtn, docType === 'P' && styles.toggleBtnActive]}
          onPress={() => setDocType('P')}
        >
          <Text style={[styles.toggleText, docType === 'P' && styles.toggleTextActive]}>Passeport (P)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, docType === 'I' && styles.toggleBtnActive]}
          onPress={() => setDocType('I')}
        >
          <Text style={[styles.toggleText, docType === 'I' && styles.toggleTextActive]}>Carte ID (I)</Text>
        </TouchableOpacity>
      </View>

      {/* Camera MRZ scan — reuses Step5 from the voting flow. Toggle to
          mount the camera; on a successful scan the MRZ fields below are
          populated and the camera is unmounted. Step5 reads `docType` via
          the `isPassportFlow` prop so the reticle + extractor matches. */}
      <TouchableOpacity
        style={[styles.secondaryBtn, { marginTop: 4 }]}
        onPress={() => setCameraOpen(open => !open)}
      >
        <Text style={styles.secondaryBtnText}>
          {cameraOpen ? 'Fermer la caméra' : 'Scanner MRZ avec caméra'}
        </Text>
      </TouchableOpacity>

      {cameraOpen && (
        <View style={styles.cameraBox}>
          <Step5
            containerWidth={Dimensions.get('window').width - Spacing.screen.horizontal * 2}
            isActive={cameraOpen}
            onMRZScanned={handleMrzCaptured}
            onManualFill={() => setCameraOpen(false)}
            isPassportFlow={docType === 'P'}
          />
        </View>
      )}

      <LabeledInput label="Numéro de document" value={documentNumber} onChangeText={setDocumentNumber} autoCapitalize="characters" />
      <LabeledInput label="Date de naissance (YYMMDD)" value={birthDate} onChangeText={setBirthDate} keyboardType="number-pad" maxLength={6} />
      <LabeledInput label="Date d’expiration (YYMMDD)" value={expiryDate} onChangeText={setExpiryDate} keyboardType="number-pad" maxLength={6} />
      {docType === 'I' && (
        <LabeledInput label="CAN (optionnel, carte ID)" value={can} onChangeText={setCan} keyboardType="number-pad" />
      )}

      <TouchableOpacity
        style={[styles.primaryBtn, scanning && styles.primaryBtnDisabled]}
        onPress={handleScan}
        disabled={scanning}
      >
        {scanning ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryBtnText}>Scanner NFC</Text>
        )}
      </TouchableOpacity>

      {scanStatus && <Text style={styles.statusText}>{scanStatus}</Text>}
      {scanError && <Text style={styles.errorText}>{scanError}</Text>}

      {resultPersonDetails && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Détails personnels</Text>
          <Text style={styles.summaryLine}>Nom: {resultPersonDetails.lastName ?? '?'}</Text>
          <Text style={styles.summaryLine}>Prénom: {resultPersonDetails.firstName ?? '?'}</Text>
          <Text style={styles.summaryLine}>Nationalité: {resultPersonDetails.nationality ?? '?'}</Text>
          <Text style={styles.summaryLine}>N° doc: {resultPersonDetails.documentNumber ?? '?'}</Text>
        </View>
      )}

      {resultJson.length > 0 && (
        <>
          <Text style={styles.jsonLabel}>JSON ({resultJson.length} caractères)</Text>
          <TextInput
            style={styles.jsonBox}
            value={resultJson}
            multiline
            editable={false}
            scrollEnabled
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleCopyJson}>
              <Text style={styles.secondaryBtnText}>Copier JSON</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleSaveJson}>
              <Text style={styles.secondaryBtnText}>Sauvegarder fichier</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <View style={styles.divider} />

      {/* Section B — Charger un JSON et voter (paste + load + replay) */}
      <Text style={styles.sectionTitle}>2. Coller un JSON et voter</Text>
      <Text style={styles.help}>
        Colle un JSON depuis le presse-papier (ou lis passport.json sur
        disque), choisis le réseau et l’ID de scrutin, puis « Voter ». Le
        flux saute le scan MRZ + NFC et démarre directement à l’étape 7
        (Verify/register → vote → résultat).
      </Text>

      {/* 2a — paste / load */}
      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handlePasteJson}>
          <Text style={styles.secondaryBtnText}>Coller (presse-papier)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleLoadFile}>
          <Text style={styles.secondaryBtnText}>Lire passport.json</Text>
        </TouchableOpacity>
      </View>

      {loadStatus && <Text style={styles.statusText}>{loadStatus}</Text>}
      {loadError && <Text style={styles.errorText}>{loadError}</Text>}

      {loadedSummary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Résumé du JSON</Text>
          <Text style={styles.summaryLine}>docCode: {loadedSummary.docCode}</Text>
          <Text style={styles.summaryLine}>dg1: {loadedSummary.dg1Len} octets</Text>
          <Text style={styles.summaryLine}>sod: {loadedSummary.sodLen} octets</Text>
          {loadedSummary.dg15Len ? <Text style={styles.summaryLine}>dg15: {loadedSummary.dg15Len} octets</Text> : null}
          {loadedSummary.aaSigLen ? <Text style={styles.summaryLine}>aaSignature: {loadedSummary.aaSigLen} octets</Text> : null}
          {loadedSummary.personDetails && (
            <Text style={styles.summaryLine}>personDetails: {Object.keys(loadedSummary.personDetails).length} clés</Text>
          )}
        </View>
      )}

      {/* 2b — Réseau, puis Register et Vote en boutons séparés (style
          v1.4 register-replay-test.tsx). Chaque action a son propre
          panneau de statut. */}
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.toggleBtn, network === 'testnet' && styles.toggleBtnActive]}
          onPress={() => {
            setNetwork('testnet');
            setProposalId(getDefaultProposalId('testnet'));
            rarimeRef.current = null; ftRef.current = null; rarimePassportRef.current = null;
            sdkNetworkRef.current = null;
            setRegisterStatus('idle'); setRegisterMsg(null); setRegisterTx(null);
            setVoteStatus('idle'); setVoteMsg(null); setVoteTx(null);
          }}
        >
          <Text style={[styles.toggleText, network === 'testnet' && styles.toggleTextActive]}>Testnet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, network === 'mainnet' && styles.toggleBtnActive]}
          onPress={() => {
            setNetwork('mainnet');
            setProposalId(getDefaultProposalId('mainnet'));
            rarimeRef.current = null; ftRef.current = null; rarimePassportRef.current = null;
            sdkNetworkRef.current = null;
            setRegisterStatus('idle'); setRegisterMsg(null); setRegisterTx(null);
            setVoteStatus('idle'); setVoteMsg(null); setVoteTx(null);
          }}
        >
          <Text style={[styles.toggleText, network === 'mainnet' && styles.toggleTextActive]}>Mainnet</Text>
        </TouchableOpacity>
      </View>

      {/* ---- Register ------------------------------------------------ */}
      <Text style={styles.subSectionTitle}>2a. Register</Text>
      <TouchableOpacity
        style={[
          styles.primaryBtn,
          (registerStatus === 'running' || !loadedPassport) && styles.primaryBtnDisabled,
        ]}
        onPress={handleRegister}
        disabled={registerStatus === 'running' || !loadedPassport}
      >
        {registerStatus === 'running' ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryBtnText}>Register</Text>
        )}
      </TouchableOpacity>

      {registerMsg && (
        <Text style={registerStatus === 'failure' ? styles.errorText : styles.statusText}>
          {registerMsg}
        </Text>
      )}
      {registerTx && (
        <Text style={styles.summaryLine} selectable>Tx: {registerTx}</Text>
      )}

      {/* ---- Vote ---------------------------------------------------- */}
      <Text style={styles.subSectionTitle}>2b. Vote</Text>
      <LabeledInput
        label="Proposal ID"
        value={proposalId}
        onChangeText={setProposalId}
        keyboardType="number-pad"
      />

      {/* Load proposal — separate step so the user can inspect the on-chain
          scrutin before committing to a vote (saves the ~3-5 min proof gen
          if the proposal ID is wrong or the citizenship whitelist excludes
          this passport). */}
      <TouchableOpacity
        style={[
          styles.secondaryBtn,
          (proposalStatus === 'running' || !loadedPassport) && styles.primaryBtnDisabled,
        ]}
        onPress={handleLoadProposal}
        disabled={proposalStatus === 'running' || !loadedPassport}
      >
        {proposalStatus === 'running' ? (
          <ActivityIndicator color={colors.secondary} />
        ) : (
          <Text style={styles.secondaryBtnText}>Charger scrutin</Text>
        )}
      </TouchableOpacity>

      {proposalMsg && (
        <Text style={proposalStatus === 'failure' ? styles.errorText : styles.statusText}>
          {proposalMsg}
        </Text>
      )}
      {loadedProposal && (
        <>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Scrutin #{String(loadedProposal.id ?? proposalId)}</Text>
            <Text style={styles.summaryLine}>Titre: {loadedProposal.title ?? '?'}</Text>
            {loadedProposal.description && (
              <Text style={styles.summaryLine}>Description: {String(loadedProposal.description).slice(0, 140)}{String(loadedProposal.description).length > 140 ? '…' : ''}</Text>
            )}
            <Text style={styles.summaryLine}>
              Citizenship whitelist: {(loadedProposal.criteria?.citizenshipWhitelist ?? []).map((b: any) => String(b)).join(', ') || '(toutes)'}
            </Text>
            {loadedProposal.criteria?.selector !== undefined && (
              <Text style={styles.summaryLine}>Selector: {String(loadedProposal.criteria.selector)}</Text>
            )}
            {loadedProposal.sendVoteContractAddress && (
              <Text style={styles.summaryLine} selectable>Send-vote contract: {String(loadedProposal.sendVoteContractAddress)}</Text>
            )}
            {loadedProposal.acceptedOptions && (
              <Text style={styles.summaryLine}>Options acceptées: {String(loadedProposal.acceptedOptions)}</Text>
            )}
          </View>
          <Text style={styles.jsonLabel}>Réponse complète</Text>
          <TextInput
            style={styles.jsonBox}
            value={JSON.stringify(
              loadedProposal,
              (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
              2,
            )}
            multiline
            editable={false}
            scrollEnabled
            selectTextOnFocus
          />
        </>
      )}

      <LabeledInput
        label="Réponse (index, 0 par défaut)"
        value={voteAnswer}
        onChangeText={setVoteAnswer}
        keyboardType="number-pad"
        maxLength={3}
      />
      <TouchableOpacity
        style={[
          styles.primaryBtn,
          (voteStatus === 'running' || !loadedPassport) && styles.primaryBtnDisabled,
        ]}
        onPress={handleVote}
        disabled={voteStatus === 'running' || !loadedPassport}
      >
        {voteStatus === 'running' ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryBtnText}>Voter</Text>
        )}
      </TouchableOpacity>

      {voteMsg && (
        <Text style={voteStatus === 'failure' ? styles.errorText : styles.statusText}>
          {voteMsg}
        </Text>
      )}
      {voteTx && (
        <Text style={styles.summaryLine} selectable>Tx: {voteTx}</Text>
      )}

      {/* ---- Logs (mirrors v1.4 tlog pattern) ----------------------- */}
      {tlogs.length > 0 && (
        <>
          <View style={styles.logHeaderRow}>
            <Text style={styles.subSectionTitle}>Journal ({tlogs.length})</Text>
            <TouchableOpacity onPress={clearLogs}>
              <Text style={styles.clearLogText}>Effacer</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.logBox}
            value={tlogs.join('\n')}
            multiline
            editable={false}
            scrollEnabled
          />
        </>
      )}
    </ScrollView>
  );
}

function LabeledInput(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        {...props}
        style={styles.input}
        placeholderTextColor={colors.text + '66'}
        autoCorrect={false}
      />
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.screen.horizontal,
      gap: 12,
    },
    sectionTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.h1,
      color: colors.text,
      marginTop: 8,
    },
    subSectionTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.text,
      marginTop: 16,
      marginBottom: 4,
    },
    logHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 16,
    },
    clearLogText: {
      color: colors.secondary,
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
    },
    logBox: {
      borderWidth: 1,
      borderColor: colors.border ?? colors.secondary,
      borderRadius: 8,
      padding: 10,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10,
      lineHeight: 14,
      color: colors.text,
      backgroundColor: colors.cardBackground,
      minHeight: 120,
      maxHeight: 240,
      textAlignVertical: 'top',
    },
    help: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      opacity: 0.7,
      marginBottom: 4,
    },
    row: {
      flexDirection: 'row',
      gap: 12,
    },
    cameraBox: {
      // Don't constrain height — Step5 renders its own ~440pt-tall stack
      // (title + 282pt camera surface + paddings). A fixed height with
      // overflow: hidden was clipping the bottom of the camera preview so
      // the user couldn't see the full passport against the reticle.
      // No backgroundColor here either — Step5's step5Container paints
      // colors.cardBackground itself.
      marginVertical: 4,
    },
    toggleBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border ?? colors.secondary,
      alignItems: 'center',
      backgroundColor: colors.cardBackground,
    },
    toggleBtnActive: {
      backgroundColor: colors.secondary,
      borderColor: colors.secondary,
    },
    toggleText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.body,
      color: colors.text,
    },
    toggleTextActive: {
      color: 'white',
    },
    field: {
      gap: 4,
    },
    fieldLabel: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      opacity: 0.7,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border ?? colors.secondary,
      borderRadius: 8,
      padding: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: Typography.fontSize.body,
      color: colors.text,
      backgroundColor: colors.cardBackground,
    },
    primaryBtn: {
      backgroundColor: colors.secondary,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 8,
    },
    primaryBtnDisabled: {
      opacity: 0.6,
    },
    primaryBtnText: {
      color: 'white',
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
    },
    secondaryBtn: {
      flex: 1,
      backgroundColor: colors.cardBackground,
      borderWidth: 1,
      borderColor: colors.secondary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    secondaryBtnText: {
      color: colors.secondary,
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.body,
    },
    statusText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
    },
    errorText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: '#D32F2F',
    },
    summaryCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 8,
      padding: 12,
      gap: 4,
    },
    summaryTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.text,
      marginBottom: 4,
    },
    summaryLine: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
    },
    jsonLabel: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      opacity: 0.7,
    },
    jsonBox: {
      borderWidth: 1,
      borderColor: colors.border ?? colors.secondary,
      borderRadius: 8,
      padding: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: colors.text,
      backgroundColor: colors.cardBackground,
      minHeight: 160,
      maxHeight: 280,
      textAlignVertical: 'top',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border ?? colors.secondary,
      opacity: 0.3,
      marginVertical: 16,
    },
  });
