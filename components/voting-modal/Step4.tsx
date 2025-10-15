import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { VideoView } from 'expo-video';
import { stepSpecificStyles } from './styles';

interface Step4Props {
  player: any;
  containerWidth: number;
  onStartAnalysis?: () => void;
}

const Step4: React.FC<Step4Props> = ({ player, containerWidth, onStartAnalysis }) => {
  return (
    <View style={[{ width: containerWidth }]}>
      <View style={stepSpecificStyles.step4Container}>
        <View style={stepSpecificStyles.step4Content}>
          <Text style={stepSpecificStyles.step4Title}>Analyse de la Carte d'Identité</Text>
          <Text style={stepSpecificStyles.step4Description}>
            Maintenez votre appareil sur votre Carte d'identité
          </Text>
        </View>
        <VideoView
          style={stepSpecificStyles.step4Video}
          player={player}
          contentFit="cover"
          nativeControls={false}
        />
        <TouchableOpacity
          style={stepSpecificStyles.step4Button}
          activeOpacity={0.8}
          onPress={onStartAnalysis || (() => console.log('Start analysis'))}
        >
          <Text style={stepSpecificStyles.step4ButtonText}>Démarrer l'analyse</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step4;