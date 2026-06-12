import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);

  // Navigate to voting screen when button is pressed.
  // GUARD: only advance when Step 7 actually verified the registration.
  // Three production reports (2026-06-11/12, iOS, proposal #54) show users
  // reaching the vote screens with no NFC scan and no registration — Step 11
  // then dead-ends on "Unknown vote error". The jump path is still
  // unidentified (possibly stale OTA JS); whatever it is, an unverified user
  // must never get past this button.
  const handleVote = () => {
    if (verificationResult !== 'success') {
      console.warn(
        `[Step8] Vote-now tapped without verified registration (verificationResult=${String(verificationResult)}) — ignoring`,
      );
      return;
    }
    if (onVoteSuccess) {
      onVoteSuccess();
    }
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step8Container}>
        <View style={stepSpecificStyles.step8Content}>
          <Text style={stepSpecificStyles.step8Title}>{t('voting.step8Ready')}</Text>

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
          <Text style={stepSpecificStyles.step8ButtonText}>{t('voting.step8VoteNow')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step8;
