import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions, TouchableOpacity, ScrollView, StatusBar, Platform } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import type { Rarime, RarimePassport, FreedomTool, ProposalInfo } from '@rarimo/rarime-rn-sdk';
import {
  getRarimeConfig,
  getFreedomToolConfig,
  getDefaultProposalId,
  withRetry,
  formatRpcError,
} from '@/constants/rarime-config';
import { useNetwork } from '@/contexts/NetworkContext';
import { assertOnChainConstants } from '@/utils/register-via-noir';
import { getOrCreatePrivateKey } from '@/utils/identity';
import { findCachedProposal } from '@/utils/proposal-cache';
import { isPassportVotingTarget } from '@/utils/voteResults';
import { useTranslation } from 'react-i18next';
import type { PassportData } from '@/modules/e-document';

// Import all steps
import Step1 from '@/components/voting-modal/Step1';
import Step2 from '@/components/voting-modal/Step2';
import Step3 from '@/components/voting-modal/Step3';
import Step4 from '@/components/voting-modal/Step4';
import Step5 from '@/components/voting-modal/Step5';
import Step6 from '@/components/voting-modal/Step6';
import Step7 from '@/components/voting-modal/Step7';
import Step8 from '@/components/voting-modal/Step8';
import Step9Error from '@/components/voting-modal/Step9Error';
import Step9Vote from '@/components/voting-modal/Step9Vote';
import Step10 from '@/components/voting-modal/Step10';
import Step11 from '@/components/voting-modal/Step11';
import Step12Success from '@/components/voting-modal/Step12Success';
import Step12Error from '@/components/voting-modal/Step12Error';
import ManualMRZInput from '@/components/voting-modal/ManualMRZInput';
import { createModalStyles } from '@/components/voting-modal/styles';
import { useModalVideoPlayers } from '@/hooks/useModalVideoPlayers';


export default function VotingFlowScreen() {
  const { proposalId: proposalIdParam, isPassport: isPassportParam } = useLocalSearchParams<{ proposalId?: string; isPassport?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const { network } = useNetwork();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<'success' | 'error' | null>(null);
  const [voteSubmissionResult, setVoteSubmissionResult] = useState<'success' | 'error' | null>(null);
  const [mrzData, setMRZData] = useState<{ documentNumber: string; birthDate: string; expiryDate: string } | null>(null);
  const [nfcData, setNFCData] = useState<PassportData | null>(null);
  // Flips true ONLY after `handleNFCSuccess`'s async block has resolved the
  // per-passport BJJ key and synced it into the legacy SecureStore slot.
  // The Rarime init `useEffect` below gates on this so it never reads a
  // stale legacy key while `getOrCreateKeyForPassport` is mid-flight —
  // without this gate, `getDocumentStatus` racing the per-passport key
  // write returns the wrong profileKey and reports `REGISTERED_WITH_OTHER_PK`.
  const [passportKeyReady, setPassportKeyReady] = useState(false);
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);
  const [selectedVote, setSelectedVote] = useState<number>(0);

  // Rarime / FreedomTool state
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [proposalInfo, setProposalInfo] = useState<ProposalInfo | null>(null);

  // The MRZ mask (Step 5) + NFC mode (Step 6) need to know whether the
  // active proposal targets passport (TD3) or ID card (TD1) BEFORE the
  // full proposalInfo lands. The home screen passes `?isPassport=0|1` in
  // the URL — that's the most reliable signal because it captures what
  // the user saw when they tapped. Fall back to proposalInfo (once
  // hydrated from cache or RPC) if the param is absent (e.g. deep link).
  const isPassportFlow = useMemo<boolean>(() => {
    if (isPassportParam === '1') return true;
    if (isPassportParam === '0') return false;
    return proposalInfo ? isPassportVotingTarget(proposalInfo) : false;
  }, [isPassportParam, proposalInfo]);
  const rarimeRef = useRef<Rarime | null>(null);
  const freedomToolRef = useRef<FreedomTool | null>(null);
  const passportRef = useRef<RarimePassport | null>(null);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  const { players, handleStepChange, pauseAll } = useModalVideoPlayers();
  const { player1, player2, player3, player4, player5 } = players;

  // If the user switches network from Settings while the voting-flow screen
  // is still mounted (rare — would require backing out to Settings and back),
  // wipe the SDK refs so the next entry into Step 7 re-creates them against
  // the new addresses. Without this we'd keep talking to testnet contracts
  // even though the user flipped to Mainnet.
  useEffect(() => {
    rarimeRef.current = null;
    freedomToolRef.current = null;
    setProposalInfo(null);
    // Force re-gating on the next NFC scan — without this, flipping
    // networks mid-flow would let the init useEffect run immediately
    // with stale `passportKeyReady=true`.
    setPassportKeyReady(false);
  }, [network]);

  // Early cache-only hydration: the heavy init effect below is deferred
  // until after Step 6 (NFC), but Step 5's MRZ reticle needs to know the
  // doc type (passport vs ID card) which is derived from the proposal's
  // `sendVoteContractAddress`. Look up the proposal from the home-screen
  // cache on mount so we can set the right mask before the user even gets
  // to Step 5. No network call, no SDK init — just a synchronous-ish
  // lookup against the cache the home tab populated. On cache miss we
  // stay null and the mask defaults to TD1 (the more common path).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const targetProposalId = proposalIdParam || getDefaultProposalId(network);
      const cached = await findCachedProposal(network, targetProposalId);
      if (cancelled) return;
      if (cached) {
        console.log(
          `[voting-flow] proposal hydrated from cache early: #${targetProposalId} sendVoteContract=${cached.sendVoteContractAddress}`,
        );
        setProposalInfo(cached);
      }
    })();
    return () => { cancelled = true; };
  }, [proposalIdParam, network]);

  // Init Rarime + FreedomTool + load proposal. Deferred until after the NFC
  // scan (Step 6) so that Rarime's native Rust/ZK warmup doesn't contend with
  // IsoDep during PACE. Step 7 reads rarimeRef.current defensively and will
  // wait for init to complete.
  useEffect(() => {
    if (currentStep < 7) return;
    // Wait for handleNFCSuccess's async block to finish writing the
    // per-passport BJJ key into the legacy SecureStore slot. Without this
    // gate, the line below that calls `getOrCreatePrivateKey()` can read
    // the *previous* scan's key (or the migration-era legacy key on a
    // clean install), construct Rarime against the wrong identity, and
    // the on-chain `activeIdentity` check then reports REGISTERED_WITH_OTHER_PK.
    if (!passportKeyReady) return;
    if (rarimeRef.current) return; // already initialised
    (async () => {
      try {
        // Catch regressions in the keccak dispatch strings used by the
        // registerViaNoir path. Cheap (~µs) and fails loud, before any
        // network calls happen. See utils/register-via-noir.ts.
        try { assertOnChainConstants(); } catch (e) { console.error('[voting-flow]', e); }

        const { Rarime: RarimeClass, FreedomTool: FT, RarimeUtils } =
          await import('@rarimo/rarime-rn-sdk');

        // The voting flow is now TD1 (French ID card) only. The TD1 light
        // + query_identity circuits are published on Rarimo's GCS bucket
        // and the SDK fetches them from there on first use — no local
        // bundle registration needed.
        //
        // The TD3 (passport) circuit JSONs are still in assets/circuits/
        // and are still used by the diagnostic / QA screens that exercise
        // passport flows out-of-band, but the production voting path
        // doesn't register them.
        //
        // Heavy register circuit — used by the Mainnet registerViaNoir
        // path (utils/register-via-noir.ts). 3 MB of Noir bytecode bundled
        // in-app so registration works offline. Same circuit name for both
        // TD1 and TD3 (the circuit doesn't care about MRZ format).
        RarimeClass.registerBundledCircuit('registerIdentity_1_256_3_5_576_248_NA', require('@/assets/circuits/registerIdentity_1_256_3_5_576_248_NA.json'));
        console.log('[FreedomTool] Heavy register circuit bundled; TD1 light + query come from CDN.');

        const storedKey = await getOrCreatePrivateKey();
        setPrivateKey(storedKey);

        // Dump the BJJ keypair so the user can preserve it if registration
        // eventually succeeds (private key lives only in SecureStore — wiping
        // the app loses on-chain identity).
        //
        // SECURITY: gated behind __DEV__ so release builds never log the
        // user's BJJ private key. The per-passport DB + key-management UI
        // (app/key-management.tsx) is the supported backup path for users
        // — the logcat dump is purely a developer convenience for QA.
        if (__DEV__) {
          try {
            const { babyJub } = await import('@iden3/js-crypto');
            const pubPoint = babyJub.mulPointEScalar(babyJub.Base8, BigInt('0x' + storedKey));
            const pubX = pubPoint[0].toString(16).padStart(64, '0');
            const pubY = pubPoint[1].toString(16).padStart(64, '0');
            const profileKey = RarimeUtils.getProfileKey(storedKey);
            console.log('[FreedomTool][KEYPAIR] ===== BJJ KEYPAIR (save if reg succeeds) =====');
            console.log('[FreedomTool][KEYPAIR] privateKey: 0x' + storedKey);
            console.log('[FreedomTool][KEYPAIR] pubPoint.x: 0x' + pubX);
            console.log('[FreedomTool][KEYPAIR] pubPoint.y: 0x' + pubY);
            console.log('[FreedomTool][KEYPAIR] profileKey: 0x' + profileKey);
            console.log('[FreedomTool][KEYPAIR] ===== END KEYPAIR =====');
          } catch (e: any) {
            console.error('[FreedomTool][KEYPAIR] dump failed:', e?.message ?? e);
          }
        }

        // Pick the right contract / RPC bundle for the currently-active
        // network. The whole Rarime + FreedomTool pair has to share a network
        // (mixing them would point getDocumentStatus and getProposalInfo at
        // different chains and silently break vote-eligibility checks).
        console.log(`[FreedomTool] Initialising for network=${network}`);
        const rarimeCfg = getRarimeConfig(network);
        const ftCfg = getFreedomToolConfig(network);

        const rarime = new RarimeClass({
          ...rarimeCfg,
          userConfiguration: { userPrivateKey: storedKey },
        });
        rarimeRef.current = rarime;

        const ft = new FT(ftCfg);
        freedomToolRef.current = ft;

        const targetProposalId = proposalIdParam || getDefaultProposalId(network);

        // Cache-first: the home screen already fetched & cached this
        // proposal. Using it here cuts ~2–3 s off the post-NFC wait (that's
        // the getProposalInfo() roundtrip blocking Step 7 verification).
        const cached = await findCachedProposal(network, targetProposalId);
        if (cached) {
          console.log('[FreedomTool] Proposal loaded from cache:', cached.title);
          setProposalInfo(cached);
          // Refresh in the background in case votes/timestamps moved on;
          // the cache entry remains usable for the current voting flow.
          ft.getProposalInfo(targetProposalId)
            .then((fresh: ProposalInfo) => { setProposalInfo(fresh); })
            .catch((e: any) => {
              console.warn('[FreedomTool] background refresh failed:', e?.message);
            });
        } else {
          console.log('[FreedomTool] Loading proposal', targetProposalId);
          const info = await withRetry(
            () => ft.getProposalInfo(targetProposalId),
            { label: 'getProposalInfo' }
          );
          console.log('[FreedomTool] Proposal loaded:', info.title);
          setProposalInfo(info);
        }
      } catch (err) {
        console.error('[FreedomTool] Init error:', err);
      }
    })();
  }, [currentStep, proposalIdParam, network, passportKeyReady]);

  // Reset state when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Reset to step 1 when screen is focused
      setCurrentStep(1);
      setVerificationResult(null);
      setVoteSubmissionResult(null);
      setMRZData(null);
      setNFCData(null);
      // Critical: clear the manual-input modal flag too. If the user backed
      // out of the flow while the modal was open, this would otherwise stay
      // `true` and keep Step 5's camera disabled on re-entry (Step 5's
      // isActive is gated on `!isManualInputVisible`).
      setIsManualInputVisible(false);
      // Re-arm the per-passport key gate so the init useEffect waits for
      // the next NFC scan + DB lookup before constructing Rarime.
      setPassportKeyReady(false);

      // Reset animations
      slideAnim.setValue(0);
      progressOpacity1.setValue(1);
      progressOpacity2.setValue(0.25);
      progressOpacity3.setValue(0.25);

      return () => {
        // Cleanup when screen loses focus
        pauseAll();
      };
    }, [pauseAll, slideAnim, progressOpacity1, progressOpacity2, progressOpacity3])
  );

  // Keep the JS thread idle while the NFC scan runs on Step 6. Reader mode on
  // Android dispatches APDUs on a background thread, but sendEvent() bubbles
  // back to JS — heavy renders here back up the bridge and can starve the
  // IsoDep session on the very first APDU.
  useEffect(() => {
    if (Platform.OS === 'android' && currentStep === 6) {
      pauseAll();
    }
  }, [currentStep, pauseAll]);

  const handleNext = useCallback(() => {
    const newStep = currentStep + 1;
    setCurrentStep(newStep);

    Animated.timing(slideAnim, {
      toValue: -(newStep - 1) * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    handleStepChange(newStep);

    // Light the Nth bar when entering step N. Bar 1 is already lit at init
    // (so step 1 → 1 bar, step 2 → 2 bars, step 3 → 3 bars). Step 4 hides the
    // nav entirely, so nothing to animate there.
    if (newStep === 2) {
      Animated.timing(progressOpacity2, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (newStep === 3) {
      Animated.timing(progressOpacity3, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [currentStep, slideAnim, containerWidth, handleStepChange, progressOpacity1, progressOpacity2, progressOpacity3]);

  const handleMRZScanned = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    setMRZData(data);
    handleNext();
  }, [handleNext]);

  const handleNFCSuccess = useCallback((data: PassportData) => {
    setNFCData(data);

    // Create RarimePassport from NFC data. dg1Bytes / sodBytes are already
    // Uint8Arrays (decoded in modules/e-document/index.ts) — no base64 step.
    (async () => {
      try {
        const { RarimePassport: RP } = await import('@rarimo/rarime-rn-sdk');
        const dg1 = new Uint8Array(data.dg1Bytes);
        const sod = new Uint8Array(data.sodBytes);
        passportRef.current = new RP({ dataGroup1: dg1, sod });
        console.log('[FreedomTool] RarimePassport created, dg1.length:', dg1.length);

        // Resolve (and lazily generate) the BJJ key bound to THIS passport.
        // Multiple passports on the same phone each get their own identity;
        // the same passport rescanned recovers its existing key. We also
        // mirror the result into the legacy single-key SecureStore slot so
        // every downstream call site (Rarime init, Step11 mainnet flow,
        // diagnostic screens) keeps reading from `getOrCreatePrivateKey()`
        // unchanged. See utils/passport-key-db.ts for the DB shape and
        // utils/identity.ts::getOrCreateKeyForPassport for the migration.
        try {
          const { getOrCreateKeyForPassport } = await import('@/utils/identity');
          const mrzDoc = (() => {
            try { return passportRef.current!.getMRZData().documentNumber; }
            catch { return undefined; }
          })();
          const resolved = await getOrCreateKeyForPassport({ dg1, sod, label: mrzDoc });
          console.log(
            `[FreedomTool][passport-key] hash=${resolved.passportHash.slice(0, 12)}… ` +
            `key=${resolved.privateKey.slice(0, 8)}… isNew=${resolved.isNew} ` +
            `migratedFromLegacy=${resolved.migratedFromLegacy}`,
          );

          // Pre-warm the CSCA bootstrap cache. Reading + treap-building
          // master_000316.pem (1.8 MB, 857 certs) takes ~1.5 s on the Volla
          // Phone X23 — kicking it off right after the NFC scan finishes
          // means by the time Step 7 might call registerCscaForSlave (10 s
          // later, after status check + suite resolution), the cache is
          // hot. Fire-and-forget: errors are logged but don't block the
          // NFC flow.
          import('@/utils/csca-bootstrap')
            .then((m) => m.ensureMastersCache())
            .then(() => console.log('[csca-bootstrap] cache pre-warmed'))
            .catch((e) => console.warn('[csca-bootstrap] pre-warm failed:', e?.message ?? e));

          // Force the SDK refs to be re-created against the (possibly new)
          // private key on the next Rarime init pass — same trick we use
          // when the user flips testnet/mainnet in Settings.
          rarimeRef.current = null;
          freedomToolRef.current = null;
          // ONLY now signal the Rarime init useEffect that it can read
          // `getOrCreatePrivateKey()` safely — the legacy slot has been
          // synced to this passport's key above.
          setPassportKeyReady(true);
        } catch (e: any) {
          console.warn('[FreedomTool][passport-key] lookup/create failed:', e?.message ?? e);
          // Fall through with whatever the legacy slot holds so the user
          // isn't stuck on Step 7 forever — the on-chain status check
          // will surface the wrong-key case explicitly with the
          // REGISTERED_WITH_OTHER_PK branch in Step 7.
          setPassportKeyReady(true);
        }

        // One-shot capture for inid-passport-debug's PassportDebug screen,
        // which accepts {dg1, sod, dg15?, aaSignature?} as hex strings.
        // Pull off-device with `adb pull
        // /storage/emulated/0/Android/data/com.referendumcitoyen.app/files/passport.json`
        // (or the documentDirectory from logs below).
        const toHex = (u: Uint8Array) =>
          Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
        const FS = await import('expo-file-system/legacy');
        const payload: Record<string, string> = {
          dg1: toHex(new Uint8Array(data.dg1Bytes)),
          sod: toHex(new Uint8Array(data.sodBytes)),
        };
        if (data.dg15Bytes && data.dg15Bytes.length) payload.dg15 = toHex(new Uint8Array(data.dg15Bytes));
        if (data.aaSignature && data.aaSignature.length) payload.aaSignature = toHex(new Uint8Array(data.aaSignature));
        const path = (FS.documentDirectory ?? '') + 'passport.json';
        await FS.writeAsStringAsync(path, JSON.stringify(payload));
        console.log('[passport.json] written to', path);
        console.log('[passport.json] bytes: dg1=' + payload.dg1.length / 2 + ' sod=' + payload.sod.length / 2 + ' dg15=' + ((payload.dg15?.length ?? 0) / 2) + ' aaSig=' + ((payload.aaSignature?.length ?? 0) / 2));
      } catch (err) {
        console.error('[FreedomTool] PASSPORT_CREATE_FAILED', err);
      }
    })();

    handleNext();
  }, [handleNext]);

  const handleGoBackToMRZScan = useCallback(() => {
    setCurrentStep(5);
    setMRZData(null);
    Animated.timing(slideAnim, {
      toValue: -4 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(5);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleManualFill = useCallback(() => {
    setIsManualInputVisible(true);
  }, []);

  const handleManualInputClose = useCallback(() => {
    setIsManualInputVisible(false);
  }, []);

  const handleManualInputSubmit = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    setIsManualInputVisible(false);
    handleMRZScanned(data);
  }, [handleMRZScanned]);

  const verificationHandledRef = useRef(false);
  const handleVerificationSuccess = useCallback(() => {
    if (verificationHandledRef.current) return;
    verificationHandledRef.current = true;
    setVerificationResult('success');
    // Move to step 8 (voting screen) after a brief delay
    setTimeout(() => {
      setCurrentStep(8);
      Animated.timing(slideAnim, {
        toValue: -7 * containerWidth,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      handleStepChange(8);
    }, 1500);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVerificationError = useCallback((_message?: string, fatal?: boolean) => {
    // Fatal errors (e.g. "passport already registered with another key")
    // cannot be retried. Keep the user on Step 7 with its own contextual
    // error display — do NOT trigger the generic Step9Error overlay
    // ("Une erreur est survenue") or advance to Step 8, both of which
    // would hide the specific explanation. The user closes the modal via
    // the top-right X to exit.
    if (fatal) return;
    setVerificationResult('error');
    setTimeout(() => handleNext(), 1500);
  }, [handleNext]);

  const handleFatalVerificationError = useCallback(() => {
    setTimeout(() => handleClose(), 4000);
  }, [handleClose]);

  const handleVoteSuccess = useCallback(() => {
    setCurrentStep(9);
    Animated.timing(slideAnim, {
      toValue: -8 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(9);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVoteSelect = useCallback((answerIndex: number) => {
    setSelectedVote(answerIndex);
    setCurrentStep(10);
    Animated.timing(slideAnim, {
      toValue: -9 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(10);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleStep9Confirm = useCallback(() => {
    setCurrentStep(11);
    Animated.timing(slideAnim, {
      toValue: -10 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(11);
  }, [selectedVote, slideAnim, containerWidth, handleStepChange]);

  const handleClose = useCallback(() => {
    // Stack trace so we can see WHICH caller closed the screen (the user
    // reports the success page sometimes auto-dismisses; we want to find
    // the path that isn't a manual button press).
    console.log('[voting-flow] handleClose called. stack:\n' + new Error().stack);
    pauseAll();
    router.back();
  }, [router, pauseAll]);

  const handleStep9Cancel = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const handleStep11Success = useCallback(() => {
    setVoteSubmissionResult('success');
    setCurrentStep(12);
    Animated.timing(slideAnim, {
      toValue: -11 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(12);
  }, [slideAnim, containerWidth, handleStepChange]);

  const [voteErrorReason, setVoteErrorReason] = useState<string | null>(null);
  const handleStep11Error = useCallback((reason?: string) => {
    setVoteErrorReason(reason || null);
    setVoteSubmissionResult('error');
    setCurrentStep(13);
    Animated.timing(slideAnim, {
      toValue: -12 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(13);
  }, [slideAnim, containerWidth, handleStepChange]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.topSection}>
        {/* Safe area spacer */}
        <View style={{ height: insets.top, backgroundColor: colors.cardBackground }} />

        {/* Title Section - Hidden for Step 4, 5, and 6 */}
        {currentStep < 4 && (
          <View style={modalStyles.titleSection}>
            <Text style={modalStyles.title}>{t('voting.title')}</Text>
          </View>
        )}

        {/* Sliding Container */}
        <View
          style={[
            modalStyles.slidingWrapper,
            currentStep < 4 && { backgroundColor: colors.background }
          ]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <Animated.View
            style={[
              modalStyles.slidingContainer,
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            {/* Only mount steps within ±1 of the current index. Placeholders keep
                slide-animation offsets stable. Keeps the JS thread idle during
                the NFC scan (Step 6) so reader-mode sendEvent() calls don't
                back-pressure IsoDep. */}
            {(() => {
              const idx = currentStep - 1;
              const show = (i: number) => Math.abs(i - idx) <= 1;
              const spacer = (key: string) => (
                <View key={key} style={{ width: containerWidth }} />
              );
              return [
                show(0) ? <Step1 key="s1" player={player1} containerWidth={containerWidth} isPassportFlow={isPassportFlow} /> : spacer('s1'),
                show(1) ? <Step2 key="s2" player={player2} containerWidth={containerWidth} isPassportFlow={isPassportFlow} /> : spacer('s2'),
                show(2) ? <Step3 key="s3" player={player3} containerWidth={containerWidth} /> : spacer('s3'),
                show(3) ? <Step4 key="s4" player={player1} containerWidth={containerWidth} onStartAnalysis={handleNext} isPassportFlow={isPassportFlow} /> : spacer('s4'),
                show(4) ? (
                  <Step5
                    key="s5"
                    containerWidth={containerWidth}
                    // Kill the camera while the manual-entry modal is open so
                    // the preview doesn't sit on top of the keyboard.
                    isActive={currentStep === 5 && !isManualInputVisible}
                    onMRZScanned={handleMRZScanned}
                    onManualFill={handleManualFill}
                    isPassportFlow={isPassportFlow}
                    // Gate MRZ-extracted nationality against the proposal's
                    // citizenship whitelist (empty / undefined → open to
                    // all countries).
                    allowedCitizenships={proposalInfo?.criteria.citizenshipWhitelist}
                  />
                ) : spacer('s5'),
                show(5) ? (
                  <Step6
                    key="s6"
                    containerWidth={containerWidth}
                    player={player4}
                    mrzData={mrzData}
                    onNFCSuccess={handleNFCSuccess}
                    onGoBack={handleGoBackToMRZScan}
                    isPassportFlow={isPassportFlow}
                  />
                ) : spacer('s6'),
                show(6) ? (
                  <Step7
                    key="s7"
                    containerWidth={containerWidth}
                    player={player5}
                    isActive={currentStep === 7}
                    nfcData={nfcData}
                    onSuccess={handleVerificationSuccess}
                    onError={handleVerificationError}
                    onFatalError={handleFatalVerificationError}
                    rarime={rarimeRef.current ?? undefined}
                    passport={passportRef.current ?? undefined}
                    freedomTool={freedomToolRef.current ?? undefined}
                    network={network}
                  />
                ) : spacer('s7'),
                show(7) ? (
                  <Step8
                    key="s8"
                    containerWidth={containerWidth}
                    verificationResult={verificationResult}
                    voteSubmissionResult={voteSubmissionResult}
                    onVoteSuccess={handleVoteSuccess}
                    onClose={handleClose}
                  />
                ) : spacer('s8'),
                show(8) ? (
                  <Step9Vote
                    key="s9v"
                    containerWidth={containerWidth}
                    onVoteSelect={handleVoteSelect}
                    onCancel={handleStep9Cancel}
                    proposalInfo={proposalInfo ?? undefined}
                  />
                ) : spacer('s9v'),
                show(9) ? (
                  <Step10
                    key="s10"
                    containerWidth={containerWidth}
                    player={player3}
                    selectedVote={selectedVote}
                    proposalInfo={proposalInfo ?? undefined}
                    onCancel={handleStep9Cancel}
                    onConfirm={handleStep9Confirm}
                  />
                ) : spacer('s10'),
                show(10) ? (
                  <Step11
                    key="s11"
                    containerWidth={containerWidth}
                    isActive={currentStep === 11}
                    onSuccess={handleStep11Success}
                    onError={handleStep11Error}
                    freedomTool={freedomToolRef.current ?? undefined}
                    rarime={rarimeRef.current ?? undefined}
                    passport={passportRef.current ?? undefined}
                    proposalInfo={proposalInfo ?? undefined}
                    answerIndex={selectedVote}
                    network={network}
                  />
                ) : spacer('s11'),
                show(11) ? (
                  <Step12Success
                    key="s12s"
                    containerWidth={containerWidth}
                    onViewResults={handleClose}
                  />
                ) : spacer('s12s'),
                show(12) ? (
                  <Step12Error
                    key="s12e"
                    containerWidth={containerWidth}
                    onGoHome={handleClose}
                    errorReason={voteErrorReason}
                  />
                ) : spacer('s12e'),
              ];
            })()}
            {verificationResult === 'error' && (
              <Step9Error
                containerWidth={containerWidth}
                onGoHome={handleClose}
                isPassportFlow={isPassportFlow}
              />
            )}
          </Animated.View>
        </View>
      </View>

      <View style={[styles.bottomSection, currentStep < 4 && { backgroundColor: colors.background }]}>
        {/* Progress and Navigation */}
        {currentStep < 4 && (
          <View style={styles.navigationSection}>
            <View style={styles.progressSection}>
              <Animated.View style={[styles.progressBar, { opacity: progressOpacity1, backgroundColor: colors.secondary }]} />
              <Animated.View style={[styles.progressBar, { opacity: progressOpacity2, backgroundColor: colors.secondary }]} />
              <Animated.View style={[styles.progressBar, { opacity: progressOpacity3, backgroundColor: colors.secondary }]} />
            </View>
            <TouchableOpacity
              style={styles.arrowButton}
              onPress={handleNext}
              activeOpacity={0.7}
            >
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M9 18l6-6-6-6"
                  stroke="white"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ManualMRZInput
        isVisible={isManualInputVisible}
        onClose={handleManualInputClose}
        onSubmit={handleManualInputSubmit}
      />
    </View>
  );
}

type FlowColors = ReturnType<typeof useColors>;

const createStyles = (colors: FlowColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.cardBackground,
    },
    topSection: {
      // flex: 1 so the slidingWrapper inside (also flex: 1 on Android) can fill
      // all the vertical space above the nav bar — keeps the slide area
      // consistent across steps 1–3 regardless of which slides are mounted.
      flex: 1,
      backgroundColor: colors.cardBackground,
    },
    bottomSection: {
      // No flex: shrinks to the nav's intrinsic content height. topSection takes
      // all remaining vertical space, and nav ends up naturally pinned to the
      // screen bottom.
    },
    progressSection: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    progressBar: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      // Translucent track over the brand-colored bottom bar; opacity is animated
      // per-segment to indicate active vs inactive steps.
      backgroundColor: colors.scanOverlayMedium,
    },
    navigationSection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 16,
      gap: 39,
    },
    arrowButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.secondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
