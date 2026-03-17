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
}

const Step1: React.FC<Step1Props> = ({ player, containerWidth, onLayout }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);

  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]} onLayout={onLayout}>
      <View style={modalStyles.mediaContainer}>
        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-card.png')}
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
        </View>
      </View>
    </View>
  );
};

export default Step1;
