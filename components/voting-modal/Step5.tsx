import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { Worklets } from 'react-native-worklets-core';
import { parse } from 'mrz';
import { Svg, Path } from 'react-native-svg';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

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
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: 'latin' });
  const [hasScanned, setHasScanned] = useState(false);
  const [scanProgress, setScanProgress] = useState<'idle' | 'scanning' | 'partial' | 'success'>('idle');

  // Reset when step becomes active
  useEffect(() => {
    if (isActive) {
      setHasScanned(false);
      setScanProgress('idle');
    }
  }, [isActive]);

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

  const isMRZLike = (line: string): boolean => {
    const cleaned = line.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
    return (cleaned.includes('<<') || cleaned.startsWith('ID')) && cleaned.length >= 20;
  };

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    if (hasScanned) return;

    try {
      // Check for partial MRZ-like lines
      const mrzLikeCount = lines.filter(isMRZLike).length;
      if (mrzLikeCount > 0 && mrzLikeCount < 3) {
        setScanProgress('partial');
      } else if (mrzLikeCount === 0) {
        setScanProgress('scanning');
      }

      const result = parseMRZ(lines);

      if (result?.valid) {
        console.log("✅ MRZ Detected in voting modal:", result.fields);
        setScanProgress('success');
        setHasScanned(true);

        if (onMRZScanned) {
          onMRZScanned({
            documentNumber: result.fields.documentNumber || "",
            birthDate: convertToMRZFormat(convertMRZDate(result.fields.birthDate || "")),
            expiryDate: convertToMRZFormat(convertMRZDate(result.fields.expirationDate || "")),
          });
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
          <Text style={stepSpecificStyles.step5Title}>Scanner le MRZ de votre carte d'identité</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title}>Permission caméra requise</Text>
            </View>
          </View>
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={onManualFill || (() => console.log('Manual fill'))}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>Remplir manuellement</Text>
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
          <Text style={stepSpecificStyles.step5Title}>Scanner le MRZ de votre carte d'identité</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title}>Caméra non disponible</Text>

            </View>
          </View>
          <TouchableOpacity
            style={stepSpecificStyles.step5Button}
            activeOpacity={0.8}
            onPress={onManualFill || (() => console.log('Manual fill'))}
          >
            <Text style={stepSpecificStyles.step5ButtonText}>Remplir manuellement</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  console.log('✅ Step5: Rendering CAMERA');

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step5Container}>
        <Text style={stepSpecificStyles.step5Title}>Scanner le MRZ de votre carte d'identité</Text>
        <View style={[stepSpecificStyles.step5Camera, { position: 'relative' }]}>
          <Camera
            style={{ flex: 1 }}
            device={device}
            isActive={isActive || false}
            frameProcessor={frameProcessor}
          />
          {/* ID card overlay — sibling of Camera, not child */}
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            justifyContent: 'center', alignItems: 'center',
          }}>
            <View style={{
              width: '88%',
              aspectRatio: 1.586,
              borderWidth: scanProgress === 'success' ? 4 : scanProgress === 'partial' ? 3 : 2,
              borderColor: scanProgress === 'success' ? '#10B981' : scanProgress === 'partial' ? '#FBBF24' : 'rgba(255,255,255,0.7)',
              borderRadius: 12,
              backgroundColor: scanProgress === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(0,0,0,0.25)',
              justifyContent: 'space-between',
              padding: 12,
            }}>
              <Text style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 12, fontWeight: 'bold', letterSpacing: 2,
                alignSelf: 'flex-end',
              }}>CARTE D'IDENTITÉ</Text>
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
            <Text style={{
              color: '#fff', fontSize: 14, fontWeight: '600',
              textAlign: 'center', marginTop: 12,
              textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
            }}>
              {scanProgress === 'idle' && 'Positionnez le dos de la carte'}
              {scanProgress === 'scanning' && 'Recherche du MRZ...'}
              {scanProgress === 'partial' && 'MRZ partiellement détecté...'}
              {scanProgress === 'success' && '✅ MRZ détecté !'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={stepSpecificStyles.step5Button}
          activeOpacity={0.8}
          onPress={onManualFill || (() => console.log('Manual fill'))}
        >
          <Text style={stepSpecificStyles.step5ButtonText}>Remplir manuellement</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step5;
