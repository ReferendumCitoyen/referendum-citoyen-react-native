import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { ErrorReportButton } from '@/components/ErrorReportButton';

interface Step9ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  isPassportFlow?: boolean;
  error?: unknown;
}

const Step9Error: React.FC<Step9ErrorProps> = ({ containerWidth, onGoHome, onLayout, isPassportFlow = false, error }) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step9ErrorContainer}>
        <View style={stepSpecificStyles.step9ErrorContent}>
          <Text style={stepSpecificStyles.step9ErrorTitle}>
            {t('voting.step9ErrorTitle')}
          </Text>

          <Text style={stepSpecificStyles.step9ErrorDescription}>
            {t(`voting.step9ErrorDescription_${docSfx}`)}
          </Text>

          <LottieView
            source={require('@/assets/animations/error.json')}
            style={stepSpecificStyles.step9ErrorAnimation}
            autoPlay
            loop={false}
          />

          {error != null && <ErrorReportButton error={error} context={{ step: 9, isPassportFlow }} />}
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step9ErrorButton}
          activeOpacity={0.8}
          onPress={onGoHome || (() => console.log('Go home'))}
        >
          <Text style={stepSpecificStyles.step9ErrorButtonText}>{t('common.backToHome')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step9Error;
