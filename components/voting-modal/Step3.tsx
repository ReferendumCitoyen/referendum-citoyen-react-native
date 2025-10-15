import React from 'react';
import { View, Text } from 'react-native';
import { VideoView } from 'expo-video';
import { modalStyles, stepSpecificStyles } from './styles';

interface Step3Props {
  player: any;
  containerWidth: number;
}

const Step3: React.FC<Step3Props> = ({ player, containerWidth }) => {
  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]}>
      <View style={modalStyles.mediaContainer}>
        <VideoView
          style={stepSpecificStyles.ballotImage}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />
      </View>
      <View style={modalStyles.contentSection}>
        <View style={modalStyles.stepContent}>
          <View style={modalStyles.stepHeader}>
            <View style={modalStyles.numberCircle}>
              <Text style={modalStyles.numberText}>3</Text>
            </View>
            <Text style={modalStyles.stepTitle}>Vote anonyme</Text>
          </View>
          <Text style={modalStyles.stepDescription}>
            Une fois vos données vérifiées et authentiques, l'application produit un jeton anonyme vous permettant de voter.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Step3;