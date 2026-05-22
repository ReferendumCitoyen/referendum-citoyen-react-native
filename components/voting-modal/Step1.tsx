import React from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step1Props {
  player: any;
  containerWidth: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** True for TD3 passport flow; selects passport-themed poster art.
   * Placeholder asset for now — see poster-passport.png. */
  isPassportFlow?: boolean;
}

const Step1: React.FC<Step1Props> = ({ player, containerWidth, onLayout, isPassportFlow = false }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);

  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]} onLayout={onLayout}>
      <View style={modalStyles.mediaContainer}>
        {Platform.OS === 'android' ? (
          <Image
            // poster-passport.png is currently a placeholder copy of
            // poster-card.png — replace with passport-themed art before
            // production. The conditional require lives directly inside
            // the JSX so Metro statically resolves both paths.
            source={isPassportFlow
              ? require('@/assets/images/poster-passport.png')
              : require('@/assets/images/poster-card.png')}
            style={stepSpecificStyles.cardVideo}
            resizeMode="cover"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.cardVideo}
            player={player}
            contentFit="cover"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}
      </View>
      <View style={modalStyles.contentSection}>
        <View style={modalStyles.stepContent}>
          <View style={modalStyles.stepHeader}>
            <View style={modalStyles.numberCircle}>
              <Text style={modalStyles.numberText}>1</Text>
            </View>
            <Text style={modalStyles.stepTitle}>{t('voting.step1Title')}</Text>
          </View>
          <Text style={modalStyles.stepDescription}>
            {t('voting.step1Description')}
          </Text>
          <Text style={[modalStyles.stepDescription, { fontWeight: 'bold', color: colors.errorText, marginTop: 8 }]}>
            {t('voting.step1Privacy')}
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Step1;
