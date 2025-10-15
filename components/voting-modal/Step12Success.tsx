import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import LottieView from 'lottie-react-native';
import { stepSpecificStyles } from './styles';

interface Step12SuccessProps {
  containerWidth: number;
  onViewResults?: () => void;
}

const Step12Success: React.FC<Step12SuccessProps> = ({ containerWidth, onViewResults }) => {
  return (
    <View style={[{ width: containerWidth }]}>
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
