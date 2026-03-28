import React from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step3Props {
  player: any;
  containerWidth: number;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step3: React.FC<Step3Props> = ({ player, containerWidth, onLayout }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]} onLayout={onLayout}>
      <View style={modalStyles.mediaContainer}>
        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-ballot.png')}
            style={stepSpecificStyles.ballotImage}
            resizeMode="contain"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.ballotImage}
            player={player}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}
      </View>
      <View style={modalStyles.contentSection}>
        <View style={modalStyles.stepContent}>
          <View style={modalStyles.stepHeader}>
            <View style={modalStyles.numberCircle}>
              <Text style={modalStyles.numberText}>3</Text>
            </View>
            <Text style={modalStyles.stepTitle}>{t('voting.step3Title')}</Text>
          </View>
          <Text style={modalStyles.stepDescription}>
            {t('voting.step3Description')}
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Step3;
