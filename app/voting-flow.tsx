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
import { useDevMode } from '@/contexts/DevModeContext';
import { isBetaBuild } from '@/constants/app-flavour';
import { assertOnChainConstants } from '@/utils/register-via-noir';
import type { AttemptKey } from '@/utils/attempt-key';
import { findCachedProposal } from '@/utils/proposal-cache';
import { mrzDateToFrench } from '@/utils/mrzDate';
import { clearArtifacts } from '@/utils/vote-artifacts';
import { useTranslation } from 'react-i18next';
import type { PassportData } from '@/modules/e-document';
import type { DocumentAccessKey } from '@/utils/document-access-key';

// Import all steps
import Step1 from '@/components/voting-modal/Step1';
import Step2 from '@/components/voting-modal/Step2';
import Step4 from '@/components/voting-modal/Step4';
import Step5 from '@/components/voting-modal/Step5';
import Step5Can from '@/components/voting-modal/Step5Can';
import Step6 from '@/components/voting-modal/Step6';
import Step7 from '@/components/voting-modal/Step7';
import Step8 from '@/components/voting-modal/Step8';
import Step9Vote from '@/components/voting-modal/Step9Vote';
import Step10 from '@/components/voting-modal/Step10';
import Step11 from '@/components/voting-modal/Step11';
import Step12Success from '@/components/voting-modal/Step12Success';
import Step12Error from '@/components/voting-modal/Step12Error';
import ManualMRZInput from '@/components/voting-modal/ManualMRZInput';
import DocumentChoice from '@/components/voting-modal/DocumentChoice';
import { CARD_ONLY_LAUNCH } from '@/constants/card-only-launch';
import { createModalStyles } from '@/components/voting-modal/styles';
import { useModalVideoPlayers } from '@/hooks/useModalVideoPlayers';
import { markVoteJustCast } from '@/utils/post-vote-refresh';
import { beginVoteTrace, purgeVoteTrace } from '@/utils/logger';
import { isTerminalVoteError } from '@/utils/relayer-errors';
import { createAttemptGeneration } from '@/utils/attempt-generation';
import { checkNfcHardware } from '@/utils/e-document/nfc-support';
import {
  ballotMayBeOnChain,
  codeForIneligibility,
  VOTE_ERROR_TABLE,
  voteErrorMessage,
  VoteRefusal,
  type VoteErrorCode,
} from '@/utils/vote-error-table';
import { readLocalProposalIndex } from '@/utils/proposal-index';
import { checkVoteEligibility, localEligibilityContext } from '@/utils/vote-eligibility';


export default function VotingFlowScreen() {
  const { proposalId: proposalIdParam, cardProposalId: cardProposalIdParam } =
    useLocalSearchParams<{ proposalId?: string; cardProposalId?: string; isPassport?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColors();
  const { theme } = useTheme();
  const { network } = useNetwork();
  // The beta's test questions stay votable in dev mode; the flavour is
  // re-checked here rather than trusted from the context alone, like the home.
  const { devMode } = useDevMode();
  const devAllowed = devMode && isBetaBuild();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStepState] = useState(1);
  // The step as of now, not as of the last render. Every event handler that
  // moves the flow checks it (item 5): a closure's `currentStep` is stale by
  // one render, which is exactly the window a double tap or a late NFC
  // result falls into. Updated synchronously with every step change.
  const currentStepRef = useRef(1);
  const setCurrentStep = useCallback((step: number) => {
    currentStepRef.current = step;
    setCurrentStepState(step);
  }, []);
  // Flow-level attempt generation (rule R1): bumped on entry, on leaving, on
  // unmount, on going back to the document entry and on each accepted scan.
  // Async continuations and deferred step changes started under an older
  // value do nothing. In memory only, never logged.
  const flowGenerationRef = useRef(createAttemptGeneration());
  const flowGeneration = flowGenerationRef.current;
  useEffect(() => () => { flowGeneration.next(); }, [flowGeneration]);

  // No NFC reader (every iPad): say so at step 4, before the CAN is typed,
  // instead of a false "activez le NFC" at step 6 (item 11 E). Local call.
  const [nfcHardware, setNfcHardware] = useState<boolean | null | undefined>(undefined);
  const nfcHardwareCheck = useRef<Promise<boolean | null> | null>(null);
  useEffect(() => {
    let cancelled = false;
    nfcHardwareCheck.current = checkNfcHardware();
    nfcHardwareCheck.current.then((present) => {
      if (cancelled) return;
      if (present === false) console.log('[flow] this device has no NFC reader');
      setNfcHardware(present);
    });
    return () => { cancelled = true; };
  }, []);
  // Only ever null or 'success': a Step 7 failure keeps the user on Step 7
  // (handleVerificationError below), so there is no 'error' state to carry.
  const [verificationResult, setVerificationResult] = useState<'success' | null>(null);
  // Set by Step 7 when it bonds the document on-chain for the first time.
  // Drives Step 12's one-time "back up your key" notice.
  const [justRegistered, setJustRegistered] = useState(false);
  // True when the scanned document shares its key with the other document
  // type on this phone (Level 1, utils/identity.ts). Step 7 uses it to name
  // which document is already registered when the chain refuses this one.
  const [keyLinkedToOtherDocument, setKeyLinkedToOtherDocument] = useState(false);
  // What Step 6 opens the chip with: the MRZ key for a passport, the CAN for
  // an ID card. Set by Step 5, cleared whenever the user goes back to it.
  const [accessKey, setAccessKey] = useState<DocumentAccessKey | null>(null);
  const [nfcData, setNFCData] = useState<PassportData | null>(null);
  // Flips true ONLY after `handleNFCSuccess`'s async block has resolved the
  // per-passport BJJ key and synced it into the legacy SecureStore slot.
  // The Rarime init `useEffect` below gates on this so it never reads a
  // stale legacy key while `getOrCreateKeyForPassport` is mid-flight —
  // without this gate, `getDocumentStatus` racing the per-passport key
  // write returns the wrong profileKey and reports `REGISTERED_WITH_OTHER_PK`.
  const [passportKeyReady, setPassportKeyReady] = useState(false);
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);
  // What the camera last read, in the form's own JJMMAA format. The form is
  // the confirmation screen for a camera read: the user sees the three values
  // that will unlock the chip and corrects them if the OCR got one wrong.
  const [cameraPrefill, setCameraPrefill] = useState<{
    documentNumber: string;
    birthDate: string;
    expiryDate: string;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);
  // Height available for the slide area (measured from topSection). Steps 1–3
  // cap their ScrollView at this on iOS so content stays its natural size and
  // only scrolls once it overflows.
  const [slideAreaHeight, setSlideAreaHeight] = useState<number | undefined>(undefined);
  // The same area as the slides from step 4 on see it: on Android the
  // measured topSection also holds the status-bar spacer (insets.top), which
  // is not slide space (steps 4+ have no title row). Used by slideFrameStyle
  // (components/voting-modal/styles.ts).
  const stepSlideHeight =
    slideAreaHeight === undefined
      ? undefined
      : Platform.OS === 'ios'
        ? slideAreaHeight
        : Math.max(0, slideAreaHeight - insets.top);
  const [selectedVote, setSelectedVote] = useState<number>(0);

  // The key of THIS attempt (dossier 2.0.2, R2 / item 14 a, f, g): resolved
  // once for the scanned document in handleNFCSuccess, then handed as a value
  // to everything that proves or reads status with it: the SDK instance,
  // Step 7 (status, one-document checks, registration proof) and the passport
  // vote. Nothing downstream re-reads the global legacy slot, which a later
  // scan of another document rewrites. In memory only, never logged.
  const attemptKeyRef = useRef<AttemptKey | null>(null);
  // The attempt the current SDK instance was built for. Step 7 and Step 11
  // receive the key from here, so a key and an instance built for different
  // documents can never be paired.
  const sdkAttemptRef = useRef<AttemptKey | null>(null);
  // Set when this document's key could not be resolved. Step 7 stops on it
  // with a clear message instead of continuing on whatever the global slot
  // holds (the silent fallback removed by 14 f).
  const [keyResolutionError, setKeyResolutionError] = useState<string | null>(null);
  const [proposalInfo, setProposalInfo] = useState<ProposalInfo | null>(null);

  // The document is not inferred from the proposal the user tapped (see
  // isPassportVotingTarget in utils/voteResults.ts): the DocumentChoice gate
  // screen below asks. null = chooser not yet answered. With CARD_ONLY_LAUNCH
  // the answer is given here and the chooser never renders: the launch vote
  // is by ID card alone (constants/card-only-launch.ts).
  const [chosenDocType, setChosenDocType] = useState<'idCard' | 'passport' | null>(
    CARD_ONLY_LAUNCH ? 'idCard' : null,
  );
  const isPassportFlow = chosenDocType === 'passport';
  // The home list shows a question once even when it lives twice on chain
  // (utils/proposal-pairing.ts) and passes both ids. The document the user
  // picks decides which one is voted: only the card twin's contract can
  // verify a card proof, only the passport twin's a passport proof.
  const targetProposalId = useMemo(() => {
    const passportId = proposalIdParam || getDefaultProposalId(network);
    return chosenDocType === 'idCard' && cardProposalIdParam ? cardProposalIdParam : passportId;
  }, [proposalIdParam, cardProposalIdParam, chosenDocType, network]);
  // Lands in the log window every report carries: which id this document
  // was sent to, and which pair it came from.
  useEffect(() => {
    if (!chosenDocType) return;
    console.log(
      `[voting-flow] document=${chosenDocType} → proposal #${targetProposalId}` +
        (cardProposalIdParam ? ` (twins: passport #${proposalIdParam}, card #${cardProposalIdParam})` : ''),
    );
  }, [chosenDocType, targetProposalId, proposalIdParam, cardProposalIdParam]);
  const rarimeRef = useRef<Rarime | null>(null);
  const freedomToolRef = useRef<FreedomTool | null>(null);
  const passportRef = useRef<RarimePassport | null>(null);
  // Mirrors "rarimeRef.current is set": the refs above do not re-render, so
  // without this Step 7 only saw the SDK at the next unrelated render.
  const [rarimeReady, setRarimeReady] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;

  const { players, handleStepChange, pauseAll } = useModalVideoPlayers();
  // player2 is intentionally not destructured: steps 1 and 2 now show still
  // artwork instead of video. useModalVideoPlayers still creates and cycles it,
  // so its clip is loaded but never displayed — worth pruning from the hook if
  // the new artwork sticks.
  const { player1, player3, player4, player5 } = players;

  // If the user switches network from Settings while the voting-flow screen
  // is still mounted (rare — would require backing out to Settings and back),
  // wipe the SDK refs so the next entry into Step 7 re-creates them against
  // the new addresses. Without this we'd keep talking to testnet contracts
  // even though the user flipped to Mainnet.
  useEffect(() => {
    rarimeRef.current = null;
    freedomToolRef.current = null;
    sdkAttemptRef.current = null;
    setRarimeReady(false);
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
  }, [targetProposalId, network]);

  // Init Rarime + FreedomTool + load proposal. Deferred until after the NFC
  // scan (Step 6) so that Rarime's native Rust/ZK warmup doesn't contend with
  // IsoDep during PACE. Step 7 reads rarimeRef.current defensively and will
  // wait for init to complete.
  useEffect(() => {
    if (currentStep < 7) return;
    // Wait for handleNFCSuccess's async block to resolve this document's
    // BJJ key. The instance used to be built from `getOrCreatePrivateKey()`,
    // the global slot, which could still hold the *previous* scan's key (or
    // the migration-era legacy key) and made the on-chain `activeIdentity`
    // check report REGISTERED_WITH_OTHER_PK for a card bound to this phone
    // (dossier 2.0.2, item 14, field report of 19/09).
    if (!passportKeyReady) return;
    if (rarimeRef.current) return; // already initialised
    // The key this instance is built with: the attempt's, captured now, as a
    // value. Never the global slot (R2).
    const attempt = attemptKeyRef.current;
    if (!attempt) return;
    (async () => {
      try {
        // Catch regressions in the keccak dispatch strings used by the
        // registerViaNoir path. Cheap (~µs) and fails loud, before any
        // network calls happen. See utils/register-via-noir.ts.
        try { assertOnChainConstants(); } catch (e) { console.error('[voting-flow]', e); }

        const { Rarime: RarimeClass, FreedomTool: FT } =
          await import('@rarimo/rarime-rn-sdk');

        // The light register + query_identity circuits are published on
        // Rarimo's GCS bucket and the SDK fetches them from there on first
        // use — no local bundle registration needed for those.
        //
        // The HEAVY register circuits are different: they're what the Mainnet
        // registerViaNoir path proves against (utils/register-via-noir.ts),
        // and we bundle them so registration works offline — this is a
        // low-bandwidth citizen voting app, and a 3 MB download at the worst
        // possible moment (mid-scan, in a queue, on 3G) is not acceptable.
        //
        // There is one circuit PER DOCUMENT TYPE, not one shared circuit.
        // `dg1`, `ec` and `sa` are fixed-size Noir arrays, so the lengths are
        // baked into the compiled bytecode — read straight off the two ABIs:
        //
        //                   dg1       ec        sa
        //   TD1 (CNIe)      u8[95]    u8[313]   u8[152]
        //   TD3 (passport)  u8[93]    u8[297]   u8[104]
        //
        // A CNIe therefore CANNOT be proved with the TD3 bytecode. (The old
        // comment here claimed "same circuit name for both TD1 and TD3 —
        // the circuit doesn't care about MRZ format". It does care. It was
        // never exercised because Step 7 routed every TD1 to the light path.)
        //
        // Names come from HEAVY_CIRCUIT_NAMES so the registration key, the
        // getBundledCircuit lookup in generateHeavyNoirProof, and the string
        // the on-chain zkType is derived from can't drift apart — see the
        // header comment in utils/heavy-circuits.ts.
        //
        // The TD1 file is PINNED to the bundled asset rather than resolved
        // from Rarimo's CDN/registry: it isn't published there (Rarimo never
        // shipped a heavy TD1 register circuit), it was supplied directly by
        // the circuit author. Per his instruction — "for now instead of
        // loading by type just hardcode this circuit".
        //
        // The registration itself (and the ~6.25 MB bundle-weight note that
        // goes with it) lives in utils/register-bundled-circuits.ts, so the
        // french-id-test dev screen — which reaches the prover without ever
        // mounting this flow — can make the same call.
        // Named explicitly: registering a circuit retains it twice, once as
        // the parsed module and once as the SDK's stringified copy, so the
        // flow asks for the two REGISTER circuits and nothing a dev screen
        // might add later. See the header note in
        // utils/register-bundled-circuits.ts.
        const { registerHeavyBundledCircuits, REGISTER_CIRCUIT_NAMES } = await import(
          '@/utils/register-bundled-circuits'
        );
        await registerHeavyBundledCircuits(REGISTER_CIRCUIT_NAMES);

        // A newer scan replaced the attempt while this init was loading the
        // circuits: its own init will build the instance for its own key.
        if (attemptKeyRef.current !== attempt) return;

        // Pick the right contract / RPC bundle for the currently-active
        // network. The whole Rarime + FreedomTool pair has to share a network
        // (mixing them would point getDocumentStatus and getProposalInfo at
        // different chains and silently break vote-eligibility checks).
        console.log(`[FreedomTool] Initialising for network=${network}`);
        const rarimeCfg = getRarimeConfig(network);
        const ftCfg = getFreedomToolConfig(network);

        const rarime = new RarimeClass({
          ...rarimeCfg,
          userConfiguration: { userPrivateKey: attempt.privateKey },
        });
        rarimeRef.current = rarime;
        sdkAttemptRef.current = attempt;

        const ft = new FT(ftCfg);
        freedomToolRef.current = ft;
        // Re-render now so Step 7 receives `rarime` at once, instead of at
        // whatever render happens next (the proposal cache read below, an
        // AsyncStorage reply). Dossier 2.0.2, item 5 d.
        setRarimeReady(true);

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
  }, [currentStep, targetProposalId, network, passportKeyReady]);

  // Whether this run's vote has left the phone (Step11 reported success).
  // From then on the run's log lines are purged: at success, and again when
  // the run is left (utils/logger.ts::purgeVoteTrace, item 1 b / R8).
  const voteSentRef = useRef(false);
  // The trace starts at the first render, not at the focus effect: the mount
  // effects above ("document=… → proposal #…", the early hydration) log
  // before any focus effect runs. The first focus keeps this mark; a later
  // re-focus (a new run on the same mount) sets a new one.
  const traceMarkedAtMountRef = useRef<boolean | null>(null);
  if (traceMarkedAtMountRef.current === null) {
    traceMarkedAtMountRef.current = true;
    beginVoteTrace();
  }
  const leaveVoteTrace = useCallback(() => {
    if (voteSentRef.current) {
      voteSentRef.current = false;
      void purgeVoteTrace();
    }
    // The mark is left as it is: the next run sets its own, and clearing it
    // here could clear the NEXT run's mark when "vote another" mounts the new
    // screen before this one's cleanup runs.
  }, []);

  // Reset state when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Reset to step 1 when screen is focused
      // Every line from here on belongs to this run's vote trace, which is
      // purged from the log once a vote has left (utils/logger.ts).
      voteSentRef.current = false;
      if (traceMarkedAtMountRef.current) traceMarkedAtMountRef.current = false;
      else beginVoteTrace();
      console.log('[flow] step → 1 (focus-reset)');
      // A new run of the flow: whatever the previous run still has in
      // flight (an NFC hand-off, a key lookup) must not land in this one.
      flowGeneration.next();
      // A report sent from this run must never carry the previous run's
      // proof (utils/vote-artifacts.ts).
      clearArtifacts();
      setCurrentStep(1);
      setVerificationResult(null);
      setVoteTxId(null);
      // Cleared with the rest: a second run over an already-registered
      // document must not inherit the first run's backup notice.
      setJustRegistered(false);
      setKeyLinkedToOtherDocument(false);
      setAccessKey(null);
      setNFCData(null);
      // Critical: clear the manual-input modal flag too. If the user backed
      // out of the flow while the modal was open, this would otherwise stay
      // `true` and keep Step 5's camera disabled on re-entry (Step 5's
      // isActive is gated on `!isManualInputVisible`).
      setIsManualInputVisible(false);
      setCameraPrefill(null);
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
      // A resolution still running for the previous attempt must not install
      // its key into this one: flowGeneration.next() above already made it
      // stale (R1, utils/attempt-generation.ts).
      attemptKeyRef.current = null;
      setKeyResolutionError(null);
      // A new run checks its document against its proposal again.
      earlyCheckDoneRef.current = null;

      // Reset animations
      slideAnim.setValue(0);
      progressOpacity1.setValue(1);
      progressOpacity2.setValue(0.25);

      return () => {
        // Cleanup when screen loses focus
        flowGeneration.next();
        pauseAll();
        // Leaving a run that voted: its lines written after the vote (step
        // 12, the confirmation, the close) go too.
        leaveVoteTrace();
      };
    }, [pauseAll, slideAnim, progressOpacity1, progressOpacity2, leaveVoteTrace, setCurrentStep, flowGeneration])
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
    // Screen 3 was dropped on a beta tester's report (21 Aug), so step 2's
    // arrow goes straight to step 4.
    //
    // The step numbers are deliberately left alone rather than renumbered.
    // Every transition below hardcodes its own index, its slide offset
    // (-(n-1) * containerWidth) and its handleStepChange() argument, and
    // useModalVideoPlayers maps players by the same numbers — roughly a dozen
    // arithmetic sites, none of which can be verified without a device. Step 3
    // simply becomes unreachable, and the slide array keeps a spacer in its
    // place so every offset after it stays correct.
    // Read from the ref, not the closure: two events in one render (a double
    // tap, a late NFC result) used to both advance from the same stale step.
    const fromStep = currentStepRef.current;
    const newStep = fromStep === 2 ? 4 : fromStep + 1;
    // Step-transition audit trail: the #54 step-skip reports (2026-06-11/12)
    // showed users reaching the vote screens with no visible path in the
    // logs. Every transition now logs its source so the 5-min error-report
    // tail can name the jumper outright.
    console.log(`[flow] step ${fromStep} → ${newStep} (next)`);
    setCurrentStep(newStep);

    Animated.timing(slideAnim, {
      toValue: -(newStep - 1) * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    handleStepChange(newStep);

    // Light the Nth bar when entering step N. Bar 1 is already lit at init, so
    // step 1 → 1 bar and step 2 → 2 bars. There is no third bar since screen 3
    // was dropped, and step 4 hides the nav entirely.
    if (newStep === 2) {
      Animated.timing(progressOpacity2, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [slideAnim, containerWidth, handleStepChange, progressOpacity1, progressOpacity2, setCurrentStep]);

  // An event that belongs to another step than the current one is dropped
  // (item 5). Only the handler name and the step are logged, never the
  // payload: a stray NFC result stringified would carry DG1 bytes.
  const isAtStep = useCallback((expected: number, handler: string) => {
    if (currentStepRef.current === expected) return true;
    console.log(`[flow] ${handler} ignored at step ${currentStepRef.current} (expected ${expected})`);
    return false;
  }, []);

  // Step 4's start button. Waits for the NFC hardware answer if it is not in
  // yet (a local call, a few ms), and stays on step 4 when there is no
  // reader: Step 4 shows why.
  const handleStartAnalysis = useCallback(async () => {
    if (!isAtStep(4, 'start-analysis')) return;
    const present = await (nfcHardwareCheck.current ?? Promise.resolve(null));
    if (present === false) {
      setNfcHardware(false);
      return;
    }
    if (!isAtStep(4, 'start-analysis')) return;
    handleNext();
  }, [handleNext, isAtStep]);

  // Passports: the three MRZ fields, typed — or camera-read and confirmed.
  const handleMRZScanned = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    if (!isAtStep(5, 'mrz-entered')) return;
    setAccessKey({ kind: 'mrz', ...data });
    handleNext();
  }, [handleNext, isAtStep]);

  // ID cards: the CAN alone opens the chip (PACE with the CAN password).
  const handleCanEntered = useCallback((can: string) => {
    if (!isAtStep(5, 'can-entered')) return;
    setAccessKey({ kind: 'can', can });
    handleNext();
  }, [handleNext, isAtStep]);

  const handleNFCSuccess = useCallback((data: PassportData) => {
    if (!isAtStep(6, 'nfc-success')) return;
    // A new document read is a new attempt: a key lookup still running for
    // an earlier read must not overwrite this one's passport or key gate.
    const attempt = flowGeneration.next();
    const stale = () => !flowGeneration.isCurrent(attempt);
    setNFCData(data);
    // No key, and so no SDK instance, belongs to the attempt until this scan's
    // own resolution lands: Step 7 must not start on the previous scan's pair.
    attemptKeyRef.current = null;
    sdkAttemptRef.current = null;
    rarimeRef.current = null;
    freedomToolRef.current = null;
    setRarimeReady(false);
    setPassportKeyReady(false);
    setKeyResolutionError(null);

    // Create RarimePassport from NFC data. dg1Bytes / sodBytes are already
    // Uint8Arrays (decoded in modules/e-document/index.ts) — no base64 step.
    (async () => {
      try {
        const { RarimePassport: RP } = await import('@rarimo/rarime-rn-sdk');
        if (stale()) return;
        const dg1 = new Uint8Array(data.dg1Bytes);
        const sod = new Uint8Array(data.sodBytes);
        passportRef.current = new RP({ dataGroup1: dg1, sod });
        console.log('[FreedomTool] RarimePassport created, dg1.length:', dg1.length);

        // Resolve (and lazily generate) the BJJ key bound to THIS document.
        // Multiple documents on the same phone each get their own identity;
        // the same document rescanned recovers its existing key. identity.ts
        // still mirrors it into the legacy single-key slot (storage format
        // unchanged), but nothing in this flow reads that slot any more: the
        // resolved key is kept as a value for this attempt (R2).
        try {
          const { resolveAttemptKey } = await import('@/utils/attempt-key');
          // No `label` arg — the previous wiring stored the MRZ document
          // number in the on-device key DB as a display aid for backups,
          // but that's PII we don't want at rest. See
          // utils/passport-key-db.ts::PassportKeyEntry.
          // DG11 is what lets a passport and an ID card belonging to the same
          // person share one key (utils/universal-person-key.ts). Optional on
          // the chip, so optional here; a document without one keeps a key
          // of its own, exactly as before.
          const dg11 = data.dg11Bytes ? new Uint8Array(data.dg11Bytes) : undefined;
          const { key: attemptKey, resolved } = await resolveAttemptKey({ dg1, sod, dg11 });
          // Superseded (flow left, or another document read since): its
          // state belongs to the newer attempt now.
          if (stale()) {
            console.log('[FreedomTool][passport-key] superseded attempt, result dropped');
            return;
          }
          setKeyLinkedToOtherDocument(resolved.linkedToExisting);
          // SECURITY: even truncated, the passport hash + key prefix
          // together act as a stable per-user fingerprint in logcat.
          // Keep the boolean flags in release (useful for triage) and
          // gate the bytes behind __DEV__.
          if (__DEV__) {
            console.log(
              `[FreedomTool][passport-key] hash=${resolved.passportHash.slice(0, 12)}… ` +
              `key=${resolved.privateKey.slice(0, 8)}… isNew=${resolved.isNew} ` +
              `migratedFromLegacy=${resolved.migratedFromLegacy} ` +
              `linkedToExisting=${resolved.linkedToExisting} dg11=${dg11 ? dg11.length + 'B' : 'absent'}`,
            );
          } else {
            console.log(
              `[FreedomTool][passport-key] isNew=${resolved.isNew} ` +
              `migratedFromLegacy=${resolved.migratedFromLegacy} ` +
              `linkedToExisting=${resolved.linkedToExisting} dg11=${dg11 ? 'present' : 'absent'}`,
            );
          }
          // Where this attempt's key came from, and nothing else about it.
          console.log(`[FreedomTool][passport-key] key source: ${attemptKey.keySource}`);
          attemptKeyRef.current = attemptKey;

          // The CSCA cache is no longer pre-warmed here. It is needed only to
          // REGISTER a document, so Step 7 starts it once the status read says
          // NotRegistered (dossier 2.0.2, item 5 e / R9): warming it for a
          // document that is already registered cost a 32 s parse on low-end
          // Android for nothing, raced the SDK init, and was then released
          // while still building.

          // Force the SDK refs to be re-created against this attempt's key on
          // the next Rarime init pass (same trick we use when the user flips
          // testnet/mainnet in Settings).
          rarimeRef.current = null;
          freedomToolRef.current = null;
          sdkAttemptRef.current = null;
          setRarimeReady(false);
          // ONLY now signal the Rarime init useEffect that the attempt's key
          // is known.
          setPassportKeyReady(true);
        } catch (e: any) {
          if (stale()) return;
          console.warn('[FreedomTool][passport-key] lookup/create failed:', e?.message ?? e);
          // Stop here (dossier 2.0.2, item 14 f). This used to fall through
          // with whatever the legacy slot held, so the status check and the
          // registration proof could run with another document's key; the
          // registration is irreversible. Step 7 shows the message and the
          // SDK is never built without this document's own key.
          setKeyResolutionError(
            t('voting.errors.keyResolutionFailed', {
              defaultValue:
                "La clé de ce document n'a pas pu être lue sur ce téléphone. Fermez puis relancez le vote. Si le message revient, écrivez-nous.",
            }),
          );
        }
      } catch (err) {
        console.error('[FreedomTool] PASSPORT_CREATE_FAILED', err);
      }
    })();

    handleNext();
  }, [handleNext, isAtStep, flowGeneration, t]);

  // Back from the chip read to Step 5 — the form or the CAN field, which each
  // keep what was typed so one digit can be corrected.
  const handleGoBackToStep5 = useCallback(() => {
    if (!isAtStep(6, 'back-to-entry')) return;
    flowGeneration.next();
    console.log('[flow] step → 5 (back-to-entry)');
    setCurrentStep(5);
    setAccessKey(null);
    Animated.timing(slideAnim, {
      toValue: -4 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(5);
  }, [slideAnim, containerWidth, handleStepChange, isAtStep, flowGeneration, setCurrentStep]);

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

  // Passports: typing the three fields is the main entry and the camera the
  // secondary one (project decision, 2026-09-09, after a tester reached the
  // chip with a misread MRZ three times). Entering Step 5 opens the form; "scan with the
  // camera" closes it; a camera read reopens it, filled in, for the user to
  // check. The camera itself is paused while the form is up.
  useEffect(() => {
    if (currentStep === 5 && isPassportFlow) setIsManualInputVisible(true);
  }, [currentStep, isPassportFlow]);

  // A camera read is never accepted on its own — it fills the form. The camera
  // hands over MRZ YYMMDD dates; the fields hold JJMMAA.
  const handleCameraRead = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    setCameraPrefill({
      documentNumber: data.documentNumber,
      birthDate: mrzDateToFrench(data.birthDate),
      expiryDate: mrzDateToFrench(data.expiryDate),
    });
    setIsManualInputVisible(true);
  }, []);

  const verificationHandledRef = useRef(false);
  const handleVerificationSuccess = useCallback((didRegister?: boolean) => {
    if (verificationHandledRef.current) return;
    verificationHandledRef.current = true;
    setVerificationResult('success');
    // Remembered for Step 12's backup notice. Only a first registration sets
    // it — a document that was already bonded has had its key for a while and
    // does not need to be told again on every vote.
    if (didRegister) setJustRegistered(true);
    // Move to step 8 (voting screen) after a brief delay, unless the flow
    // was left or restarted meanwhile (rule R1: deferred step changes).
    const attempt = flowGeneration.current();
    setTimeout(() => {
      if (!flowGeneration.isCurrent(attempt) || currentStepRef.current !== 7) {
        console.log(`[flow] verification-success hand-off dropped at step ${currentStepRef.current}`);
        return;
      }
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

  // Every Step 7 failure ends on Step 7, which renders its own message and the
  // report button; the user leaves through the top-right X. This used to move
  // "non-fatal" errors on to Step 8 after 1.5 s and rely on a Step9Error slide
  // to explain — but that slide was appended after the last step of the
  // carousel, so it sat off-screen, and what the user actually saw was Step 8
  // with a "vote now" button that silently refused to work (2026-09-08 test
  // night, both testers). No error Step 7 can raise is one the vote could
  // survive, so nothing is lost by never advancing.
  // Step 7 re-read the status with an instance rebuilt for this document's
  // key and the chain confirmed it (item 14 b): the vote must use that same
  // instance and key. Ignored if the attempt has moved on to another document.
  const handleSdkRebuilt = useCallback((rebuilt: Rarime, key: AttemptKey) => {
    if (sdkAttemptRef.current?.passportHash !== key.passportHash) return;
    rarimeRef.current = rebuilt;
    sdkAttemptRef.current = key;
    attemptKeyRef.current = key;
  }, []);

  const handleVerificationError = useCallback((message?: string, error?: unknown) => {
    const detail = message ?? (error instanceof Error ? error.message : String(error ?? ''));
    console.warn(`[flow] step 7 failed — staying on step 7: ${detail}`);
  }, []);

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

  // Post-vote screen: start a fresh flow for a different referendum. Dismiss
  // first rather than replacing the route — this screen *is* the voting flow,
  // and replacing it in place would keep the component mounted at step 12 with
  // only the proposal id swapped underneath it.
  //
  // The same eligibility rule as the card that offers it (R7): a stale cache,
  // a direct route or an old build's suggestion cannot start a flow on a
  // question this document cannot vote. Local lists only; a refusal simply
  // lands the voter back on the home list, which never offers it.
  const handleVoteAnother = useCallback(
    (proposalId: string, cardProposalId?: string) => {
      pauseAll();
      // Before the new run's focus-reset sets its own trace mark.
      leaveVoteTrace();
      router.back();
      const document = isPassportFlow ? 'passport' : 'idCard';
      const targetId = document === 'idCard' && cardProposalId ? cardProposalId : proposalId;
      (async () => {
        const [index, target] = await Promise.all([
          readLocalProposalIndex(),
          findCachedProposal(network, targetId),
        ]);
        const verdict = target
          ? checkVoteEligibility(target, document, localEligibilityContext(index, network, devAllowed))
          : ({ ok: false, reason: 'not-listed' } as const);
        if (!verdict.ok) {
          console.log(`[flow] vote-another refused locally: #${targetId} ${verdict.reason}`);
          return;
        }
        router.push({
          pathname: '/voting-flow',
          params: cardProposalId ? { proposalId, cardProposalId } : { proposalId },
        });
      })().catch(() => console.warn('[flow] vote-another: local lists unreadable'));
    },
    [router, pauseAll, leaveVoteTrace, isPassportFlow, network, devAllowed],
  );

  // Step 8 offers this when it is shown without a verified registration — a
  // state Step 7 no longer produces, kept as a fallback for whatever jump path
  // the 2026-06 reports were hitting. Re-entering the flow is the only restart
  // that is guaranteed clean: the scan bytes, the key gate, Step 7's latches
  // and the SDK refs are all reset by the mount, exactly as for "vote on
  // another referendum" above.
  const handleRestart = useCallback(() => {
    console.log('[flow] restart requested from step 8 (unverified)');
    handleVoteAnother(proposalIdParam || getDefaultProposalId(network), cardProposalIdParam);
  }, [handleVoteAnother, proposalIdParam, cardProposalIdParam, network]);

  // Post-vote screen: swap the modal for the Vérifier tab, where the user can
  // look their vote up by serial number.
  const handleGoToVerify = useCallback(() => {
    pauseAll();
    router.replace('/verifier');
  }, [router, pauseAll]);

  // Post-vote screen: send the user to key management to export a backup.
  // `replace` rather than `push` for the same reason handleGoToVerify uses it —
  // leaving the voting modal underneath means a back gesture lands them in a
  // finished flow. Key management is reachable from Settings afterwards, so
  // nothing is lost by closing the modal here.
  const handleBackupKey = useCallback(() => {
    pauseAll();
    router.replace('/key-management');
  }, [router, pauseAll]);

  const [voteTxId, setVoteTxId] = useState<string | null>(null);
  // false when the tx was submitted but not yet confirmed on-chain at timeout —
  // Step12Success then shows a neutral "awaiting confirmation" message instead
  // of a definitive green success. A reverted tx never reaches here (→ error).
  const [voteConfirmed, setVoteConfirmed] = useState(true);
  const handleStep11Success = useCallback((txHash: string, confirmed: boolean) => {
    setVoteTxId(txHash);
    setVoteConfirmed(confirmed);
    // Tell the home tab a vote landed so it knows to do an extra delayed
    // refresh once tx propagation completes (the immediate focus-time
    // refetch races ahead of L2 confirmation otherwise).
    markVoteJustCast();
    console.log('[flow] step → 12 (vote-submitted)');
    // The vote has left: from here, a report must not be able to place it in
    // time. Drop this run's lines, this one included, from the buffer and the
    // crash tail. Must stay AFTER every log line of this handler.
    voteSentRef.current = true;
    void purgeVoteTrace();
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
  const [voteRetryable, setVoteRetryable] = useState(false);
  const [voteReportable, setVoteReportable] = useState<boolean | undefined>(undefined);
  const handleStep11Error = useCallback((reason?: string, error?: unknown, code?: VoteErrorCode) => {
    setVoteErrorReason(reason || null);
    setVoteError(error ?? new Error(reason ?? 'Unknown vote error'));
    // The table decides, by code, independently of the language the reason
    // was written in. The text scan is only the fallback for a caller that
    // passes no code.
    const entry = code ? VOTE_ERROR_TABLE[code] : undefined;
    setVoteRetryable(entry ? entry.retryable : !isTerminalVoteError(reason, error));
    setVoteReportable(entry?.reportable);
    console.log('[flow] step → 13 (vote-error)');
    // The ballot may be on chain (lost answer after the POST, reverted tx):
    // Step11 purged its lines already; this one goes too, and leaving the run
    // purges again, exactly as after a success (R8 with R4).
    if (code && ballotMayBeOnChain(code, error)) {
      voteSentRef.current = true;
      void purgeVoteTrace();
    }
    setCurrentStep(13);
    Animated.timing(slideAnim, {
      toValue: -12 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(13);
  }, [slideAnim, containerWidth, handleStepChange]);

  // Retry the vote alone, from step 13 back to step 11.
  //
  // Nothing on the error path clears `passport` / `rarime` / `proposalInfo` /
  // `selectedVote`, and Step11 is unmounted while step 13 is on screen (the
  // carousel only mounts steps within ±1), so it remounts with hasStarted
  // false and starts a fresh submit on its own — no reset plumbing needed.
  const handleVoteRetry = useCallback(() => {
    console.log('[flow] retry requested from step 13 → step 11 (vote only)');
    setVoteErrorReason(null);
    setVoteError(null);
    setVoteRetryable(false);
    setVoteReportable(undefined);
    setCurrentStep(11);
    Animated.timing(slideAnim, {
      toValue: -10 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(11);
  }, [slideAnim, containerWidth, handleStepChange]);

  // Right after the document choice (R7): with the proposal hydrated early
  // from the home cache, check that this document may vote it before the
  // voter spends a scan and a registration on it. Only before step 7: from
  // there on Step 11 re-checks before the proof, and interrupting a
  // registration in flight is not this check's business. Local lists only.
  const earlyCheckDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chosenDocType || !proposalInfo || currentStep >= 7) return;
    if (String(proposalInfo.id) !== String(targetProposalId)) return;
    const checkKey = `${network}:${targetProposalId}:${chosenDocType}`;
    if (earlyCheckDoneRef.current === checkKey) return;
    let cancelled = false;
    (async () => {
      const index = await readLocalProposalIndex();
      if (cancelled) return;
      earlyCheckDoneRef.current = checkKey;
      const verdict = checkVoteEligibility(
        proposalInfo,
        chosenDocType,
        localEligibilityContext(index, network, devAllowed),
      );
      if (verdict.ok) return;
      const code = codeForIneligibility(verdict.reason);
      console.log(`[flow] proposal #${targetProposalId} refused locally for ${chosenDocType}: ${verdict.reason}`);
      handleStep11Error(voteErrorMessage(t, code, chosenDocType), new VoteRefusal(code), code);
    })().catch(() => console.warn('[flow] early eligibility check: local lists unreadable'));
    return () => {
      cancelled = true;
    };
  }, [chosenDocType, proposalInfo, targetProposalId, network, devAllowed, currentStep, handleStep11Error, t]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  // Shared iOS header close button, used by both the document-choice gate and
  // the step carousel below.
  //
  // iOS 26 (which we now build against — Xcode 26 SDK) gives every custom
  // nav-bar item a shared "Liquid Glass" background, which renders as a grey
  // capsule behind "Fermer" on the white sheet. `hidesSharedBackground` turns
  // that off, but it only reaches UIKit through `unstable_headerRightItems`,
  // and only on react-native-screens >= 4.17 — 4.16 (Expo SDK 54's pin) has no
  // implementation of it at all, in JS or native. See package.json.
  //
  // `headerRight` is deliberately kept alongside it: headerRightItems
  // overrides it wherever the newer API is understood, and it leaves a working
  // close button behind if this still-unstable API changes shape.
  const closeButton = (
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
  );
  const headerCloseOptions = {
    headerRight: () => closeButton,
    unstable_headerRightItems: () => [
      { type: 'custom' as const, element: closeButton, hidesSharedBackground: true },
    ],
  };

  // Gate screen: block entry into the numbered step carousel until the user
  // has picked a document type. Reuses the same outer chrome (safe-area
  // padding, status bar, iOS native header + Fermer) as the carousel below
  // so the transition into Step 1 feels seamless.
  if (!chosenDocType) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        {Platform.OS === 'ios' && (
          <Stack.Screen
            options={{
              title: t('voting.title'),
              ...headerCloseOptions,
            }}
          />
        )}
        <View
          style={styles.topSection}
          onLayout={(e) => setSlideAreaHeight(e.nativeEvent.layout.height)}
        >
          {Platform.OS !== 'ios' && (
            <View style={{ height: insets.top, backgroundColor: colors.cardBackground }} />
          )}
          {Platform.OS !== 'ios' && (
            <View style={modalStyles.titleSection}>
              <Text style={modalStyles.title}>{t('voting.title')}</Text>
            </View>
          )}
          <DocumentChoice
            slideAreaHeight={slideAreaHeight}
            onSelect={(isPassport) => setChosenDocType(isPassport ? 'passport' : 'idCard')}
          />
        </View>
      </View>
    );
  }

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
            ...headerCloseOptions,
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
                show(0) ? <Step1 key="s1" containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} isPassportFlow={isPassportFlow} /> : spacer('s1'),
                show(1) ? <Step2 key="s2" containerWidth={containerWidth} slideAreaHeight={slideAreaHeight} isPassportFlow={isPassportFlow} /> : spacer('s2'),
                // Screen 3 removed (see handleNext) — a spacer keeps every
                // later slide at the offset its transition already hardcodes.
                spacer('s3'),
                show(3) ? <Step4 key="s4" player={player1} containerWidth={containerWidth} slideAreaHeight={stepSlideHeight} onStartAnalysis={handleStartAnalysis} isPassportFlow={isPassportFlow} nfcUnsupported={nfcHardware === false} onExit={handleClose} /> : spacer('s4'),
                show(4) ? (
                  isPassportFlow ? (
                    <Step5
                      key="s5"
                      containerWidth={containerWidth}
                      // The camera is the secondary option: it only runs while
                      // the manual form is closed, never under the keyboard.
                      isActive={currentStep === 5 && !isManualInputVisible}
                      onMRZScanned={handleCameraRead}
                      onManualFill={handleManualFill}
                      isPassportFlow
                      // Gate MRZ-extracted nationality against the proposal's
                      // citizenship whitelist (empty / undefined → open to
                      // all countries).
                      allowedCitizenships={proposalInfo?.criteria.citizenshipWhitelist}
                    />
                  ) : (
                    // ID card: the CAN, no camera, no MRZ. Nationality is not
                    // pre-checked here; the vote proof enforces it from DG1.
                    <Step5Can
                      key="s5"
                      containerWidth={containerWidth}
                      // stepSlideHeight, not slideAreaHeight: on Android the latter includes
                      // the status-bar spacer and the box stood 24 dp too tall, its footer
                      // under the navigation bar (same fault as step 6 on 24/09; measured
                      // on 25/09 at 360 x 640, text size 1.3: "Continuer" 24 px under).
                      slideAreaHeight={stepSlideHeight}
                      isActive={currentStep === 5}
                      onSubmit={handleCanEntered}
                    />
                  )
                ) : spacer('s5'),
                show(5) ? (
                  <Step6
                    key="s6"
                    containerWidth={containerWidth}
                    // stepSlideHeight, not slideAreaHeight: on Android the
                    // measured topSection holds the status-bar spacer, and
                    // Step6 is the one step that boxes itself to exactly the
                    // height it is given. Given the unadjusted value it stood
                    // insets.top too tall and its footer ended under the
                    // navigation bar (3-button phones, 2026-09-24).
                    slideAreaHeight={stepSlideHeight}
                    player={player4}
                    accessKey={accessKey}
                    onNFCSuccess={handleNFCSuccess}
                    onGoBack={handleGoBackToStep5}
                    isPassportFlow={isPassportFlow}
                    // Leaving step 6 cancels the scan and releases the
                    // reader (item 11 B).
                    isActive={currentStep === 6}
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
                    rarime={rarimeReady ? rarimeRef.current ?? undefined : undefined}
                    attemptKey={rarimeReady ? sdkAttemptRef.current ?? undefined : undefined}
                    initError={keyResolutionError}
                    onSdkRebuilt={handleSdkRebuilt}
                    onRestart={handleRestart}
                    slideAreaHeight={stepSlideHeight}
                    passport={passportRef.current ?? undefined}
                    freedomTool={freedomToolRef.current ?? undefined}
                    network={network}
                    isPassportFlow={isPassportFlow}
                    keyLinkedToOtherDocument={keyLinkedToOtherDocument}
                    proposalId={targetProposalId}
                  />
                ) : spacer('s7'),
                show(7) ? (
                  <Step8
                    key="s8"
                    containerWidth={containerWidth}
                    verificationResult={verificationResult}
                    onVoteSuccess={handleVoteSuccess}
                    onRestart={handleRestart}
                  />
                ) : spacer('s8'),
                show(8) ? (
                  <Step9Vote
                    key="s9v"
                    containerWidth={containerWidth}
                    onVoteSelect={handleVoteSelect}
                    onCancel={handleStep9Cancel}
                    proposalInfo={proposalInfo ?? undefined}
                    slideAreaHeight={stepSlideHeight}
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
                    slideAreaHeight={stepSlideHeight}
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
                    isPassportFlow={isPassportFlow}
                    privateKey={sdkAttemptRef.current?.privateKey}
                    devAllowed={devAllowed}
                    slideAreaHeight={stepSlideHeight}
                  />
                ) : spacer('s11'),
                show(11) ? (
                  <Step12Success
                    key="s12s"
                    containerWidth={containerWidth}
                    slideAreaHeight={stepSlideHeight}
                    voteIdentifier={voteTxId ?? undefined}
                    confirmed={voteConfirmed}
                    proposalInfo={proposalInfo ?? undefined}
                    answerIndex={selectedVote}
                    network={network}
                    onVoteAnother={handleVoteAnother}
                    onVerify={handleGoToVerify}
                    onClose={handleClose}
                    justRegistered={justRegistered}
                    onBackupKey={handleBackupKey}
                    isPassportFlow={isPassportFlow}
                    devAllowed={devAllowed}
                  />
                ) : spacer('s12s'),
                show(12) ? (
                  <Step12Error
                    key="s12e"
                    containerWidth={containerWidth}
                    onGoHome={handleClose}
                    onRetry={voteRetryable ? handleVoteRetry : undefined}
                    errorReason={voteErrorReason}
                    error={voteError}
                    isPassportFlow={isPassportFlow}
                    reportable={voteReportable}
                    slideAreaHeight={stepSlideHeight}
                  />
                ) : spacer('s12e'),
              ];
            })()}
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
            </View>
            <TouchableOpacity
              style={styles.arrowButton}
              onPress={handleNext}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('common.next')}
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
        isPassportFlow={isPassportFlow}
        initialValues={cameraPrefill}
        notice={cameraPrefill ? t('mrzManual.cameraPrefilled') : undefined}
        secondaryLabel={isPassportFlow ? t('mrzManual.scanWithCamera') : undefined}
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
