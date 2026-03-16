import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step12SuccessProps {
  containerWidth: number;
  onViewResults?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step12Success: React.FC<Step12SuccessProps> = ({ containerWidth, onViewResults, onLayout }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[{ width: containerWidth, height: '100%' }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step12SuccessContainer}>
        <View style={stepSpecificStyles.step12SuccessContent}>
          <Text style={stepSpecificStyles.step12SuccessTitle}>
            Bravo ! Votre vote a bien été enregistré.
          </Text>

          <Text style={stepSpecificStyles.step12SuccessDescription}>
            Les données de votre Carte d'Identité ont été effacées de cet appareil.
          </Text>

          <LottieView
            source={require('@/assets/animations/success.json')}
            style={stepSpecificStyles.step12SuccessAnimation}
            autoPlay
            loop={false}
          />
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step12SuccessButton}
          activeOpacity={0.8}
          onPress={onViewResults || (() => console.log('View results'))}
        >
          <Text style={stepSpecificStyles.step12SuccessButtonText}>Voir les résultats</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step12Success;
