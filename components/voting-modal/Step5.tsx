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
  const [cameraKey, setCameraKey] = useState(0);

  useEffect(() => {
    if (isActive && !hasPermission) {
      requestPermission();
    }
  }, [isActive, hasPermission]);

  // Force camera reinit after permission granted
  useEffect(() => {
    if (hasPermission && device) {
      // Small delay to ensure device is ready, then force remount
      const timer = setTimeout(() => {
        setCameraKey(prev => prev + 1);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasPermission, device]);

  // Reset hasScanned when step becomes active
  useEffect(() => {
    if (isActive) {
      setHasScanned(false);
    }
  }, [isActive]);

  // MRZ Parser
  const parseMRZ = useCallback((lines: string[]) => {
    try {
      const numlinesToCheck = 2;
      const possibleMRZLines = lines?.slice(-numlinesToCheck);

      if (!possibleMRZLines?.length || possibleMRZLines.length !== numlinesToCheck) return;

      const tdLength = 44;
      const sanitizedMRZLines = possibleMRZLines.map(el => {
        return el.replaceAll('«', '<<').replaceAll(' ', '').toUpperCase();
      });

      sanitizedMRZLines[0] = sanitizedMRZLines[0].padEnd(tdLength, '<').toUpperCase();

      return parse(sanitizedMRZLines, { autocorrect: true });
    } catch (err) {
      console.log("MRZ parse error:", err);
      return null;
    }
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

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    if (hasScanned) return;

    try {
      const result = parseMRZ(lines);

      if (result?.valid) {
        console.log("✅ MRZ Detected in voting modal:", result.fields);
        setHasScanned(true);

        if (onMRZScanned) {
          // Pass the data in BAC format (YYMMDD) for NFC reading
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
    return (
      <View style={[{ width: containerWidth }]} onLayout={onLayout}>
        <View style={stepSpecificStyles.step5Container}>
          <Text style={stepSpecificStyles.step5Title}>Analyse MRZ</Text>
          <View style={stepSpecificStyles.step5Camera}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
              <Text style={stepSpecificStyles.step5Title}>Permission requise pour accéder à la caméra</Text>
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
    return (
      <View style={[{ width: containerWidth }]} onLayout={onLayout}>
        <View style={stepSpecificStyles.step5Container}>
          <Text style={stepSpecificStyles.step5Title}>Analyse MRZ</Text>
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

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step5Container}>
        <Text style={stepSpecificStyles.step5Title}>Analyse MRZ</Text>
        <View style={stepSpecificStyles.step5Camera}>
          <Camera
            key={cameraKey}
            style={{ flex: 1 }}
            device={device}
            isActive={isActive || false}
            frameProcessor={frameProcessor}
          >
            <View style={stepSpecificStyles.step5CameraOverlay}>
              <View style={stepSpecificStyles.step5ScanArea}>
                {/* Top-left corner */}
                <Svg width={40} height={40} style={stepSpecificStyles.step5CornerTopLeft}>
                  <Path d="M 8 0 L 4 0 Q 0 0 0 4 L 0 8" stroke={colors.white} strokeWidth={4} fill="none" strokeLinecap="round" />
                </Svg>
                {/* Top-right corner */}
                <Svg width={40} height={40} style={stepSpecificStyles.step5CornerTopRight}>
                  <Path d="M 32 0 L 36 0 Q 40 0 40 4 L 40 8" stroke={colors.white} strokeWidth={4} fill="none" strokeLinecap="round" />
                </Svg>
                {/* Bottom-left corner */}
                <Svg width={40} height={40} style={stepSpecificStyles.step5CornerBottomLeft}>
                  <Path d="M 0 32 L 0 36 Q 0 40 4 40 L 8 40" stroke={colors.white} strokeWidth={4} fill="none" strokeLinecap="round" />
                </Svg>
                {/* Bottom-right corner */}
                <Svg width={40} height={40} style={stepSpecificStyles.step5CornerBottomRight}>
                  <Path d="M 40 32 L 40 36 Q 40 40 36 40 L 32 40" stroke={colors.white} strokeWidth={4} fill="none" strokeLinecap="round" />
                </Svg>
                <View style={stepSpecificStyles.step5MrzContainer}>
                  <Text style={stepSpecificStyles.step5MrzText}>
                    IDFRAAB123456{'<'}7{'<'.repeat(21)}
                  </Text>
                  <Text style={stepSpecificStyles.step5MrzText}>
                    9001011M2901015FRA{'<'.repeat(14)}08
                  </Text>
                </View>
              </View>
            </View>
          </Camera>
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
