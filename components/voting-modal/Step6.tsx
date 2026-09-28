import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image, ScrollView, Alert, Linking, AppState } from 'react-native';
import NfcManager from 'react-native-nfc-manager';
import { createModalStyles, createStepSpecificStyles, slideFrameStyle } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { getRandomValues } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useDevMode } from '@/contexts/DevModeContext';
import {
  createNfcScanOwner,
  ANDROID_MIN_GAP_MS,
  IOS_RETRY_COOLDOWN_MS,
  type CancelReason,
} from '@/utils/e-document/nfc-scan-owner';
import { classifyScanError, describeNativeError, scanErrorKey } from '@/utils/e-document/scan-error';
import { createMilestoneLog, type MilestoneName } from '@/utils/e-document/nfc-milestones';
import type { AttemptToken } from '@/utils/attempt-generation';
import {
  type DocumentAccessKey,
  describeAccessKey,
  toScanParameters,
} from '@/utils/document-access-key';
import { ErrorReportButton } from '@/components/ErrorReportButton';
import FadeInImage from '@/components/FadeInImage';

interface Step6Props {
  containerWidth: number;
  player: any;
  /** What opens the chip: the MRZ key for a passport, the CAN for an ID card. */
  accessKey?: DocumentAccessKey | null;
  onAnalyze?: () => void;
  onNFCSuccess?: (data: any) => void;
  onNFCError?: () => void;
  onGoBack?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Available slide-area height; caps the iOS ScrollView so the buttons
   * under the picture and the tips can be reached by scrolling. */
  slideAreaHeight?: number;
  /** True = scan a TD3 passport (scanDocument 'P', Type B + BAC). False
   * = scan a TD1 ID card (scanDocument 'I', Type A + PACE). Driven by
   * the selected proposal's voting contract via voting-flow.tsx. */
  isPassportFlow?: boolean;
  /** True while step 6 is the current step. Step 6 stays mounted at steps 5
   * and 7 (±1 rule in voting-flow.tsx); turning false cancels any scan and
   * releases the reader, so it never stays armed off-screen (item 11 B). */
  isActive?: boolean;
}

const Step6: React.FC<Step6Props> = ({ containerWidth, player, accessKey, onAnalyze, onNFCSuccess, onNFCError, onGoBack, onLayout, slideAreaHeight, isPassportFlow = false, isActive = true }) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const { devMode } = useDevMode();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [isScanning, setIsScanning] = useState(false);
  // True once the native RequestPresentPassport event has actually fired for
  // the current attempt — i.e. the reader is armed and it's genuinely time to
  // present the document. isScanning alone goes true well before that (right
  // at the top of handleAnalyzePress, and Android additionally waits up to 5s
  // there for camera-teardown settling), so gating the "keep it close" caption
  // on isScanning alone showed it during that init/settling window, before the
  // "present your document" prompt had even appeared. A ref is enough — it
  // just needs to be true by the time the setScanStatus call right next to it
  // triggers the re-render that reads it.
  const hasPromptedPresentRef = useRef(false);
  const [scanStatus, setScanStatus] = useState("");
  // Android-only smooth progress bar. iOS has no equivalent — the native NFC
  // system sheet (EDocumentModule.swift's customDisplayMessage) is the only
  // progress UI there, so there's nothing to drive an in-app bar with.
  const [nfcProgress, setNfcProgress] = useState(0);
  const progressQueueRef = useRef<number[]>([]);
  const isProcessingProgressRef = useRef(false);
  // Highest % reached so far (never goes backwards) and a tick counter so the
  // long data-group read phase keeps creeping forward instead of sitting at a
  // fixed value — Android reports no per-event percentage.
  const lastProgressRef = useRef(0);
  const readTickRef = useRef(0);
  const [showRetry, setShowRetry] = useState(false);
  // True when we believe the user is holding the other document type — a
  // passport during an ID-card (CNIe) flow or vice versa. The named state lets
  // the UI render a "please use your ID card" hint instead of a generic NFC
  // error. Set from either the DG1-length check or the error-text guess below.
  const [passportDetected, setPassportDetected] = useState(false);
  // True only when the mismatch is *proven* by the chip's own DG1 length. A
  // mismatch merely guessed from the native error text still shows the banner
  // but must keep the retry button, because that guess can be wrong — see
  // utils/e-document/wrong-document.ts.
  const [docMismatchConfirmed, setDocMismatchConfirmed] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  // The raw failure, kept so the user can mail us a diagnostic report. Step 6
  // is where NFC reads fail — by far the most common failure in the flow — but
  // it was the one error screen with no way to report anything, so every scan
  // problem had to be described from memory instead of read off a log.
  const [scanError, setScanError] = useState<unknown>(null);
  const [nativeLogs, setNativeLogs] = useState<string[]>([]);
  // The chip refused the CAN: "Modifier le numéro CAN" becomes the first
  // button, since one wrong digit is the likeliest cause (item 11 D).
  const [canRejected, setCanRejected] = useState(false);
  // The read succeeded and the result is being handed to step 7 (the 500 ms
  // below). "Lancer l'analyse" stays disabled meanwhile: a tap there started
  // a new attempt and the hand-off to step 7 was lost (QA 2.0.2, item 10).
  const [handingOff, setHandingOff] = useState(false);
  const handingOffRef = useRef(false);
  // No CAN / MRZ to open the chip with: the only useful action is to go back
  // and type it, so that button is offered (QA 2.0.2, item 11).
  const [missingAccess, setMissingAccess] = useState(false);
  // iOS only: Retry stays disabled 3 s after a failure or a cancel. A retry
  // within a second or two of a dying CoreNFC session is what produced the
  // UnexpectedError bursts (item 11 C).
  const [coolingDown, setCoolingDown] = useState(false);
  /** The slide's scroll, so a failure message can be brought into view. */
  const scrollRef = useRef<ScrollView>(null);
  const coolingDownRef = useRef(false);
  const coolDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The scan owns its wait (rule R11): cancelling, leaving the step or
  // unmounting settles it, clears its timers and releases the reader; late
  // native callbacks of an older attempt are dropped by its token.
  const ownerRef = useRef<ReturnType<typeof createNfcScanOwner> | null>(null);
  if (ownerRef.current === null) {
    ownerRef.current = createNfcScanOwner({
      platform: Platform.OS,
      cancelNative: async () => {
        const { cancelScan } = await import('@/modules/e-document');
        await cancelScan();
      },
    });
  }
  const owner = ownerRef.current;
  const isActiveRef = useRef(isActive);
  const isScanningRef = useRef(false);
  const setScanning = (value: boolean) => {
    isScanningRef.current = value;
    setIsScanning(value);
  };
  // Deferred hand-offs (the 500 ms success, the 1 500 ms back-to-entry): run
  // only while their attempt is current and the step still active.
  const deferredRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const deferWhileCurrent = (token: AttemptToken, ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      deferredRef.current.delete(id);
      if (owner.isCurrent(token) && isActiveRef.current) fn();
    }, ms);
    deferredRef.current.add(id);
  };
  const clearDeferred = () => {
    deferredRef.current.forEach((id) => clearTimeout(id));
    deferredRef.current.clear();
  };
  const milestonesRef = useRef(createMilestoneLog());
  const logMilestone = (name: MilestoneName) => {
    // The event payload is never read: names and durations only (item 11 F).
    const line = milestonesRef.current.line(name);
    if (line) console.log(line);
  };

  const startCoolDown = () => {
    if (Platform.OS !== 'ios') return;
    if (coolDownTimerRef.current) clearTimeout(coolDownTimerRef.current);
    coolingDownRef.current = true;
    setCoolingDown(true);
    coolDownTimerRef.current = setTimeout(() => {
      coolDownTimerRef.current = null;
      coolingDownRef.current = false;
      setCoolingDown(false);
    }, IOS_RETRY_COOLDOWN_MS);
  };

  // Cancel button, leaving the step, unmounting: one path. Returns the
  // screen to the Retry state when something was in flight.
  const releaseScan = (reason: Exclude<CancelReason, 'superseded'>, updateUi = true) => {
    const hadAttempt = owner.cancel(reason);
    clearDeferred();
    milestonesRef.current.end();
    retryAfterNfcRef.current = false;
    const wasScanning = isScanningRef.current;
    if (!updateUi || !(hadAttempt || wasScanning)) return;
    console.log(`[Step6] scan ${reason === 'left' ? 'released on leaving the step' : 'cancelled by the user'}`);
    setScanning(false);
    setShowRetry(true);
    setScanStatus(reason === 'cancelled' ? t('voting.step6Cancelled') : '');
    startCoolDown();
  };

  // Android camera2 teardown (from Step 5) can take 2-3s and shares NFC-controller
  // resources on some SoCs. Track when Step 6 mounted so we can enforce a minimum
  // gap before the NFC scan starts — prevents "Tag was lost" on the first APDU.
  const mountedAtRef = useRef<number>(Date.now());
  useEffect(() => { mountedAtRef.current = Date.now(); }, []);

  // NFC-disabled auto-retry: when the user taps "Open NFC settings" in the
  // dialog we surface below, we arm this ref. The AppState listener fires
  // when the app foregrounds; if NFC is now on, it re-invokes the scan via
  // the ref'd handler (kept fresh each render to avoid stale-closure bugs).
  const retryAfterNfcRef = useRef(false);
  const handleAnalyzePressRef = useRef<() => void>(() => {});

  // --- Progress queue (smooth Android progress bar) ---
  const processProgressQueue = useCallback(() => {
    if (progressQueueRef.current.length === 0) {
      isProcessingProgressRef.current = false;
      return;
    }
    isProcessingProgressRef.current = true;
    const next = progressQueueRef.current.shift()!;
    setNfcProgress(next);
    setTimeout(() => processProgressQueue(), 400);
  }, []);

  const queueProgressUpdate = useCallback(
    (value: number) => {
      if (Platform.OS !== 'android') return;
      // Single unified bar — ignore anything that would move it backwards.
      const next = Math.min(100, Math.round(value));
      if (next <= lastProgressRef.current) return;
      lastProgressRef.current = next;
      progressQueueRef.current.push(next);
      if (!isProcessingProgressRef.current) processProgressQueue();
    },
    [processProgressQueue]
  );

  // Listen to EDocument scan events
  useEffect(() => {
    let listeners: any[] = [];

    const setupEventListeners = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import('@/modules/e-document');

        listeners = [
          // Android: a chip came into the field (EDocumentModule.kt handleTag).
          EDocumentModuleListener(EDocumentModuleEvents.ScanStarted, () => {
            logMilestone('ScanStarted');
          }),
          EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
            logMilestone('RequestPresentPassport');
            setScanStatus(t(`voting.step6PresentCard_${docSfx}`));
            hasPromptedPresentRef.current = true;
            queueProgressUpdate(10);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            logMilestone('AuthenticatingWithPassport');
            setScanStatus(t('voting.step6Authenticating'));
            queueProgressUpdate(35);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            logMilestone('ReadingDataGroupProgress');
            setScanStatus(t('voting.step6Reading'));
            // Android reports no percentage, so creep 40 → 95 across the
            // repeated read events to keep the single bar moving.
            readTickRef.current += 1;
            queueProgressUpdate(Math.min(95, 40 + readTickRef.current * 5));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus(t('voting.step6ActiveAuth'));
            queueProgressUpdate(95);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            logMilestone('SuccessfulRead');
            setScanStatus(t('voting.step6ReadSuccess'));
            queueProgressUpdate(100);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            logMilestone('ScanError');
            setScanStatus(t('voting.step6ReadError'));
            progressQueueRef.current = [];
            isProcessingProgressRef.current = false;
            lastProgressRef.current = 0;
            readTickRef.current = 0;
            setNfcProgress(0);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.DebugLog, (event: unknown) => {
            const { message } = event as { message: string };
            // Raw native text: development builds only, never in the rolling
            // log that reports attach (plan D14, rule R8).
            if (__DEV__) console.log('[Step6/Native]', message);
            setNativeLogs((prev) => [...prev.slice(-40), message]);
          }),
        ];
      } catch (_error) {
        // Event listeners not available
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

  // Keep the ref pointed at the latest closure so the AppState listener below
  // doesn't capture a stale reference (props/state changes between mount and
  // the time the user returns from Settings).
  useEffect(() => {
    handleAnalyzePressRef.current = handleAnalyzePress;
  });

  // Auto-retry the scan when the user enables NFC and returns to the app.
  // Armed only after they tap "Open NFC settings" in the dialog above —
  // background → foreground without going through that path is a no-op.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', async (next) => {
      if (next !== 'active' || !retryAfterNfcRef.current || !isActiveRef.current) return;
      const enabled = await NfcManager.isEnabled().catch(() => false);
      if (!enabled) return;
      // Re-checked after the await: the step may have been left meanwhile,
      // and a scan started from here would arm the reader off-screen (R1).
      if (!retryAfterNfcRef.current || !isActiveRef.current) return;
      retryAfterNfcRef.current = false;
      // Small delay so the foreground transition completes before we start
      // touching the NFC controller again.
      const token = owner.currentToken();
      const id = setTimeout(() => {
        deferredRef.current.delete(id);
        if (owner.isCurrent(token) && isActiveRef.current) handleAnalyzePressRef.current();
      }, 200);
      deferredRef.current.add(id);
    });
    return () => sub.remove();
  }, []);

  // Leaving step 6 (back to 5, on to 7) releases the reader and settles the
  // scan's wait; so does unmounting. Without this an Android reader stayed
  // armed behind step 7 and answered a card presented later (item 11 B).
  useEffect(() => {
    isActiveRef.current = isActive;
    if (!isActive) releaseScan('left');
    // Back on step 6 (or a hand-off that never happened): a new read may start.
    if (isActive) {
      handingOffRef.current = false;
      setHandingOff(false);
    }
  }, [isActive]);

  useEffect(() => () => {
    isActiveRef.current = false;
    releaseScan('left', false);
    if (coolDownTimerRef.current) clearTimeout(coolDownTimerRef.current);
  }, []);

  const handleAnalyzePress = async () => {
    // One attempt at a time, only on screen, and (iOS) not during the retry
    // cool-down.
    if (!isActiveRef.current || coolingDownRef.current || owner.isBusy() || handingOffRef.current) return;
    // A cancel or a step change during any await below makes this stale.
    const pressToken = owner.currentToken();
    const stillOwner = () => owner.isCurrent(pressToken) && isActiveRef.current;

    // Operational only — no PII. The access key holds the MRZ fields or the
    // CAN, the chip's own credentials; only its kind is logged.
    console.log(`[Step6] handleAnalyzePress called, accessKey=${describeAccessKey(accessKey)}`);
    if (!accessKey) {
      setScanStatus(t(`voting.step6MissingAccess_${docSfx}`));
      setMissingAccess(true);
      return;
    }
    setMissingAccess(false);

    // Android-only: pre-check that NFC is enabled. The native scan path
    // throws IllegalStateException with a French-only message when it's off,
    // which surfaces as a cryptic Step6 error after the user already went
    // through MRZ + camera. Catching it here lets us guide them to the
    // system NFC toggle and auto-retry when they return.
    if (Platform.OS === 'android') {
      let isOff = false;
      try {
        await NfcManager.start();
        isOff = !(await NfcManager.isEnabled());
      } catch (e) {
        // Couldn't determine state (e.g., no NFC hardware) — let the native
        // module's own error path surface a clearer message downstream.
        console.warn(`[Step6] NFC pre-check failed ${describeNativeError(e, (e as any)?.code)}`);
      }
      if (!stillOwner()) return;
      if (isOff) {
        Alert.alert(
          t('voting.step6NfcDisabledTitle'),
          t('voting.step6NfcDisabledMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('voting.step6OpenNfcSettings'),
              onPress: async () => {
                retryAfterNfcRef.current = true;
                try {
                  await Linking.sendIntent('android.settings.NFC_SETTINGS');
                } catch {
                  // Fallback: open the app's own settings page. The user can
                  // still navigate from there.
                  await Linking.openSettings();
                }
              },
            },
          ],
        );
        return;
      }
    }

    // Scan NFC on the same screen for both platforms
    setScanning(true);
    setPassportDetected(false);
    setDocMismatchConfirmed(false);
    setCanRejected(false);
    setScanError(null);
    // Per-attempt reset — see the ref's declaration comment. Without this a
    // Retry would inherit `true` from the previous attempt and the "keep it
    // close" caption would flash immediately again, before this attempt's
    // own RequestPresentPassport event has fired.
    hasPromptedPresentRef.current = false;
    // Re-arm the mount-settling clock for this attempt. mountedAtRef used to
    // be set once at mount only, so the camera-teardown gap below (Platform
    // 'android' branch) protected the very first Analyze tap but not any
    // Retry — every retry read an `elapsed` already far past MIN_GAP_MS and
    // skipped the wait outright. Resetting it here — the one path both the
    // initial button and Retry funnel through — makes every attempt get the
    // same settling protection, not just the first.
    mountedAtRef.current = Date.now();
    // Progress bookkeeping is per-attempt. The retry button used to be the
    // only place this was cleared, so the NFC-settings auto-retry path (which
    // calls straight into here) inherited the previous attempt's high-water
    // mark — queueProgressUpdate ignores anything at or below it, so the bar
    // sat frozen at whatever value the last scan died on.
    progressQueueRef.current = [];
    isProcessingProgressRef.current = false;
    lastProgressRef.current = 0;
    readTickRef.current = 0;
    setNfcProgress(0);
    setScanStatus(t('voting.step6Init'));
    setNativeLogs([]);

    let eDocModule: typeof import('@/modules/e-document');
    try {
      eDocModule = await import('@/modules/e-document');
    } catch (error) {
      if (!stillOwner()) return;
      handleScanFailure(error, undefined, pressToken);
      return;
    }
    // Cancelled or left while the module loaded: the cancel path already
    // put the screen back in the Retry state.
    if (!stillOwner()) return;

    // Generate random challenge for Active Authentication
    const challenge = getRandomValues(new Uint8Array(32));

    // On Android, ensure at least 5s have elapsed since Step 6 mounted so the
    // camera2 session from Step 5 is fully torn down before NFC starts. On
    // some SoCs the NFC controller and camera DSP share resources; tapping
    // Analyze too quickly results in "Tag was lost" on the first APDU. The
    // owner re-checks that this attempt is still current after the wait, so
    // leaving the step during it never arms the reader (rule R11).
    const preArmWaitMs = Platform.OS === 'android'
      ? Math.max(0, ANDROID_MIN_GAP_MS - (Date.now() - mountedAtRef.current))
      : 0;

    // 'I' = TD1 ID card → PACE polling on Type A (skipPACE=false), the
    // protocol French CNIes use, opened with the CAN (password reference
    // 0x02, used unhashed — plugins/withPaceCanFix.js on iOS, the CAN branch
    // of DocumentScanner.kt on Android). 'P' = TD3 passport → Type B + BAC
    // with the MRZ key. The doc type comes from the DocumentChoice screen
    // (voting-flow.tsx → isPassportFlow prop).
    //
    // No read timer on iOS: CoreNFC closes its own session at 60 s, and the
    // owner keeps only a 75 s safety net. Android: 60 s, Annuler always
    // available (project decisions of 21/09, item 11 A).
    const handle = owner.start({
      preArmWaitMs,
      onArm: () => {
        setScanStatus(t(`voting.step6Now_${docSfx}`));
        // The access key (MRZ fields or CAN) is intentionally not logged — it
        // is what opens the chip.
        console.log(`[Step6] Starting scanDocument type=${isPassportFlow ? 'P' : 'I'} key=${accessKey.kind}`);
        milestonesRef.current.begin();
      },
      scan: () => eDocModule.scanDocument(isPassportFlow ? 'P' : 'I', toScanParameters(accessKey), challenge),
    });

    const outcome = await handle.done;
    milestonesRef.current.end();
    // Cancelled: releaseScan() has already shown the Retry state; a newer
    // attempt that superseded this one owns the screen now.
    if (outcome.kind === 'cancelled') return;
    if (!owner.isCurrent(handle.token) || !isActiveRef.current) return;

    if (outcome.kind === 'error') {
      handleScanFailure(outcome.error, outcome.elapsedMs, handle.token);
      return;
    }

    const result = outcome.value;
    console.log(`[Step6] Scan result received +${outcome.elapsedMs}ms`);

    // Doc-type post-scan check. The NFC layer's wrong-doc heuristic above
    // catches the case where the chip rejects the wrong protocol (e.g.
    // PACE-IM error → ID card on passport flow). But if the chip *succeeds*
    // and returns a DG1 of the unexpected length — which happens when the
    // user manually entered an ID-card MRZ on a passport-only proposal, or
    // held the wrong document with valid MRZ — that heuristic doesn't fire.
    // Catch it here against the actual DG1 size: TD3 passport = 93 bytes,
    // TD1 ID card = 95 bytes. Without this gate the proof gets built off the
    // wrong DG1, then the relayer's gas estimate reverts ~30 s later with a
    // generic "Execution reverted" — confusing for the user and unrecoverable
    // because the identity is now bound to the wrong on-chain contract.
    // Fail closed unless DG1 is exactly the length expected for this flow.
    // This catches both the wrong-document case (e.g. an ID-card MRZ entered
    // for a passport-only proposal → dg1Len 95 instead of 93) AND a
    // missing/corrupt DG1 (len 0 or any other value). Either way, falling
    // through would build the proof off a bad DG1 and the relayer's gas
    // estimate reverts ~30 s later with a generic "Execution reverted".
    const dg1Len = (result as { dg1Bytes?: Uint8Array }).dg1Bytes?.length ?? 0;
    const expectedDg1Len = isPassportFlow ? 93 : 95;
    if (dg1Len !== expectedDg1Len) {
      const otherDocDg1Len = isPassportFlow ? 95 : 93;
      if (dg1Len === otherDocDg1Len) {
        // Genuine wrong-document swap (passport MRZ on an ID-card flow or vice
        // versa) → show the "wrong document" banner + restart-with-correct-doc.
        console.warn(
          `[Step6] doc-type mismatch: flow=${isPassportFlow ? 'passport' : 'idCard'} but chip dg1Len=${dg1Len}`,
        );
        setPassportDetected(true);
        setDocMismatchConfirmed(true);
        setScanStatus('');
      } else {
        // Any other DG1 length (0 / missing / corrupt) is NOT a wrong-document
        // case — surface a generic read error and keep the normal retry CTA
        // (don't set passportDetected, which hides the analyze/retry button).
        console.warn(
          `[Step6] unexpected DG1 length: expected=${expectedDg1Len} got=${dg1Len}`,
        );
        setScanStatus(t('voting.step6ReadError'));
      }
      setScanning(false);
      setShowRetry(true);
      return;
    }

    setScanStatus(t('voting.step6ReadSuccess'));
    setScanning(false);
    setShowRetry(false);

    // Handed on only if this attempt is still the current one and step 6 is
    // still on screen when the 500 ms are up (rule R1): a back/next in
    // between must not push a scan result into a later step.
    if (onNFCSuccess) {
      handingOffRef.current = true;
      setHandingOff(true);
      deferWhileCurrent(handle.token, 500, () => { onNFCSuccess(result); });
    }
  };

  // Every failure ends here, already mapped to French (item 11 D, rule R10).
  const handleScanFailure = (error: any, elapsedMs: number | undefined, token: AttemptToken) => {
    // Set before the branching below so every failure path can be reported,
    // not just the generic one. console.error feeds utils/logger's redacted
    // rolling buffer, which is what the report actually attaches.
    setScanError(error);
    // Type and closed code only, never the native text (plan D14, rule R8).
    // The error object itself still goes to the report button (setScanError
    // above): what a report keeps is decision D-1, unchanged here.
    console.error(`[Step6] NFC scan error ${describeNativeError(error, error?.nfcCode ?? error?.code)}`);
    setDebugError(`${error?.name || 'Error'}: ${error?.message || 'unknown'}\n\nCode: ${error?.code || 'none'}\n\nInfo: ${JSON.stringify(error?.userInfo || error?.nativeError || {})}\n\nStack: ${error?.stack?.substring(0, 200) || 'none'}`);

    // Classify on the raw native text, not the French rewrite: modules/
    // e-document/index.ts replaces the message before we see it, consuming
    // the tokens that identify the chip and adding misleading ones.
    const rawError: string = error?.nativeMessage || error?.message || '';
    const kind = classifyScanError({
      raw: rawError,
      hasSpecificMessage: error?.hasSpecificMessage === true,
      code: error?.code,
      flow: isPassportFlow ? 'passport' : 'idCard',
      elapsedMs,
    });
    // Closed vocabulary: the kind and a duration, never the native text.
    console.log(`[Step6] scan failed kind=${kind}${elapsedMs !== undefined ? ` +${elapsedMs}ms` : ''}`);
    setScanning(false);

    if (kind === 'invalidMrz') {
      setScanStatus(t('voting.step6InvalidMrz'));
      if (onGoBack) deferWhileCurrent(token, 1500, () => { onGoBack(); });
      return;
    }

    // Guess, from the native error text, that the user held the *wrong* doc
    // type for this flow. Unlike the DG1-length check above this has no
    // proof behind it, so we leave the retry button in place (see
    // hideRetryForMismatch) rather than sending the user back to MRZ entry.
    // The rules — and the false positives they exist to avoid — live in
    // utils/e-document/wrong-document.ts.
    if (kind === 'wrongDocument') {
      console.warn('[Step6] suspected wrong document from error text');
      setPassportDetected(true);
      setScanStatus('');
      setShowRetry(true);
      startCoolDown();
      return;
    }

    setShowRetry(true);
    startCoolDown();

    // The person tapped Cancel on the iOS sheet: nothing to report.
    if (kind === 'userCancelled') {
      setScanError(null);
      setScanStatus(t('voting.step6Cancelled'));
      return;
    }

    if (kind === 'translated') {
      setScanStatus(error.message);
      return;
    }

    if (kind === 'canRejected') setCanRejected(true);
    const key = scanErrorKey(kind, docSfx) ?? `voting.step6ReadFailed_${docSfx}`;
    setScanStatus(
      kind === 'timeout'
        ? t(key, { antenna: t(Platform.OS === 'ios' ? 'voting.step6AntennaIos' : 'voting.step6AntennaAndroid') })
        : t(key),
    );
  };

  const handleCancelPress = () => {
    releaseScan('cancelled');
  };

  // Take the analyze/retry button away only when the mismatch is proven by the
  // chip (DG1 length) *and* the banner can actually offer a way out. A guessed
  // mismatch, or a missing onGoBack, must never leave the user with no button
  // at all — that stranded testers holding a perfectly valid document.
  const hideRetryForMismatch = passportDetected && docMismatchConfirmed && !!onGoBack;

  /**
   * A read that has ended badly and is showing the person why.
   *
   * True on every path that publishes a message and puts the action buttons
   * back: a scan failure, a cancel, a suspected or confirmed wrong document,
   * and the defensive missing-CAN case. Deliberately false while the read is
   * running, so the illustration stays where it is useful, and false on
   * success, whose message lives for 500 ms before step 7 takes over and must
   * not make the screen jump.
   */
  const failureShown = (!!scanStatus || passportDetected) && (showRetry || missingAccess);

  /**
   * Safety net under the folded illustration: bring the message into view.
   *
   * Folding the picture is what makes the message fit, but nothing guarantees
   * it at every text size and screen height, and the scroll keeps whatever
   * offset the person left it at, including the one the automation reaches by
   * scrolling down to the analyze button. The message and the
   * remove-the-card hint are the last two things in the scroll once the read
   * has ended, so scrolling to the end shows both.
   */
  useEffect(() => {
    if (!failureShown) return;
    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 0);
    return () => clearTimeout(id);
  }, [failureShown, scanStatus]);

  // The outlined look of the secondary buttons (edit, cancel).
  const secondaryButtonStyle = {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
  };
  const secondaryButtonTextStyle = { fontFamily: Typography.fontFamily.semibold, fontSize: 16, color: colors.text };

  // The primary action lives in a footer under the scroll, on both platforms:
  // the sheet header eats ~200 dp and on an iPhone SE the picture plus the
  // tips left the screen with no button at all when it opened, so the voter
  // had to guess that it scrolled (QA iPhone 2.0.2, item 5).
  //
  // Android had been left out of that fix on the reading that "that platform
  // shows it already". Our own tool says otherwise, and always did: on a
  // 360 x 640 Android, 568 dp of visible area, the layout lint
  // recorded 15 step-6 states with no-action-above-the-fold at HIGH severity,
  // the first button starting between 600 and 900 dp down. The Android QA of
  // 23/09 saw the same thing and wrote it off as "unchanged and accepted".
  // There is no layout reason for the two platforms to differ here: the step
  // is one picture, a block of tips and one or two buttons on both, and the
  // footer costs a small Android nothing that it does not cost an iPhone.
  const actionBlock = (
          <View style={stepSpecificStyles.step6ButtonContainer}>
            {/* Hide the analyze/retry button when a doc-type mismatch is
                *confirmed* — retrying the NFC scan with the same MRZ would just
                hit InvalidMRZKey or re-scan the same wrong chip. The only
                valid action is the "Recommencer avec le bon document" button
                inside the warning banner above, which routes back to MRZ
                entry so the user can input the proper data for the right
                document type. */}
            {/* A failed read is most often one wrong digit in what was typed.
                Offer the way back to Step 5 — the CAN field or the MRZ form,
                which kept their values — next to the plain retry. When the
                chip refused the CAN it comes first, as the main button. */}
            {(() => {
              const retryDisabled = isScanning || coolingDown || handingOff;
              const editFirst = (canRejected && showRetry && !isScanning) || missingAccess;
              const analyzeButton = !hideRetryForMismatch ? (
                <TouchableOpacity
                  key="analyze"
                  style={[
                    editFirst ? secondaryButtonStyle : stepSpecificStyles.step6Button,
                    retryDisabled && { opacity: 0.5 },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => {
                    // Progress refs are cleared by handleAnalyzePress itself, so
                    // every entry path gets the same reset.
                    setShowRetry(false);
                    setPassportDetected(false);
                    setDocMismatchConfirmed(false);
                    setDebugError(null);
                    setScanStatus('');
                    handleAnalyzePress();
                  }}
                  disabled={retryDisabled}
                >
                  <Text style={editFirst ? secondaryButtonTextStyle : stepSpecificStyles.step6ButtonText}>
                    {isScanning ? t('voting.step6Scanning') : showRetry ? t('common.retry') : t('common.analyze')}
                  </Text>
                </TouchableOpacity>
              ) : null;
              const editButton = (showRetry || missingAccess) && !isScanning && !hideRetryForMismatch && onGoBack ? (
                <TouchableOpacity
                  key="edit"
                  style={editFirst ? stepSpecificStyles.step6Button : secondaryButtonStyle}
                  activeOpacity={0.8}
                  onPress={() => {
                    setShowRetry(false);
                    setScanStatus('');
                    setCanRejected(false);
                    setMissingAccess(false);
                    onGoBack();
                  }}
                >
                  <Text style={editFirst ? stepSpecificStyles.step6ButtonText : secondaryButtonTextStyle}>
                    {t(`voting.step6EditAccess_${docSfx}`)}
                  </Text>
                </TouchableOpacity>
              ) : null;
              return editFirst ? [editButton, analyzeButton] : [analyzeButton, editButton];
            })()}
            {/* Always a way out while the reader is armed: releases it and
                returns to the Retry state (item 11 B). */}
            {isScanning && (
              <TouchableOpacity
                style={secondaryButtonStyle}
                activeOpacity={0.8}
                onPress={handleCancelPress}
                accessibilityRole="button"
              >
                <Text style={secondaryButtonTextStyle}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            )}
            {/* Mails us the redacted log buffer, which by this point holds the
                native error string, its code and the scan's event timeline.
                ErrorReportButton hides itself for failures we already explain
                (see EXPECTED_PATTERNS in utils/error-reporter.ts). */}
            {!isScanning && scanError != null && (
              <ErrorReportButton
                error={scanError}
                context={{ step: 6, isPassportFlow, platform: Platform.OS }}
              />
            )}
          </View>
  );

  return (
    <View
      style={[
        { width: containerWidth },
        slideFrameStyle(slideAreaHeight),
        // Android, once the flow has measured the slide area: take exactly
        // that height. slideFrameStyle only contributes a minHeight there,
        // on the reading that the row above stretches the slide anyway, and
        // a minHeight is not a box: the ScrollView below grows to its own
        // content and carries the footer past the bottom of the screen with
        // it. That is what the 360 x 640 findings were measuring. The value
        // is the same one the row stretches to (styles.ts slidingWrapper),
        // so this changes no pixel on a phone; it gives the column a box.
        Platform.OS === 'android' && slideAreaHeight && slideAreaHeight > 0
          ? { height: Math.round(slideAreaHeight) }
          : null,
      ]}
      onLayout={onLayout}
    >
      {/* Scrollable: on iOS the sheet is content-sized and clipped, and with
          the picture, the tips and a failure message the hint and the Retry /
          Edit-CAN buttons sat below the fold (2026-09-15). Bounded by the
          slide area on both platforms now: `flex: 1` here is what leaves the
          footer room of its own, and without it the ScrollView takes the
          whole slide and pushes the footer off the bottom. */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, width: '100%' }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      <View style={stepSpecificStyles.step6Container}>
        <Text style={stepSpecificStyles.step6Title}>{t(`voting.step6Title_${docSfx}`)}</Text>

        {/* The illustration folds away as soon as a read has ended badly.
            Measured on an iPhone 17 on 2026-09-23, default text size: with the
            picture in place, the failure message sat below the fold and the
            person saw three buttons and no reason. The picture is ~190 px, the
            message and the remove-the-card hint fit in less. It is also what
            matters least at that moment: the numbered instructions above the
            buttons already say how to place the card for the retry.
            The alternative, pinning the message into the footer, was rejected:
            the footer already takes a third of the screen at accessibility
            text sizes, where the third button wraps onto two lines. */}
        {!failureShown && (
        <View testID="step6-illustration" style={stepSpecificStyles.step6ImageContainer}>
          {isPassportFlow ? (
            // Passport artwork, on both platforms. Until now this step showed
            // the ID card to passport users twice over: poster-phone-over-
            // passport.png was a byte-identical copy of the card poster, and
            // iOS didn't branch on document at all — it played phoneOverCard.
            // The new image is a beta tester's three-position guide, which
            // also answers the "NFC stalls at 10%/35%" reports: the cause
            // identified there is the phone sitting too low on the passport.
            // Wider box than the ID-card one so the panel labels stay legible;
            // the height is unchanged, so nothing below this moves.
            // French-labelled since 2026-09-13 (C4): "Trop bas / Hauteur
            // minimale / Hauteur maximale".
            <FadeInImage
              source={require('@/assets/images/nfc-passport-position-fr.jpg')}
              // Width in points, not a percentage: the CAN step's picture
              // came out at pixel size on iOS when its percentage width
              // failed to resolve (2026-09-14).
              style={[stepSpecificStyles.step6ImageWide, { width: containerWidth > 0 ? containerWidth : 360 }]}
              resizeMode="contain"
            />
          ) : (
            // ID card, both platforms (C2, 2026-09-13): the phone on the card,
            // where iOS used to play the generic phone-over-card clip.
            <Image
              source={require('@/assets/images/nfc-card-phone-position.jpg')}
              style={stepSpecificStyles.step6Image}
              resizeMode="contain"
            />
          )}
        </View>
        )}

        {/* Les consignes de placement disparaissent quand la puce lue n'est pas
            celle du bon document. Mesure du 24/09/2026 sur iPhone 320x568 :
            avec l'illustration repliee le contenu fait encore 639 dp pour une
            fenetre de 482, et l'unique bouton de l'etat « document errone
            confirme » tombe a 602 dp, donc hors ecran. Or ces consignes
            expliquent comment poser la carte pour reessayer, ce qui n'a aucun
            sens ici : la personne doit aller chercher l'autre document. C'est
            le quatrieme element que cet ecran perd sous la ligne de flottaison,
            et la note du protocole demande de decider ce qui ne s'affiche pas
            en meme temps plutot que de deplacer une cinquieme fois. */}
        {!passportDetected && (isPassportFlow ? (
          <>
            <Text style={{
              textAlign: 'center',
              marginTop: 12,
              marginBottom: 4,
              marginHorizontal: 16,
              fontSize: 14,
              color: colors.textSecondary || colors.text,
              opacity: 0.7,
            }}>
              {t('voting.step6Instruction_passport')}
            </Text>

            {/* Two things the 2026-09-09 test night turned up, both of which
                decided whether the chip read at all. A tester timed out with
                her phone in its case and succeeded the moment she took it off;
                and on iPhone the passport only answers when the TOP of the
                phone sits on the cover between the word PASSEPORT and the
                emblem — the antenna is at the top on iPhone and mid-back on
                Android, so the placement line is iOS-only. Darker and
                un-dimmed: the instruction above is at 0.7 opacity and neither
                tester read that far. */}
            <Text style={{
              textAlign: 'center',
              marginBottom: 4,
              marginHorizontal: 16,
              fontSize: 14,
              fontFamily: Typography.fontFamily.semibold,
              color: colors.text,
            }}>
              {t('voting.step6RemoveCase')}
            </Text>

            {Platform.OS === 'ios' && (
              <Text style={{
                textAlign: 'center',
                marginBottom: 4,
                marginHorizontal: 16,
                fontSize: 14,
                color: colors.textSecondary || colors.text,
              }}>
                {t('voting.step6IosPassportPlacement')}
              </Text>
            )}
          </>
        ) : (
          // The card: three numbered tips, then the one line that decides
          // most reads. The case and the antenna position are what the
          // September test nights turned up (see the passport branch); the
          // third tip names where the antenna is on this platform.
          <View style={{ marginTop: 8, marginHorizontal: 24, gap: 6 }}>
            {/* Les trois consignes numerotees disparaissent pendant la lecture.
                Elles disent quoi faire AVANT de lancer, « retirez la coque »,
                « appuyez sur Lancer l'analyse », « quand la fenetre apparait » :
                a cet instant la personne a deja tout fait, et ce qu'il lui faut
                sous les yeux est l'etat de la lecture et la barre d'avancement.
                La campagne QA du 23/09 a montre le message d'etat coupe en deux
                par le pied fixe sur iPhone 17, en taille de texte STANDARD, et
                le compteur avait annonce cet etat comme reussi.
                La ligne en gras juste dessous reste, elle : « appuyez-les
                fermement l'un contre l'autre et ne bougez plus » est la seule
                consigne encore valable pendant la lecture, et c'est celle que
                les nuits de test de septembre ont designee comme decisive. */}
            {!isScanning && [
              t('voting.step6CardTip1'),
              t('voting.step6CardTip2'),
              t(Platform.OS === 'ios' ? 'voting.step6CardTip3_ios' : 'voting.step6CardTip3_android'),
            ].map((tip, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{
                  fontSize: 14,
                  lineHeight: 20,
                  fontFamily: Typography.fontFamily.semibold,
                  color: colors.text,
                }}>
                  {`${i + 1}.`}
                </Text>
                <Text style={{
                  flex: 1,
                  fontSize: 14,
                  lineHeight: 20,
                  color: colors.text,
                }}>
                  {tip}
                </Text>
              </View>
            ))}
            <Text style={{
              textAlign: 'center',
              marginTop: 6,
              fontSize: 14,
              lineHeight: 20,
              fontFamily: Typography.fontFamily.semibold,
              color: colors.text,
            }}>
              {t('voting.step6CardPress')}
            </Text>
          </View>
        ))}

        {passportDetected && (
          <View style={{
            backgroundColor: '#FEF3C7',
            borderRadius: 10,
            padding: 14,
            marginHorizontal: 16,
            borderLeftWidth: 4,
            borderLeftColor: '#F59E0B',
          }}>
            <Text style={{
              fontFamily: Typography.fontFamily.semibold,
              fontSize: 14,
              color: '#92400E',
              textAlign: 'center',
              marginBottom: 4,
            }}>
              {t(isPassportFlow ? 'voting.step6IdCardDetected' : 'voting.step6PassportDetected')}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: 13,
              color: '#92400E',
              textAlign: 'center',
              lineHeight: 18,
            }}>
              {t(isPassportFlow ? 'voting.step6UsePassportInstead' : 'voting.step6UseIdCardInstead')}
            </Text>
            {onGoBack && (
              <TouchableOpacity
                style={{
                  marginTop: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: '#92400E',
                  alignItems: 'center',
                }}
                activeOpacity={0.8}
                onPress={() => {
                  setPassportDetected(false);
                  setDocMismatchConfirmed(false);
                  setShowRetry(false);
                  setScanStatus('');
                  onGoBack();
                }}
              >
                <Text style={{
                  fontFamily: Typography.fontFamily.semibold,
                  fontSize: 14,
                  color: '#FFFFFF',
                }}>
                  {t('voting.step6RestartWithCorrectDoc')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {scanStatus && (
          <Text style={{
            textAlign: 'center',
            marginVertical: 8,
            // Sans marge horizontale, ce message touchait les deux bords de
            // l'écran, contrairement à tous ses voisins qui sont à 16. Vu sur
            // la capture du rejeu du 24/09 en taille de texte normale, sur
            // l'état step6-read-failed : la ligne « réessayez en la posant à
            // plat contre le dos du téléphone, sans » partait de x=0. Rien
            // n'était perdu, mais sur un écran à coins arrondis les premiers
            // et derniers caractères passent sous la courbure.
            marginHorizontal: 16,
            fontSize: 14,
            color: scanStatus.includes('❌') ? colors.errorText : scanStatus.includes('✅') ? colors.successText : colors.text
          }}>
            {scanStatus}
          </Text>
        )}

        {isScanning && (
          <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
            {/* Prominent reminder pinned just above the progress bar — the
                static step6Instruction_* text above is at 0.7 opacity and
                gets visually drowned out the moment the bar starts moving.
                The single most common scan failure ("Tag was lost") comes
                from the user lifting the document partway through; this
                line reads naturally while the bar is in motion. */}
            {hasPromptedPresentRef.current && (
              <Text style={{
                textAlign: 'center',
                marginBottom: 8,
                fontSize: 13,
                fontFamily: Typography.fontFamily.semibold,
                color: colors.text,
              }}>
                {t(`voting.step6KeepClose_${docSfx}`)}
              </Text>
            )}
            {/* Android-only. iOS has no in-app progress bar — the native NFC
                system sheet (EDocumentModule.swift's customDisplayMessage) is
                the only progress UI there, so a second JS bar would just be a
                redundant, out-of-sync copy. On Android this bar IS the only
                progress UI, since scanning happens silently in reader mode. */}
            {Platform.OS === 'android' && (
              <>
                <View style={{
                  height: 8,
                  backgroundColor: colors.border,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}>
                  <View style={{
                    height: '100%',
                    width: `${nfcProgress}%`,
                    backgroundColor: colors.successText,
                    borderRadius: 4,
                  }} />
                </View>
                <Text style={{
                  textAlign: 'center',
                  marginTop: 6,
                  fontSize: 11,
                  color: colors.textSecondary || colors.text,
                  opacity: 0.7,
                }}>
                  {nfcProgress}%
                </Text>
              </>
            )}
          </View>
        )}

        {devMode && debugError && (
          <View style={{
            backgroundColor: colors.errorBackground,
            borderRadius: 8,
            padding: 10,
            marginHorizontal: 16,
            marginBottom: 8,
          }}>
            <Text selectable style={{
              fontFamily: Typography.fontFamily.mono,
              fontSize: 10,
              color: colors.errorText,
            }}>
              {debugError}
            </Text>
          </View>
        )}

        {devMode && nativeLogs.length > 0 && (
          <View style={{
            backgroundColor: colors.errorBackground,
            borderRadius: 8,
            padding: 10,
            marginHorizontal: 16,
            marginBottom: 8,
            maxHeight: 180,
          }}>
            <ScrollView>
              <Text selectable style={{
                fontFamily: Typography.fontFamily.mono,
                fontSize: 10,
                color: colors.errorText,
              }}>
                {nativeLogs.join('\n')}
              </Text>
            </ScrollView>
          </View>
        )}

        {/* A document left sitting on the phone is not re-dispatched by
            Android, so a retry with it still in place waits forever (the
            "stuck at 10%" reports). The scan-failure message tells the user to
            keep the chip pressed against the phone, which is right during a
            read and exactly wrong here — say the opposite, next to the button
            they are about to press. */}
        {showRetry && !isScanning && !hideRetryForMismatch && (
          <Text style={stepSpecificStyles.step6RemoveHint}>
            {t(`voting.step6RemoveBeforeRetry_${docSfx}`)}
          </Text>
        )}

      </View>
      </ScrollView>
      <View style={{ width: '100%', paddingVertical: 12, backgroundColor: colors.cardBackground }}>
        {actionBlock}
      </View>
    </View>
  );
};

export default Step6;
