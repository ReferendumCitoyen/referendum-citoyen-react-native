import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step8Props {
  containerWidth: number;
  verificationResult?: 'success' | 'error' | null;
  voteSubmissionResult?: 'success' | 'error' | null;
  onVoteSuccess?: () => void;
  onVoteError?: () => void;
  onClose?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step8: React.FC<Step8Props> = ({
  containerWidth,
  verificationResult,
  voteSubmissionResult,
  onVoteSuccess,
  onVoteError,
  onClose,
  onLayout
}) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);

  // Navigate to voting screen when button is pressed
  const handleVote = () => {
    if (onVoteSuccess) {
      onVoteSuccess();
    }
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step8Container}>
        <View style={stepSpecificStyles.step8Content}>
          <Text style={stepSpecificStyles.step8Title}>Vous êtes prêt</Text>

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
          onPress={handleVote}
        >
          <Text style={stepSpecificStyles.step8ButtonText}>Votez maintenant</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step8;
