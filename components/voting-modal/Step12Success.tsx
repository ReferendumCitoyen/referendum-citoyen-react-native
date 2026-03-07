import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step12SuccessProps {
  containerWidth: number;
  onViewResults?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step12Success: React.FC<Step12SuccessProps> = ({ containerWidth, onViewResults, onLayout }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step12SuccessContainer}>
        <View style={stepSpecificStyles.step12SuccessContent}>
          <Text style={stepSpecificStyles.step12SuccessTitle}>
            {t('voting.step12SuccessTitle')}
          </Text>

          <Text style={stepSpecificStyles.step12SuccessDescription}>
            {t('voting.step12SuccessDescription')}
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
          <Text style={stepSpecificStyles.step12SuccessButtonText}>{t('voting.step12SuccessButton')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step12Success;
