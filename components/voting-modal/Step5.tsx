import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { Worklets } from 'react-native-worklets-core';
import { Svg, Path } from 'react-native-svg';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { parseMRZDate, checkBirthDate, checkExpiryDate } from '@/utils/mrzDate';
import { useDevMode } from '@/contexts/DevModeContext';
import { extractMrz, extractMrzTd1 } from '@/utils/mrz-rarimo';
import { isCitizenshipAllowed } from '@/utils/voteResults';

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
  const [scanProgress, setScanProgress] = useState<'idle' | 'scanning' | 'partial' | 'success' | 'passport_detected' | 'underage' | 'expired' | 'wrong_country'>('idle');
  // The nationality from the rejected MRZ — used to interpolate the
  // user-facing error message (e.g. "DEU n'est pas autorisé"). null until
  // a citizenship check actually fails.
  const [rejectedCountry, setRejectedCountry] = useState<string | null>(null);
  const passportDetectCount = useRef(0);
  const ocrProducedResultsRef = useRef(false);
  // On degoogled devices (VollaOS, /e/OS, GrapheneOS without GServices) ML Kit's
  // text-recognition model can't load; the frame processor runs but scanText()
  // returns nothing. After a few seconds with zero OCR output we assume it's
  // broken and nudge the user toward manual entry.
  const [ocrUnavailable, setOcrUnavailable] = useState(false);

  // Reset when step becomes active
  useEffect(() => {
    if (isActive) {
      setHasScanned(false);
      setScanProgress('idle');
      setRejectedCountry(null);
      passportDetectCount.current = 0;
      ocrProducedResultsRef.current = false;
      setOcrUnavailable(false);
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

  // Convert YYMMDD to YYYY-MM-DD
  const convertMRZDate = (yymmdd: string): string => {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd;

    const yy = parseInt(yymmdd.substring(0, 2), 10);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);

    // If year >= 50, it's 19YY (1950-1999), otherwise 20YY (2000-2049)
    const yyyy = yy >= 50 ? `19${yy}` : `20${yy}`;

    return `${yyyy}-${mm}-${dd}`;
  };

  // Convert YYYY-MM-DD back to YYMMDD for BAC
  const convertToMRZFormat = (date: string): string => {
    if (!date) return date;
    // If already in YYMMDD format, return as-is
    if (date.length === 6 && !date.includes('-')) return date;

    // Parse YYYY-MM-DD format
    const parts = date.split('-');
    if (parts.length !== 3) return date;

    const yyyy = parts[0];
    const mm = parts[1];
    const dd = parts[2];

    // Get last 2 digits of year
    const yy = yyyy.substring(2, 4);

    return `${yy}${mm}${dd}`;
  };

  // OCR-output handler. Replaces the previous lines-based parser +
  // consensus buffer with rarime-android-app's single-frame algorithm
  // (utils/mrz-rarimo.ts): one regex match against the whole OCR text,
  // three ICAO mod-10 checksums gate the result. No history needed —
  // either a frame contains a complete, checksum-valid MRZ line 2 or
  // it doesn't.
  const onMRZDetected = Worklets.createRunOnJS((rawText: string) => {
    if (hasScanned) return;

    // Any OCR output at all means ML Kit is running — suppress the
    // "OCR unavailable" banner.
    if (rawText.length > 0) {
      ocrProducedResultsRef.current = true;
    }

    // Wrong-document detection: this step expects the doc type that
    // matches the active proposal's voting contract. If the user holds
    // the other type, line 1 of its MRZ has a distinctive prefix:
    //   passport flow → expecting "P<" prefix; if we see "I[D<…]" (ID
    //     card prefix) instead, flag wrong-document.
    //   ID-card flow → expecting "I[D<…]" / "ID" prefix; if we see "P<"
    //     (passport prefix) instead, flag wrong-document.
    // Three consecutive frames of the wrong-prefix → flip to the error
    // state. Done as a quick pre-filter before the full parse so we
    // don't burn cycles trying to extract the wrong format.
    const normalised = rawText.replace(/«/g, '<<').replace(/\s+/g, '').toUpperCase();
    const wrongDocRegex = isPassportFlow ? /^I[D<A-Z]/ : /^P[<A-Z]/;
    if (wrongDocRegex.test(normalised)) {
      passportDetectCount.current++;
      if (passportDetectCount.current >= 3) {
        setScanProgress('passport_detected');
      }
      return;
    }

    const mrz = isPassportFlow ? extractMrz(rawText) : extractMrzTd1(rawText);
    if (!mrz) {
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
    const birth = parseMRZDate(mrz.dateOfBirth);
    const expiry = parseMRZDate(mrz.dateOfExpiry);
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
    if (!isCitizenshipAllowed(mrz.nationality, allowedCitizenships)) {
      if (devMode) {
        console.log(`[Step5][devMode] bypassing wrong-country check (mrz=${mrz.nationality})`);
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
      // The next step (Step 6 NFC reader) wants YYMMDD for BAC derivation,
      // which is the format extractMrzTd1 already returns. Round-tripping
      // through convertMRZDate/convertToMRZFormat is preserved so any
      // future change to that step's expected format only needs to touch
      // these two helpers.
      const mrzOut = {
        documentNumber: mrz.documentNumber,
        birthDate: convertToMRZFormat(convertMRZDate(mrz.dateOfBirth)),
        expiryDate: convertToMRZFormat(convertMRZDate(mrz.dateOfExpiry)),
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
          <Text style={stepSpecificStyles.step5Title}>{t(`voting.step5Title_${isPassportFlow ? 'passport' : 'idCard'}`)}</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title}>{t('voting.step5CameraPermission')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={onManualFill || (() => console.log('Manual fill'))}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>{t('common.manualFill')}</Text>
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
          <Text style={stepSpecificStyles.step5Title}>{t(`voting.step5Title_${isPassportFlow ? 'passport' : 'idCard'}`)}</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title}>{t('voting.step5CameraUnavailable')}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={onManualFill || (() => console.log('Manual fill'))}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>{t('common.manualFill')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  console.log('✅ Step5: Rendering CAMERA');

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step5Container}>
        <Text style={stepSpecificStyles.step5Title}>{t(`voting.step5Title_${isPassportFlow ? 'passport' : 'idCard'}`)}</Text>
        <View style={[stepSpecificStyles.step5Camera, { position: 'relative' }]}>
          {/*
            Android (Volla / Camera2): keep <Camera /> permanently mounted;
            use display:flex/none + isActive prop to pause/resume the session
            without tearing down the TextureView — see Alexis commit eeae8fb.
            iOS uses standard AVFoundation which does not share this bug, so
            we restore the original conditional-render there to avoid holding
            the camera resource while the NFC reader is active.
          */}
          {Platform.OS === 'android' ? (
            <>
              <View style={{ flex: 1, display: isActive ? 'flex' : 'none' }}>
                <Camera
                  style={{ flex: 1 }}
                  device={device}
                  isActive={!!isActive}
                  frameProcessor={frameProcessor}
                  androidPreviewViewType="texture-view"
                  onError={(e) => console.error('[Camera] error:', e?.code, e?.message)}
                  onInitialized={() => console.log('[Camera] initialized')}
                  onStarted={() => console.log('[Camera] started')}
                  onStopped={() => console.log('[Camera] stopped')}
                />
              </View>
              {!isActive && (
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
            isActive ? (
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
              return (
            <View style={{
              width: '88%',
              // Passport data page is ~1.42; ID-1 (credit card) is 85.60 ×
              // 53.98 mm = 1.586. Drive framing from the active doc type so
              // the user sees a same-shape outline as the document.
              aspectRatio: isPassportFlow ? 1.42 : 1.586,
              borderWidth: scanProgress === 'success' ? 4 : scanProgress === 'partial' || isError ? 3 : 2,
              borderColor: scanProgress === 'success' ? colors.scanReticleSuccess : isError ? colors.scanReticleError : scanProgress === 'partial' ? colors.scanReticleWarning : colors.scanOverlayStrong,
              borderRadius: 12,
              backgroundColor: scanProgress === 'success' ? colors.scanReticleSuccessBg : isError ? colors.scanReticleErrorBg : colors.scanReticleNeutralBg,
              justifyContent: 'space-between',
              padding: 12,
            }}>
              <Text style={{
                color: colors.scanOverlayDim,
                fontSize: 12, fontWeight: 'bold', letterSpacing: 2,
                alignSelf: 'flex-end',
              }}>{t(isPassportFlow ? 'voting.step5CardOverlay_passport' : 'voting.step5CardOverlay_idCard')}</Text>
              <View style={{
                backgroundColor: scanProgress === 'success' ? colors.scanReticleSuccessInnerBg : colors.scanReticleInnerBg,
                borderWidth: 1,
                borderColor: scanProgress === 'success' ? colors.scanReticleSuccess : scanProgress === 'partial' ? colors.scanReticleWarning : colors.scanOverlayMedium,
                borderRadius: 4, padding: 6,
              }}>
                {isPassportFlow ? (
                  // TD3 placeholder: 2 lines × 44 chars. Line 1 = doc code +
                  // name; line 2 = doc no + nat + DOB + sex + expiry + …
                  <>
                    <Text style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'P<FRA NOM<<PRENOM<<<<<<<<<<<<<<<<<<<<<<<<'}
                    </Text>
                    <Text style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'12AB34567<FRA9001011M3001011<<<<<<<<<<<2'}
                    </Text>
                  </>
                ) : (
                  // TD1 placeholder: 3 lines × 30 chars. Lines 1+2 hold the
                  // fields BAC needs (doc no, DOB, expiry, nationality);
                  // line 3 is name.
                  <>
                    <Text style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'IDFRA12AB34567<<<<<<<<<<<<<<<<'}
                    </Text>
                    <Text style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'9001011M3001011FRA<<<<<<<<<<<2'}
                    </Text>
                    <Text style={{ color: scanProgress === 'success' ? colors.scanReticleSuccess : colors.scanOverlayWeak, fontSize: 7, letterSpacing: 1 }}>
                      {'DUPONT<<JEAN<<<<<<<<<<<<<<<<<<'}
                    </Text>
                  </>
                )}
              </View>
            </View>
              );
            })()}
            <Text style={{
              color: colors.scanOverlayText, fontSize: 14, fontWeight: '600',
              textAlign: 'center', marginTop: 12,
              textShadowColor: colors.overlay, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
            }}>
              {scanProgress === 'idle' && t(`voting.step5Positioning_${isPassportFlow ? 'passport' : 'idCard'}`)}
              {scanProgress === 'scanning' && t('voting.step5Scanning')}
              {scanProgress === 'partial' && t('voting.step5Partial')}
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
            borderLeftWidth: 4,
            borderLeftColor: colors.warningText,
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
        <TouchableOpacity
          style={stepSpecificStyles.step5Button}
          activeOpacity={0.8}
          onPress={onManualFill || (() => console.log('Manual fill'))}
        >
          <Text style={stepSpecificStyles.step5ButtonText}>{t('common.manualFill')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step5;
