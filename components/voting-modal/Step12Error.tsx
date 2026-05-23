import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Dimensions } from 'react-native';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { ErrorReportButton } from '@/components/ErrorReportButton';

interface Step12ErrorProps {
  containerWidth: number;
  onGoHome?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  errorReason?: string | null;
  error?: unknown;
}

// On Android, voting-flow's slidingWrapper has flex: 0 so percentage heights
// inside slides collapse. We need a real minHeight, otherwise the content is
// laid out around y=0 and ends up mostly off-screen.
const ANDROID_SLIDE_MIN_HEIGHT = Math.round(Dimensions.get('window').height * 0.75);

const Step12Error: React.FC<Step12ErrorProps> = ({ containerWidth, onGoHome, onLayout, errorReason, error }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View
      style={[
        { width: containerWidth },
        Platform.OS === 'android'
          ? { minHeight: ANDROID_SLIDE_MIN_HEIGHT }
          : { height: '100%' },
      ]}
      onLayout={onLayout}
    >
      <View style={stepSpecificStyles.step12ErrorContainer}>
        <View style={stepSpecificStyles.step12ErrorContent}>
          <Text style={stepSpecificStyles.step12ErrorTitle}>
            {t('voting.step12ErrorTitle')}
          </Text>

          <Text style={stepSpecificStyles.step12ErrorDescription}>
            {errorReason || t('voting.step12ErrorDescription')}
          </Text>

          <LottieView
            source={require('@/assets/animations/error.json')}
            style={stepSpecificStyles.step12ErrorAnimation}
            autoPlay
            loop={false}
          />

          {error != null && (
            <ErrorReportButton error={error} context={{ step: 12, reason: errorReason ?? null }} />
          )}
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step12ErrorButton}
          activeOpacity={0.8}
          onPress={onGoHome || (() => console.log('Go home'))}
        >
          <Text style={stepSpecificStyles.step12ErrorButtonText}>{t('common.backToHome')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step12Error;
