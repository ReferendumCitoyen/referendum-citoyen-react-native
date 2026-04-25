import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { Worklets } from 'react-native-worklets-core';
import { parse } from 'mrz';
import { Svg, Path } from 'react-native-svg';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { parseMRZDate, checkBirthDate, checkExpiryDate } from '@/utils/mrzDate';

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
}

const Step5: React.FC<Step5Props> = ({ containerWidth, isActive, onMRZScanned, onManualFill, onLayout }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin' });
  const [hasScanned, setHasScanned] = useState(false);
  const [scanProgress, setScanProgress] = useState<'idle' | 'scanning' | 'partial' | 'success' | 'passport_detected' | 'underage' | 'expired'>('idle');
  const passportDetectCount = useRef(0);
  const mrzHistoryRef = useRef<string[][]>([]);
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
      mrzHistoryRef.current = [];
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

  // MRZ Parser
  const parseMRZ = useCallback((lines: string[]) => {
    if (lines.length < 3) return null;
    try {
      const td1Lines = lines.slice(-3);
      const sanitized = td1Lines.map(el => {
        const cleaned = el.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
        return cleaned.length > 30 ? cleaned.substring(0, 30) : cleaned.padEnd(30, '<');
      });
      const result = parse(sanitized, { autocorrect: true });
      if (result?.valid && result.format === 'TD1') return result;
    } catch {}
    return null;
  }, []);

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

  const sanitizeMRZLine = (line: string): string => {
    const cleaned = line.replaceAll('«', '<').replaceAll(' ', '').toUpperCase();
    return cleaned.length > 30 ? cleaned.substring(0, 30) : cleaned.padEnd(30, '<');
  };

  const buildConsensus = useCallback((history: string[][]): string[] => {
    return [0, 1, 2].map(lineIdx => {
      let result = '';
      for (let pos = 0; pos < 30; pos++) {
        const chars: Record<string, number> = {};
        for (const read of history) {
          const ch = read[lineIdx]?.[pos] || '<';
          chars[ch] = (chars[ch] || 0) + 1;
        }
        result += Object.entries(chars).sort((a, b) => b[1] - a[1])[0][0];
      }
      return result;
    });
  }, []);

  const isMRZLike = (line: string): boolean => {
    const cleaned = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
    return (cleaned.includes('<<') || cleaned.startsWith('ID')) && cleaned.length >= 20;
  };

  const handleMRZSuccess = useCallback((result: ReturnType<typeof parse>) => {
    console.log("✅ MRZ Detected:", JSON.stringify(result.fields, null, 2));

    // Pre-NFC eligibility gate: same age + expiry policy as the manual entry
    // sheet (utils/mrzDate). Don't advance to Step 6 if the card is underage
    // or expired — the user can present a different card or use Saisie
    // manuelle. Stays in scan state so OCR keeps running.
    const birth = parseMRZDate(result.fields.birthDate || '');
    const expiry = parseMRZDate(result.fields.expirationDate || '');
    if (checkBirthDate(birth) === 'underage') {
      console.log('[Step5] Card holder is under 18 — blocking');
      setScanProgress('underage');
      return;
    }
    if (checkExpiryDate(expiry) === 'expired') {
      console.log('[Step5] Card is expired — blocking');
      setScanProgress('expired');
      return;
    }

    setScanProgress('success');
    setHasScanned(true);

    if (onMRZScanned) {
      const mrzOut = {
        documentNumber: result.fields.documentNumber || "",
        birthDate: convertToMRZFormat(convertMRZDate(result.fields.birthDate || "")),
        expiryDate: convertToMRZFormat(convertMRZDate(result.fields.expirationDate || "")),
      };
      console.log("[Step5] Sending MRZ to next step:", mrzOut);
      onMRZScanned(mrzOut);
    }
  }, [onMRZScanned]);

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    if (hasScanned) return;

    // Any OCR output at all — even garbage that isn't MRZ — means ML Kit is
    // actually running, so we won't surface the "OCR unavailable" banner.
    if (lines.length > 0) {
      ocrProducedResultsRef.current = true;
    }

    try {
      const mrzLikeLines = lines.filter(isMRZLike);
      const mrzLikeCount = mrzLikeLines.length;
      console.log(`[Step5 OCR] ${lines.length} lines, ${mrzLikeCount} MRZ-like:`);
      mrzLikeLines.forEach((l, i) => console.log(`  MRZ[${i}]: "${l}"`));

      // Detect passport MRZ: 2 lines, first starts with P
      if (mrzLikeCount === 2) {
        const firstLine = mrzLikeLines[0].replaceAll(' ', '').toUpperCase();
        if (firstLine.startsWith('P')) {
          passportDetectCount.current++;
          if (passportDetectCount.current >= 3) {
            setScanProgress('passport_detected');
          }
          return;
        }
      }

      if (mrzLikeCount > 0 && mrzLikeCount < 3) {
        setScanProgress('partial');
      } else if (mrzLikeCount === 0) {
        setScanProgress('scanning');
      }

      // Try parsing the raw single frame directly
      const result = parseMRZ(lines);
      if (result?.valid) {
        handleMRZSuccess(result);
        return;
      }

      // Accumulate for consensus if we have 3 MRZ-like lines
      if (mrzLikeCount >= 3) {
        const sanitized = mrzLikeLines.slice(-3).map(sanitizeMRZLine);
        mrzHistoryRef.current.push(sanitized);
        // Cap at 15 reads to avoid stale data
        if (mrzHistoryRef.current.length > 15) {
          mrzHistoryRef.current = mrzHistoryRef.current.slice(-15);
        }

        // Try consensus after ≥3 accumulated reads
        if (mrzHistoryRef.current.length >= 3) {
          const consensus = buildConsensus(mrzHistoryRef.current);
          console.log(`[Step5 Consensus] (${mrzHistoryRef.current.length} reads):`, consensus);
          try {
            const consensusResult = parse(consensus, { autocorrect: true });
            if (consensusResult?.valid && consensusResult.format === 'TD1') {
              handleMRZSuccess(consensusResult);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.log("MRZ detection error:", err);
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

          if (resultText) {
            onMRZDetected(resultText.split('\n'));
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
          <Text style={stepSpecificStyles.step5Title}>{t('voting.step5Title')}</Text>
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
          <Text style={stepSpecificStyles.step5Title}>{t('voting.step5Title')}</Text>
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
        <Text style={stepSpecificStyles.step5Title}>{t('voting.step5Title')}</Text>
        <View style={[stepSpecificStyles.step5Camera, { position: 'relative' }]}>
          {isActive ? (
            <Camera
              style={{ flex: 1 }}
              device={device}
              isActive={true}
              frameProcessor={frameProcessor}
            />
          ) : (
            <View style={{ flex: 1, backgroundColor: '#000' }} />
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
                scanProgress === 'expired';
              return (
            <View style={{
              width: '88%',
              aspectRatio: 1.586,
              borderWidth: scanProgress === 'success' ? 4 : scanProgress === 'partial' || isError ? 3 : 2,
              borderColor: scanProgress === 'success' ? '#10B981' : isError ? '#EF4444' : scanProgress === 'partial' ? '#FBBF24' : 'rgba(255,255,255,0.7)',
              borderRadius: 12,
              backgroundColor: scanProgress === 'success' ? 'rgba(16,185,129,0.15)' : isError ? 'rgba(239,68,68,0.15)' : 'rgba(0,0,0,0.25)',
              justifyContent: 'space-between',
              padding: 12,
            }}>
              <Text style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 12, fontWeight: 'bold', letterSpacing: 2,
                alignSelf: 'flex-end',
              }}>{t('voting.step5CardOverlay')}</Text>
              <View style={{
                backgroundColor: scanProgress === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                borderColor: scanProgress === 'success' ? '#10B981' : scanProgress === 'partial' ? '#FBBF24' : 'rgba(255,255,255,0.4)',
                borderRadius: 4, padding: 6,
              }}>
                <Text style={{ color: scanProgress === 'success' ? '#10B981' : 'rgba(255,255,255,0.6)', fontSize: 7, letterSpacing: 1 }}>
                  IDFRA{'<'.repeat(25)}
                </Text>
                <Text style={{ color: scanProgress === 'success' ? '#10B981' : 'rgba(255,255,255,0.6)', fontSize: 7, letterSpacing: 1 }}>
                  1234567890FRA9001011M{'<'.repeat(9)}
                </Text>
                <Text style={{ color: scanProgress === 'success' ? '#10B981' : 'rgba(255,255,255,0.6)', fontSize: 7, letterSpacing: 1 }}>
                  NOM{'<'.repeat(2)}PRENOM{'<'.repeat(19)}
                </Text>
              </View>
            </View>
              );
            })()}
            <Text style={{
              color: '#fff', fontSize: 14, fontWeight: '600',
              textAlign: 'center', marginTop: 12,
              textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
            }}>
              {scanProgress === 'idle' && t('voting.step5Positioning')}
              {scanProgress === 'scanning' && t('voting.step5Scanning')}
              {scanProgress === 'partial' && t('voting.step5Partial')}
              {scanProgress === 'success' && t('voting.step5Success')}
              {scanProgress === 'passport_detected' && t('voting.step5PassportDetected')}
              {scanProgress === 'underage' && t('voting.step5Underage')}
              {scanProgress === 'expired' && t('voting.step5Expired')}
            </Text>
          </View>
        </View>
        {ocrUnavailable && (
          <View style={{
            backgroundColor: '#FEF3C7',
            borderLeftWidth: 4,
            borderLeftColor: '#F59E0B',
            paddingVertical: 10,
            paddingHorizontal: 12,
            marginHorizontal: 12,
            marginTop: 12,
            borderRadius: 6,
          }}>
            <Text style={{ color: '#92400E', fontSize: 13, lineHeight: 18 }}>
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
