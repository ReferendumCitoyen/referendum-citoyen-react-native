import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import LottieView from 'lottie-react-native';
import { stepSpecificStyles } from './styles';

interface Step9ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
}

const Step9Error: React.FC<Step9ErrorProps> = ({ containerWidth, onGoHome }) => {
  return (
    <View style={[{ width: containerWidth }]}>
      <View style={stepSpecificStyles.step9ErrorContainer}>
        <View style={stepSpecificStyles.step9ErrorContent}>
          <Text style={stepSpecificStyles.step9ErrorTitle}>
            Cet identifiant ne peut pas être utilisé
          </Text>

          <Text style={stepSpecificStyles.step9ErrorDescription}>
            Le propriétaire de cette carte d'identité a déjà voté ou nous a informé qu'il refuse de voter
          </Text>

          <LottieView
            source={require('@/assets/animations/error.json')}
            style={stepSpecificStyles.step9ErrorAnimation}
            autoPlay
            loop={false}
          />
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step9ErrorButton}
          activeOpacity={0.8}
          onPress={onGoHome || (() => console.log('Go home'))}
        >
          <Text style={stepSpecificStyles.step9ErrorButtonText}>Retour à l'écran d'accueil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step9Error;
