import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import LottieView from 'lottie-react-native';
import { stepSpecificStyles } from './styles';

interface Step8Props {
  containerWidth: number;
  onVote?: () => void;
}

const Step8: React.FC<Step8Props> = ({ containerWidth, onVote }) => {
  return (
    <View style={[{ width: containerWidth }]}>
      <View style={stepSpecificStyles.step8Container}>
        <View style={stepSpecificStyles.step8Content}>
          <Text style={stepSpecificStyles.step8Title}>Vous êtes prêts</Text>

          <LottieView
            source={require('@/assets/animations/success.json')}
            style={stepSpecificStyles.step8SuccessAnimation}
            autoPlay
            loop={false}
          />
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step8Button}
          activeOpacity={0.8}
          onPress={onVote || (() => console.log('Vote now'))}
        >
          <Text style={stepSpecificStyles.step8ButtonText}>Votez maintenant</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step8;
