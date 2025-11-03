import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
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
              <View style={stepSpecificStyles.step5ScanArea} />
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