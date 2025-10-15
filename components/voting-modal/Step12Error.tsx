import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import LottieView from 'lottie-react-native';
import { stepSpecificStyles } from './styles';

interface Step12ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
}

const Step12Error: React.FC<Step12ErrorProps> = ({ containerWidth, onGoHome }) => {
  return (
    <View style={[{ width: containerWidth }]}>
      <View style={stepSpecificStyles.step12ErrorContainer}>
        <View style={stepSpecificStyles.step12ErrorContent}>
          <Text style={stepSpecificStyles.step12ErrorTitle}>
            Une erreur est survenue.
          </Text>

          <Text style={stepSpecificStyles.step12ErrorDescription}>
            Veuillez recommencer.
          </Text>

          <LottieView
            source={require('@/assets/animations/error.json')}
            style={stepSpecificStyles.step12ErrorAnimation}
            autoPlay
            loop={false}
          />
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step12ErrorButton}
          activeOpacity={0.8}
          onPress={onGoHome || (() => console.log('Go home'))}
        >
          <Text style={stepSpecificStyles.step12ErrorButtonText}>Retour à l'écran d'accueil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step12Error;
