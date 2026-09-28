import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { Worklets } from 'react-native-worklets-core';
import { Svg, Path } from 'react-native-svg';
import { createStepSpecificStyles } from './styles';
import { useColors, Spacing } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { CAP_SMALL } from '@/utils/font-scale-cap';
import { parseMRZDate, checkBirthDate, checkExpiryDate } from '@/utils/mrzDate';
import { useDevMode } from '@/contexts/DevModeContext';
import { extractMrz, extractMrzTd1 } from '@/utils/mrz-rarimo';
import { ConsecutiveReads, mrzReadKey } from '@/utils/mrz-agreement';
import { isCitizenshipAllowed } from '@/utils/voteResults';
import { isMockBackend } from '@/constants/mock-backend';


interface Step5Props {
  containerWidth: number;
  isActive?: boolean;
  onMRZScanned?: (data: {
    documentNumber: string;
    birthDate: string;
    expiryDate: string;
  }) => void;
  onManualFill?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Selects the doc-type-specific MRZ extractor + reticle. True =
   * TD3 passport (2 lines × 44 chars, 1.42 aspect ratio, extractMrz).
   * False = TD1 ID card (3 lines × 30 chars, 1.586 aspect ratio,
   * extractMrzTd1). Driven by the selected proposal's voting contract
   * upstream in voting-flow.tsx. */
  isPassportFlow?: boolean;
  /** Proposal's `criteria.citizenshipWhitelist` — passed through from
   * voting-flow.tsx so Step 5 can reject documents whose nationality
   * isn't allowed for the active proposal *before* the user wastes time
   * on the NFC scan. Undefined / empty array → no restriction (any
   * nationality is OK). */
  allowedCitizenships?: readonly bigint[];
}

const Step5: React.FC<Step5Props> = ({ containerWidth, isActive, onMRZScanned, onManualFill, onLayout, isPassportFlow = false, allowedCitizenships }) => {
  // Dev-mode toggle: bypasses the MRZ-level underage / expired guards so
  // QA can scan otherwise-ineligible documents and test the downstream
  // NFC + registration + voting paths. Turn it on with 7 taps on the
  // version row in Settings.
  const { devMode } = useDevMode();
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin' });
  const [hasScanned, setHasScanned] = useState(false);
  const [scanProgress, setScanProgress] = useState<'idle' | 'scanning' | 'partial' | 'confirming' | 'success' | 'passport_detected' | 'underage' | 'expired' | 'wrong_country'>('idle');
  // The nationality from the rejected MRZ — used to interpolate the
  // user-facing error message (e.g. "DEU n'est pas autorisé"). null until
  // a citizenship check actually fails.
  const [rejectedCountry, setRejectedCountry] = useState<string | null>(null);
  const passportDetectCount = useRef(0);
  // A checksum-valid read only counts once it has repeated — see
  // utils/mrz-agreement.ts for why one valid frame is not enough.
  const agreementRef = useRef(new ConsecutiveReads());
  const ocrProducedResultsRef = useRef(false);
  // On degoogled devices (VollaOS, /e/OS, GrapheneOS without GServices) ML Kit's
  // text-recognition model can't load; the frame processor runs but scanText()
  // returns nothing. After a few seconds with zero OCR output we assume it's
  // broken and nudge the user toward manual entry.
  const [ocrUnavailable, setOcrUnavailable] = useState(false);
  // Camera-applet "close/reopen" bounce for the Retry button below: briefly
  // forces the camera paused (see effectiveActive) so a wedged ML Kit /
  // Camera2 session actually drops and re-acquires instead of continuing to
  // spin on whatever internal state it was stuck in.
  const [forcedPause, setForcedPause] = useState(false);
  const effectiveActive = isActive && !forcedPause;
  // True when OCR has been producing partial/non-matching frames for a long
  // stretch without ever reaching a terminal state (success, or one of the
  // scan-blocking errors) — e.g. ML Kit "wedges": it keeps running but never
  // converges. Distinct from ocrUnavailable above, which is zero OCR output
  // at all; this is OCR running but stuck.
  const [stuck, setStuck] = useState(false);

  // Reset when step becomes active
  useEffect(() => {
    if (isActive) {
      setHasScanned(false);
      setScanProgress('idle');
      setRejectedCountry(null);
      passportDetectCount.current = 0;
      agreementRef.current.reset();
      ocrProducedResultsRef.current = false;
      setOcrUnavailable(false);
      setStuck(false);
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive || hasScanned) return;
    const timer = setTimeout(() => {
      if (!ocrProducedResultsRef.current && !hasScanned) {
        console.log('[Step5] No OCR output after 8s — flagging OCR as unavailable (likely degoogled device)');
        setOcrUnavailable(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [isActive, hasScanned]);

  // Mirror of scanProgress so the delayed stuck-detection timeout below reads
  // the live value instead of a stale closure captured when the timer armed.
  const scanProgressRef = useRef(scanProgress);
  useEffect(() => {
    scanProgressRef.current = scanProgress;
  }, [scanProgress]);

  // Stuck detection: 25s of no progress (deliberately keyed on
  // [isActive, hasScanned] only, NOT scanProgress — that changes ~2x/second
  // and would keep re-arming this timer, so it would never fire). Guarded by
  // ocrProducedResultsRef so this never fires for the already-handled
  // ocrUnavailable case (OCR never worked at all), and only trips while
  // still in 'scanning'/'partial' — terminal states (underage/expired/
  // wrong_country/passport_detected) already have their own recovery path
  // that doesn't need a camera cycle.
  useEffect(() => {
    if (!isActive || hasScanned) return;
    const timer = setTimeout(() => {
      const p = scanProgressRef.current;
      if (!hasScanned && ocrProducedResultsRef.current && (p === 'scanning' || p === 'partial' || p === 'confirming')) {
        setStuck(true);
      }
    }, 25000);
    return () => clearTimeout(timer);
  }, [isActive, hasScanned]);

  const handleRetry = () => {
    setStuck(false);
    setHasScanned(false);
    setScanProgress('idle');
    setRejectedCountry(null);
    passportDetectCount.current = 0;
    agreementRef.current.reset();
    ocrProducedResultsRef.current = false;
    setOcrUnavailable(false);
    setForcedPause(true);
    setTimeout(() => setForcedPause(false), 400);
  };

  // OCR-output handler. rarime-android-app's single-frame extractor
  // (utils/mrz-rarimo.ts) decides whether a frame holds a complete,
  // checksum-valid MRZ; the agreement check below then asks for that read to
  // repeat before it is accepted. The 15-frame consensus buffer that predated
  // the extractor (commit 4161d6c) is not restored — two identical reads are
  // the part of it that mattered.
  const onMRZDetected = Worklets.createRunOnJS((rawText: string) => {
    if (hasScanned) return;

    // Any OCR output at all means ML Kit is running — suppress the
    // "OCR unavailable" banner.
    if (rawText.length > 0) {
      ocrProducedResultsRef.current = true;
    }

    // The prefix pre-filter that used to live here has been removed. It tested
    // the *whole* OCR string against /^P[<A-Z]/ (ID-card flow) or /^I[D<A-Z]/
    // (passport flow) — with `[<A-Z]` amounting to "any letter", that reads as
    // "the OCR happens to start with P" or "…with I". French ID cards print
    // "PRÉNOM"/"PRENOMS" and passports print "IDENTITÉ", so the filter fired on
    // the *correct* document and told the user to swap. Its counter was also
    // never reset, so three such frames anywhere in a session were enough.
    //
    // The cross-parser check further down replaces it and cannot false-positive:
    // it only fires when the other format's MRZ parses with all of its ICAO
    // checksums intact.
    const normalised = rawText.replace(/«/g, '<<').replace(/\s+/g, '').toUpperCase();

    const mrz = isPassportFlow ? extractMrz(rawText) : extractMrzTd1(rawText);
    if (!mrz) {
      // Definitive wrong-document check: the *other* format parsed cleanly,
      // ICAO checksums and all, so the user is demonstrably holding the other
      // document. The prefix test above is anchored at the start of the OCR
      // text. Checksums make a false positive here effectively impossible, but
      // we still want two frames of agreement before telling someone their
      // document is wrong.
      const otherMrz = isPassportFlow ? extractMrzTd1(rawText) : extractMrz(rawText);
      if (otherMrz) {
        passportDetectCount.current++;
        if (passportDetectCount.current >= 3) {
          setScanProgress('passport_detected');
        }
        return;
      }
      // Consecutive, not cumulative: any frame that is not the other document
      // clears the tally, so three unrelated frames spread across a session
      // can never add up to a wrong-document verdict.
      passportDetectCount.current = 0;

      // No checksum-valid MRZ in this frame yet. Surface "scanning"
      // unless we've already seen partial signal:
      //   passport flow → TD3 line-2 shape (doc-num run + 3-letter nat).
      //   ID-card flow → TD1 line-1 prefix OR line-2 DOB+sex+expiry shape.
      const partialRegex = isPassportFlow
        ? /[0-9A-Z<]{10}[A-Z]{3}/
        : /^I[D<A-Z]/;
      const partialDatesRegex = isPassportFlow
        ? null
        : /[0-9]{6}[0-9][MFX<][0-9]{6}/;
      if (
        partialRegex.test(normalised) ||
        (partialDatesRegex && partialDatesRegex.test(normalised))
      ) {
        setScanProgress('partial');
      } else {
        setScanProgress('scanning');
      }
      return;
    }

    // Operational only — no PII. The MRZ is the BAC key for the NFC chip;
    // logging it would leak the user's document number + DOB to logcat.
    console.log(`[Step5] MRZ detected (nationality=${mrz.nationality}, docLen=${mrz.documentNumber.length})`);

    // The read has to repeat before it counts: a read with one wrong digit
    // still passes its check digit about one time in ten, and at two frames a
    // second one eventually gets through. Checked before the eligibility
    // gates so a single misread cannot show "underage" or "expired" either.
    if (!agreementRef.current.record(mrzReadKey(mrz))) {
      setScanProgress('confirming');
      return;
    }

    // Pre-NFC eligibility gate: same age + expiry policy as the manual
    // entry sheet (utils/mrzDate). Stays in scan state so OCR keeps
    // running — user can re-present a different document.
    //
    // Dev-mode bypass: when the user has dev mode enabled (Settings →
    // 7 taps on version), we let underage / expired documents through so
    // QA can test the rest of the flow (registration relayer accepts
    // expired passports; the circuit-level expiration check fires later
    // in Step 11 with a clearer error message). We still log the reason
    // so it's obvious in logcat which check was waived.
    const birth = parseMRZDate(mrz.dateOfBirth, 'birth');
    const expiry = parseMRZDate(mrz.dateOfExpiry, 'expiry');
    if (checkBirthDate(birth) === 'underage') {
      if (devMode) {
        console.log('[Step5][devMode] bypassing underage check');
      } else {
        console.log('[Step5] Card holder is under 18 — blocking');
        setScanProgress('underage');
        return;
      }
    }
    if (checkExpiryDate(expiry) === 'expired') {
      if (devMode) {
        console.log('[Step5][devMode] bypassing expired check');
      } else {
        console.log('[Step5] Card is expired — blocking');
        setScanProgress('expired');
        return;
      }
    }
    // Citizenship gate: when the active proposal restricts voting to a
    // specific list of countries, reject the document here rather than
    // letting the user burn ~60 s on NFC + registration only to fail in
    // Step 11 with an opaque on-chain revert. The whitelist is empty for
    // proposals open to any country, in which case isCitizenshipAllowed
    // short-circuits to true.
    //
    // MOCK_BACKEND also bypasses this (in addition to the pre-existing
    // devMode bypass): this beta iteration deliberately accepts any
    // passport nationality (e.g. a UK passport) so testers aren't limited
    // to French documents, since there's no real backend/on-chain
    // eligibility check happening downstream anyway. See
    // constants/mock-backend.ts.
    if (!isCitizenshipAllowed(mrz.nationality, allowedCitizenships)) {
      if (devMode || isMockBackend()) {
        console.log(`[Step5][beta] bypassing wrong-country check (mrz=${mrz.nationality})`);
      } else {
        console.log(`[Step5] Wrong country — blocking (mrz=${mrz.nationality})`);
        setRejectedCountry(mrz.nationality);
        setScanProgress('wrong_country');
        return;
      }
    }

    setScanProgress('success');
    setHasScanned(true);

    if (onMRZScanned) {
      // Both dates go on as the YYMMDD the extractor already returns, with
      // their ICAO check digits verified. They used to be round-tripped
      // through a local YYYY-MM-DD pair of helpers, which was lossy for a
      // two-digit year below 10: `20${parseInt('05', 10)}` is "205", and
      // taking the last two characters of that gives a five-character date.
      // The passport form then rejected it as malformed and left the date of
      // birth EMPTY for anyone born 2000-2009 — reported by a tester on
      // build 21, twice, with every other field filled (expiry years are
      // 26-35, so they never hit it). Nothing downstream wants a
      // four-digit year, so there is nothing to convert.
      const mrzOut = {
        documentNumber: mrz.documentNumber,
        birthDate: mrz.dateOfBirth,
        expiryDate: mrz.dateOfExpiry,
      };
      // No PII in the log — see "MRZ detected" comment above.
      console.log('[Step5] Sending MRZ to next step');
      // Hold on the green success reticle for ~800ms so the user sees
      // the success state before the parent slides Step 5 off-screen.
      // Without this, setScanProgress('success') and onMRZScanned fire
      // in the same tick (~5ms) and the green frame is never painted.
      setTimeout(() => onMRZScanned(mrzOut), 800);
    }
  });

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    if (hasScanned) return;

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

          // Pass the raw OCR text through — the rarime-algorithm extractor
          // in utils/mrz-rarimo.ts does its own whitespace strip and regex
          // match, and is happy with multi-line input.
          if (resultText) {
            onMRZDetected(resultText);
          }
        }
      } catch (err) {
        console.log("Frame processing error:", err);
      }
    });
  }, [scanText, onMRZDetected, hasScanned]);

  if (!hasPermission) {
    console.log('❌ Step5: Rendering NO PERMISSION screen');
    return (
      <View style={[{ width: containerWidth }]} onLayout={onLayout}>
        <View style={stepSpecificStyles.step5Container}>
          <Text style={stepSpecificStyles.step5Title} maxFontSizeMultiplier={CAP_SMALL}>{t(`voting.step5Title_${isPassportFlow ? 'passport' : 'idCard'}`)}</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title} maxFontSizeMultiplier={CAP_SMALL}>{t('voting.step5CameraPermission')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={onManualFill || (() => console.log('Manual fill'))}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>{t('common.backToForm')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!device) {
    console.log('❌ Step5: Rendering NO DEVICE screen');
    return (
      <View style={[{ width: containerWidth }]} onLayout={onLayout}>
        <View style={stepSpecificStyles.step5Container}>
          <Text style={stepSpecificStyles.step5Title} maxFontSizeMultiplier={CAP_SMALL}>{t(`voting.step5Title_${isPassportFlow ? 'passport' : 'idCard'}`)}</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title} maxFontSizeMultiplier={CAP_SMALL}>{t('voting.step5CameraUnavailable')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={onManualFill || (() => console.log('Manual fill'))}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>{t('common.backToForm')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Outline geometry. The preview is a fixed height, so the outline has to be
  // constrained by height as well as width or it pushes the status line out of
  // the camera area entirely — see the comment on the box below.
  const reticleAspect = isPassportFlow ? 1.42 : 1.586;
  const STATUS_LINE_ROOM = 12 + 14 * CAP_SMALL * 1.25 * 2 + 8; // margin + 2 capped lines + slack
  const reticleWidth = Math.min(
    containerWidth * 0.88,
    (Spacing.modal.step5CameraHeight - STATUS_LINE_ROOM) * reticleAspect,
  );

  console.log('✅ Step5: Rendering CAMERA');

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step5Container}>
        <Text style={stepSpecificStyles.step5Title} maxFontSizeMultiplier={CAP_SMALL}>{t(`voting.step5Title_${isPassportFlow ? 'passport' : 'idCard'}`)}</Text>
        <View style={[stepSpecificStyles.step5Camera, { position: 'relative' }]}>
          {/*
            Android (Volla / Camera2): keep <Camera /> permanently mounted;
            use display:flex/none + isActive prop to pause/resume the session
            without tearing down the TextureView — see commit eeae8fb.
            iOS uses standard AVFoundation which does not share this bug, so
            we restore the original conditional-render there to avoid holding
            the camera resource while the NFC reader is active.
          */}
          {Platform.OS === 'android' ? (
            <>
              <View style={{ flex: 1, display: effectiveActive ? 'flex' : 'none' }}>
                <Camera
                  style={{ flex: 1 }}
                  device={device}
                  isActive={!!effectiveActive}
                  frameProcessor={frameProcessor}
                  androidPreviewViewType="texture-view"
                  onError={(e) => console.error('[Camera] error:', e?.code, e?.message)}
                  onInitialized={() => console.log('[Camera] initialized')}
                  onStarted={() => console.log('[Camera] started')}
                  onStopped={() => console.log('[Camera] stopped')}
                />
              </View>
              {!effectiveActive && (
                <View
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: colors.cameraBackdrop,
                  }}
                />
              )}
            </>
          ) : (
            // iOS: standard conditional render — AVFoundation doesn't need the
            // always-mounted workaround and we don't want to hold the camera
            // session open while NFC is scanning in Step 6.
            effectiveActive ? (
              <Camera
                style={{ flex: 1 }}
                device={device}
                isActive={true}
                frameProcessor={frameProcessor}
                onError={(e) => console.error('[Camera] error:', e?.code, e?.message)}
              />
            ) : (
              <View style={{ flex: 1, backgroundColor: colors.cameraBackdrop }} />
            )
          )}
          {/* ID card overlay — sibling of Camera, not child */}
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            justifyContent: 'center', alignItems: 'center',
          }}>
            {(() => {
              const isError =
                scanProgress === 'passport_detected' ||
                scanProgress === 'underage' ||
                scanProgress === 'expired' ||
                scanProgress === 'wrong_country';
              // Something was read but not yet accepted: the warning colour.
              const isPending = scanProgress === 'partial' || scanProgress === 'confirming';
              return (
            <View style={{
              // Sized against BOTH the preview's width and its height. At 88%
              // of the slide width a passport outline (the taller ratio) came
              // out ~244pt, which with the status line below it overflowed the
              // fixed 282pt preview — and because the status text is white,
              // the part that spilled past the preview landed on the white
              // background below and became invisible. Taking whichever of the
              // two limits is smaller keeps the whole overlay inside the
              // camera, at any Dynamic Type size.
              width: reticleWidth,
              // Passport data page is ~1.42; ID-1 (credit card) is 85.60 ×
              // 53.98 mm = 1.586. Drive framing from the active doc type so
              // the user sees a same-shape outline as the document.
              aspectRatio: reticleAspect,
              borderWidth: scanProgress === 'success' ? 4 : isPending || isError ? 3 : 2,
              borderColor: scanProgress === 'success' ? colors.scanReticleSuccess : isError ? colors.scanReticleError : isPending ? colors.scanReticleWarning : colors.scanOverlayStrong,
              borderRadius: 12,
              backgroundColor: scanProgress === 'success' ? colors.scanReticleSuccessBg : isError ? colors.scanReticleErrorBg : colors.scanReticleNeutralBg,
              justifyContent: 'space-between',
              padding: 12,
            }}>
              {/* Fixed size on purpose: everything inside this outline is a
                  drawing of a document, not body copy. Scaling it with Dynamic
                  Type makes the fake MRZ wrap and burst the box, and the
                  outline stops looking like the thing the user is holding. */}
              <Text allowFontScaling={false} style={{
                color: colors.scanOverlayDim,
                fontSize: 12, fontWeight: 'bold', letterSpacing: 2,
                alignSelf: 'flex-end',
              }}>{t(isPassportFlow ? 'voting.step5CardOverlay_passport' : 'voting.step5CardOverlay_idCard')}</Text>
              <View style={{
                backgroundColor: scanProgress === 'success' ? colors.scanReticleSuccessInnerBg : colors.scanReticleInnerBg,
                borderWidth: 1,
                borderColor: scanProgress === 'success' ? colors.scanReticleSuccess : isPending ? colors.scanReticleWarning : colors.scanOverlayMedium,
                borderRadius: 4, padding: 6,
              }}>
                {isPassportFlow ? (
                  // TD3 placeholder: 2 lines × 44 chars. Line 1 = doc code +
                  // name; line 2 = doc no + nat + DOB + sex + expiry + …
                  <>
                    <Text allowFontScaling={false} style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'P<FRA NOM<<PRENOM<<<<<<<<<<<<<<<<<<<<<<<<'}
                    </Text>
                    <Text allowFontScaling={false} style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'12AB34567<FRA9001011M3001011<<<<<<<<<<<2'}
                    </Text>
                  </>
                ) : (
                  // TD1 placeholder: 3 lines × 30 chars. Lines 1+2 hold the
                  // fields BAC needs (doc no, DOB, expiry, nationality);
                  // line 3 is name.
                  <>
                    <Text allowFontScaling={false} style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'IDFRA12AB34567<<<<<<<<<<<<<<<<'}
                    </Text>
                    <Text allowFontScaling={false} style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'9001011M3001011FRA<<<<<<<<<<<2'}
                    </Text>
                    <Text allowFontScaling={false} style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'DUPONT<<JEAN<<<<<<<<<<<<<<<<<<'}
                    </Text>
                  </>
                )}
              </View>
            </View>
              );
            })()}
            <Text maxFontSizeMultiplier={CAP_SMALL} style={{
              color: colors.scanOverlayText, fontSize: 14, fontWeight: '600',
              textAlign: 'center', marginTop: 12,
              textShadowColor: colors.overlay, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
            }}>
              {scanProgress === 'idle' && t(`voting.step5Positioning_${isPassportFlow ? 'passport' : 'idCard'}`)}
              {scanProgress === 'scanning' && t('voting.step5Scanning')}
              {scanProgress === 'partial' && t('voting.step5Partial')}
              {scanProgress === 'confirming' && t('voting.step5Confirming')}
              {scanProgress === 'success' && t('voting.step5Success')}
              {scanProgress === 'passport_detected' && t(`voting.step5PassportDetected_${isPassportFlow ? 'passport' : 'idCard'}`)}
              {scanProgress === 'underage' && t('voting.step5Underage')}
              {scanProgress === 'expired' && t(`voting.step5Expired_${isPassportFlow ? 'passport' : 'idCard'}`)}
              {scanProgress === 'wrong_country' && t('voting.step5WrongCountry', { country: rejectedCountry ?? '???' })}
            </Text>
          </View>
        </View>
        {ocrUnavailable && (
          <View style={{
            backgroundColor: colors.warningBackground,
            paddingVertical: 10,
            paddingHorizontal: 12,
            marginHorizontal: 12,
            marginTop: 12,
            borderRadius: 6,
          }}>
            <Text style={{ color: colors.warningText, fontSize: 13, lineHeight: 18 }}>
              {t('voting.step5OcrUnavailable')}
            </Text>
          </View>
        )}
        {stuck && (
          <View style={{
            backgroundColor: colors.warningBackground,
            paddingVertical: 10,
            paddingHorizontal: 12,
            marginHorizontal: 12,
            marginTop: 12,
            borderRadius: 6,
          }}>
            <Text style={{ color: colors.warningText, fontSize: 13, lineHeight: 18 }}>
              {t('voting.step5Stuck')}
            </Text>
          </View>
        )}
        {stuck && (
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={handleRetry}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={stepSpecificStyles.step5Button}
          activeOpacity={0.8}
          onPress={onManualFill || (() => console.log('Manual fill'))}
        >
          <Text style={stepSpecificStyles.step5ButtonText}>{t('common.backToForm')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step5;
