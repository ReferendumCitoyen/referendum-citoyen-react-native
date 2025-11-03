import React from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step2Props {
  player: any;
  containerWidth: number;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step2: React.FC<Step2Props> = ({ player, containerWidth, onLayout }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]} onLayout={onLayout}>
      <View style={modalStyles.mediaContainer}>
        <VideoView
          style={stepSpecificStyles.phoneImage}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />
      </View>
      <View style={modalStyles.contentSection}>
        <View style={modalStyles.stepContent}>
          <View style={modalStyles.stepHeader}>
            <View style={modalStyles.numberCircle}>
              <Text style={modalStyles.numberText}>2</Text>
            </View>
            <Text style={modalStyles.stepTitle}>Vérifiez votre âge et nationalité localement sur votre appareil</Text>
          </View>
          <Text style={modalStyles.stepDescription}>
            Cette application vérifie les données sur la puce NFC à l'intérieur de votre Carte d'identité. Les données ne sont pas transférées ni conservées sur un serveur tiers.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Step2;