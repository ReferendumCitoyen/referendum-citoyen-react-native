import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useTheme } from '@/constants/theme';
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
import { markVoteJustCast } from '@/utils/post-vote-refresh';


export default function VotingFlowScreen() {
  const { proposalId: proposalIdParam, isPassport: isPassportParam } = useLocalSearchParams<{ proposalId?: string; isPassport?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const { theme } = useTheme();
  const { network } = useNetwork();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<'success' | 'error' | null>(null);
  const [verificationError, setVerificationError] = useState<unknown>(null);
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
  // Height available for the slide area (measured from topSection). Steps 1–3
  // cap their ScrollView at this on iOS so content stays its natural size and
  // only scrolls once it overflows.
  const [slideAreaHeight, setSlideAreaHeight] = useState<number | undefined>(undefined);
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
  const { player1, player2, player3, player4, player5, playerIntro } = players;

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

        const { Rarime: RarimeClass, FreedomTool: FT } =
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
      console.log('[flow] step → 1 (focus-reset)');
      setCurrentStep(1);
      setVerificationResult(null);
      setVerificationError(null);
      setVoteSubmissionResult(null);
      setVoteTxId(null);
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
      // Re-arm Step 7's verification-handled latch and clear the passport
      // scan from the previous attempt. Without these resets, a user who
      // exits + re-enters the flow (crash recovery, "try again",
      // backgrounding during proof generation) hits the latch at line ~464
      // and Step 7 silently no-ops; the stale passport also stays
      // observable via `passportRef.current` until the next NFC scan
      // overwrites it.
      verificationHandledRef.current = false;
      passportRef.current = null;

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
    // Step-transition audit trail: the #54 step-skip reports (2026-06-11/12)
    // showed users reaching the vote screens with no visible path in the
    // logs. Every transition now logs its source so the 5-min error-report
    // tail can name the jumper outright.
    console.log(`[flow] step ${currentStep} → ${newStep} (next)`);
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
          // No `label` arg — the previous wiring stored the MRZ document
          // number in the on-device key DB as a display aid for backups,
          // but that's PII we don't want at rest. See
          // utils/passport-key-db.ts::PassportKeyEntry.
          const resolved = await getOrCreateKeyForPassport({ dg1, sod });
          // SECURITY: even truncated, the passport hash + key prefix
          // together act as a stable per-user fingerprint in logcat.
          // Keep the boolean flags in release (useful for triage) and
          // gate the bytes behind __DEV__.
          if (__DEV__) {
            console.log(
              `[FreedomTool][passport-key] hash=${resolved.passportHash.slice(0, 12)}… ` +
              `key=${resolved.privateKey.slice(0, 8)}… isNew=${resolved.isNew} ` +
              `migratedFromLegacy=${resolved.migratedFromLegacy}`,
            );
          } else {
            console.log(
              `[FreedomTool][passport-key] isNew=${resolved.isNew} ` +
              `migratedFromLegacy=${resolved.migratedFromLegacy}`,
            );
          }

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
      } catch (err) {
        console.error('[FreedomTool] PASSPORT_CREATE_FAILED', err);
      }
    })();

    handleNext();
  }, [handleNext]);

  const handleGoBackToMRZScan = useCallback(() => {
    console.log('[flow] step → 5 (back-to-mrz)');
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
      console.log('[flow] step → 8 (verification-success)');
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

  const handleVerificationError = useCallback((_message?: string, fatal?: boolean, error?: unknown) => {
    // Fatal errors (e.g. "passport already registered with another key")
    // cannot be retried. Keep the user on Step 7 with its own contextual
    // error display — do NOT trigger the generic Step9Error overlay
    // ("Une erreur est survenue") or advance to Step 8, both of which
    // would hide the specific explanation. The user closes the modal via
    // the top-right X to exit.
    if (fatal) return;
    setVerificationError(error ?? new Error(_message ?? 'Unknown verification error'));
    setVerificationResult('error');
    setTimeout(() => handleNext(), 1500);
  }, [handleNext]);

  const handleVoteSuccess = useCallback(() => {
    console.log('[flow] step → 9 (step8-vote-now)');
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
    console.log('[flow] step → 10 (vote-selected)');
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
    console.log('[flow] step → 11 (vote-confirmed)');
    setCurrentStep(11);
    Animated.timing(slideAnim, {
      toValue: -10 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(11);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleClose = useCallback(() => {
    // Dev-only stack trace: lets us see WHICH caller closed the screen
    // (Step12 auto-advance vs explicit Fermer tap vs router-back gesture).
    // Gated to release builds out of the error-report ring buffer — every
    // close path was emitting a multi-line trace that crowded out actual
    // diagnostics.
    if (__DEV__) {
      console.log('[voting-flow] handleClose called. stack:\n' + new Error().stack);
    }
    pauseAll();
    router.back();
  }, [router, pauseAll]);

  const handleStep9Cancel = useCallback(() => {
    handleClose();
  }, [handleClose]);

  // Step 7 calls this when a *fatal* verification error fires — auto-close
  // the modal after 4 s so the user doesn't get stranded on the error
  // screen. Must live BELOW `handleClose` so the `[handleClose]` dep array
  // doesn't read a TDZ binding (`const` references its own declaration
  // line, not function-scope hoisted like `var`).
  const handleFatalVerificationError = useCallback(() => {
    setTimeout(() => handleClose(), 4000);
  }, [handleClose]);

  const [voteTxId, setVoteTxId] = useState<string | null>(null);
  // false when the tx was submitted but not yet confirmed on-chain at timeout —
  // Step12Success then shows a neutral "awaiting confirmation" message instead
  // of a definitive green success. A reverted tx never reaches here (→ error).
  const [voteConfirmed, setVoteConfirmed] = useState(true);
  const handleStep11Success = useCallback((txHash: string, confirmed: boolean) => {
    setVoteTxId(txHash);
    setVoteConfirmed(confirmed);
    setVoteSubmissionResult('success');
    // Tell the home tab a vote landed so it knows to do an extra delayed
    // refresh once tx propagation completes (the immediate focus-time
    // refetch races ahead of L2 confirmation otherwise).
    markVoteJustCast();
    console.log('[flow] step → 12 (vote-submitted)');
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
  const [voteError, setVoteError] = useState<unknown>(null);
  const handleStep11Error = useCallback((reason?: string, error?: unknown) => {
    setVoteErrorReason(reason || null);
    setVoteError(error ?? new Error(reason ?? 'Unknown vote error'));
    setVoteSubmissionResult('error');
    console.log('[flow] step → 13 (vote-error)');
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
    <View
      style={[
        styles.container,
        // Clear the system-nav strip so the bottom row (progress bars + arrow
        // on steps 1–3, full-width pill on steps 4+) doesn't sit flush against
        // the bottom of the screen. Needed on both platforms:
        //   • iOS: home-indicator strip on Face-ID devices.
        //   • Android: targetSdkVersion 35 forces edge-to-edge regardless of
        //     `edgeToEdgeEnabled: false`, so the 3-button nav bar and gesture
        //     pill now overlay app content instead of carving out space.
        //     insets.bottom is the height the system reserves (≈48dp on
        //     3-button, ≈24dp on 2-button, ≈16dp on full-gesture, 0 on devices
        //     with hardware nav).
        { paddingBottom: insets.bottom },
      ]}
    >
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* iOS modal sheet: native header bar with Fermer in headerRight.
          Android skips this override entirely — keeps the headerless card
          presentation defined in app/_layout.tsx. Mirrors the pattern from
          the old app/voting-screen.tsx (commit 3a0e3c1). */}
      {Platform.OS === 'ios' && (
        <Stack.Screen
          options={{
            title: currentStep < 4 ? t('voting.title') : '',
            headerRight: () => (
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.secondary }}>
                  {t('common.close')}
                </Text>
              </TouchableOpacity>
            ),
          }}
        />
      )}

      <View
        style={styles.topSection}
        onLayout={(e) => setSlideAreaHeight(e.nativeEvent.layout.height)}
      >
        {/* Safe area spacer — only Android needs this; iOS modal renders the
            native nav bar above the screen content area so insets.top is
            already 0 below the header. */}
        {Platform.OS !== 'ios' && (
          <View style={{ height: insets.top, backgroundColor: colors.cardBackground }} />
        )}

        {/* Title Section — Android only. On iOS the native modal header
            already shows the title in its centre. Hidden for Step 4+. */}
        {Platform.OS !== 'ios' && currentStep < 4 && (
          <View style={modalStyles.titleSection}>
            <Text style={modalStyles.title}>{t('voting.title')}</Text>
          </View>
        )}

        {/* Sliding Container */}
        <View
          style={[
            modalStyles.slidingWrapper,
            // Steps 1–3 use a tinted backdrop on Android (colors.background =
            // #EDEFF9). On iOS we keep the entire modal sheet white
            // (cardBackground) so the bottom-sheet feels like one continuous
            // surface instead of a tinted band.
            currentStep < 4 && {
              backgroundColor: Platform.OS === 'ios' ? colors.cardBackground : colors.background,
            },
            // Step 4 only: height-bound the slide to the sheet (not the taller
            // Step 5 camera mounted alongside it) so the intro video's "Passer"
            // button stays on-screen. Steps 1–3 and 5+ keep content-sized layout.
            currentStep === 4 && { flex: 1 },
          ]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <Animated.View
            style={[
              modalStyles.slidingContainer,
              // Match slidingWrapper: fill height on step 4 only so its slide
              // stretches vertically and the intro "Passer" button stays
              // on-screen.
              currentStep === 4 && { flex: 1 },
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
                show(0) ? <Step1 key="s1" player={player1} containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} isPassportFlow={isPassportFlow} /> : spacer('s1'),
                show(1) ? <Step2 key="s2" player={player2} containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} isPassportFlow={isPassportFlow} /> : spacer('s2'),
                show(2) ? <Step3 key="s3" player={player3} containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} /> : spacer('s3'),
                show(3) ? <Step4 key="s4" player={player1} introPlayer={playerIntro} containerWidth={containerWidth} onStartAnalysis={handleNext} isPassportFlow={isPassportFlow} /> : spacer('s4'),
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
                    voteIdentifier={voteTxId ?? undefined}
                    confirmed={voteConfirmed}
                    onViewResults={handleClose}
                  />
                ) : spacer('s12s'),
                show(12) ? (
                  <Step12Error
                    key="s12e"
                    containerWidth={containerWidth}
                    onGoHome={handleClose}
                    errorReason={voteErrorReason}
                    error={voteError}
                  />
                ) : spacer('s12e'),
              ];
            })()}
            {verificationResult === 'error' && (
              <Step9Error
                containerWidth={containerWidth}
                onGoHome={handleClose}
                isPassportFlow={isPassportFlow}
                error={verificationError}
              />
            )}
          </Animated.View>
        </View>
      </View>

      <View
        style={[
          styles.bottomSection,
          // Match the sliding container's per-platform backdrop for steps 1–3
          // so the seam between slide area and nav row stays invisible. iOS:
          // white (continuous modal sheet). Android: tinted (unchanged).
          currentStep < 4 && {
            backgroundColor: Platform.OS === 'ios' ? colors.cardBackground : colors.background,
          },
        ]}
      >
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
      // iOS-only: explicit breathing room between the right edge of the 3rd
      // progress bar and the next-arrow button. The navigationSection has
      // gap: 39 but some RN versions/builds don't honour it on a flex: 1
      // child + fixed sibling combo. Platform.select keeps Android
      // byte-identical (no marginRight at all).
      marginRight: Platform.select({ ios: 16 }),
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
