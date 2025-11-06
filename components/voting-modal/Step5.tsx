import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Svg, Path } from 'react-native-svg';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step5Props {
  containerWidth: number;
  onManualFill?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step5: React.FC<Step5Props> = ({ containerWidth, onManualFill, onLayout }) => {
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  if (!permission) {
    return null;
  }

  if (!permission.granted) {
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

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step5Container}>
        <Text style={stepSpecificStyles.step5Title}>Analyse MRZ</Text>
        <View style={stepSpecificStyles.step5Camera}>
          <CameraView style={{ flex: 1 }} facing="back">
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
          </CameraView>
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