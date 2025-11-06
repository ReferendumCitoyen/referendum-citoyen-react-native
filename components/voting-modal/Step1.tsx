import React from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step1Props {
  player: any;
  containerWidth: number;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step1: React.FC<Step1Props> = ({ player, containerWidth, onLayout }) => {
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
            <Text style={modalStyles.stepTitle}>Scannez votre Carte d'identité anonymement</Text>
          </View>
          <Text style={modalStyles.stepDescription}>
            Scannez votre Carte d'identité pour valider votre âge et votre nationalité. Vos données sont chiffrées et non traçables. Vous êtes 100% anonyme.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Step1;