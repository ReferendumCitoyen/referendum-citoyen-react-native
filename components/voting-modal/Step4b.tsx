import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';

interface Step4bProps {
  containerWidth: number;
  onContinueToCamera?: () => void;
  onManualFill?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step4b: React.FC<Step4bProps> = ({ containerWidth, onContinueToCamera, onManualFill, onLayout }) => {
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const { hasPermission, requestPermission } = useCameraPermission();

  const handleRequestPermission = async () => {
    if (!hasPermission) {
      await requestPermission();
    }
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step4Container}>
        <View style={stepSpecificStyles.step4Content}>
          <Text style={stepSpecificStyles.step4Title}>Scanner la zone MRZ</Text>
          <Text style={stepSpecificStyles.step4Description}>
            Nous allons scanner la zone MRZ (Machine Readable Zone) au bas de votre carte d'identité.
          </Text>
          <Text style={[stepSpecificStyles.step4Description, { marginTop: 12 }]}>
            Cette zone contient les informations nécessaires pour lire la puce NFC de votre carte.
          </Text>
        </View>

        {/* MRZ Example Visual */}
        <View style={stepSpecificStyles.step4bMrzExample}>
          <View style={stepSpecificStyles.step4bCardOutline}>
            <View style={stepSpecificStyles.step4bMrzZone}>
              <Text style={stepSpecificStyles.step4bMrzLabel}>Zone MRZ</Text>
              <View style={stepSpecificStyles.step4bMrzLines}>
                <Text style={stepSpecificStyles.step4bMrzText}>
                  IDFRAAB123456{'<'}7{'<'.repeat(21)}
                </Text>
                <Text style={stepSpecificStyles.step4bMrzText}>
                  9001011M2901015FRA{'<'.repeat(14)}08
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Permission Status */}
        {hasPermission ? (
          <View style={stepSpecificStyles.step4bPermissionStatus}>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path
                d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
                fill="#10B981"
              />
            </Svg>
            <Text style={stepSpecificStyles.step4bPermissionGranted}>
              Accès caméra autorisé
            </Text>
          </View>
        ) : (
          <View style={stepSpecificStyles.step4bPermissionStatus}>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                fill="#F59E0B"
              />
            </Svg>
            <Text style={stepSpecificStyles.step4bPermissionPending}>
              Autorisation caméra requise
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        {hasPermission ? (
          <TouchableOpacity
            style={stepSpecificStyles.step4Button}
            activeOpacity={0.8}
            onPress={onContinueToCamera || (() => console.log('Continue to camera'))}
          >
            <Text style={stepSpecificStyles.step4ButtonText}>Scanner la carte</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={stepSpecificStyles.step4Button}
            activeOpacity={0.8}
            onPress={handleRequestPermission}
          >
            <Text style={stepSpecificStyles.step4ButtonText}>Autoriser la caméra</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={stepSpecificStyles.step4bManualButton}
          activeOpacity={0.8}
          onPress={onManualFill || (() => console.log('Manual fill'))}
        >
          <Text style={stepSpecificStyles.step4bManualButtonText}>Remplir manuellement</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step4b;
