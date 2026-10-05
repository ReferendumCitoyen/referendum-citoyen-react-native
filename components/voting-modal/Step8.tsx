import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step8Props {
  containerWidth: number;
  verificationResult?: 'success' | null;
  onVoteSuccess?: () => void;
  /** Start the flow over from the document scan. Offered instead of the vote
   * button whenever this step is shown without a verified registration. */
  onRestart?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step8: React.FC<Step8Props> = ({
  containerWidth,
  verificationResult,
  onVoteSuccess,
  onRestart,
  onLayout,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);

  // Only a Step 7 success may lead to the vote. Production reports (2026-06-11/12,
  // iOS, proposal #54) showed users reaching the vote screens with no NFC scan
  // and no registration, dead-ending on "Unknown vote error"; a guard was added
  // that ignored the tap, which turned that into a "vote now" button that did
  // nothing (2026-09-08 test night). Step 7 no longer advances on failure, so
  // this state should be unreachable — if it is reached anyway, say so and
  // offer the only useful action, which is to scan again.
  if (verificationResult !== 'success') {
    return (
      <View style={[{ width: containerWidth }]} onLayout={onLayout}>
        <View style={stepSpecificStyles.step8Container}>
          <View style={stepSpecificStyles.step8Content}>
            <Text style={stepSpecificStyles.step8Title}>{t('voting.step8NotVerifiedTitle')}</Text>
            <Text style={stepSpecificStyles.step8Description}>
              {t('voting.step8NotVerifiedDescription')}
            </Text>
          </View>

          <TouchableOpacity
            style={stepSpecificStyles.step8Button}
            activeOpacity={0.8}
            onPress={onRestart}
          >
            <Text style={stepSpecificStyles.step8ButtonText}>{t('voting.step8Restart')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
          onPress={onVoteSuccess}
        >
          <Text style={stepSpecificStyles.step8ButtonText}>{t('voting.step8VoteNow')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step8;
