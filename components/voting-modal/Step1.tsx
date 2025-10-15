import React from 'react';
import { View, Text } from 'react-native';
import { VideoView } from 'expo-video';
import { modalStyles, stepSpecificStyles } from './styles';

interface Step1Props {
  player: any;
  containerWidth: number;
}

const Step1: React.FC<Step1Props> = ({ player, containerWidth }) => {
  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]}>
      <View style={modalStyles.mediaContainer}>
        <VideoView
          style={stepSpecificStyles.cardVideo}
          player={player}
          contentFit="cover"
          nativeControls={false}
        />
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