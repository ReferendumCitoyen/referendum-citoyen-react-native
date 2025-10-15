import React from 'react';
import { View, Text } from 'react-native';
import { VideoView } from 'expo-video';
import { stepSpecificStyles } from './styles';

interface Step7Props {
  containerWidth: number;
  player: any;
}

const Step7: React.FC<Step7Props> = ({ containerWidth, player }) => {
  return (
    <View style={[{ width: containerWidth }]}>
      <View style={stepSpecificStyles.step7Container}>
        <Text style={stepSpecificStyles.step7Title}>Vérification locale</Text>

        <VideoView
          style={stepSpecificStyles.step7Image}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />

        <Text style={stepSpecificStyles.step7Description}>
          Vérification de votre âge et nationalité localement sur votre appareil. Veuillez patienter, cela peut prendre jusqu'à 1 minute…
        </Text>
      </View>
    </View>
  );
};

export default Step7;
