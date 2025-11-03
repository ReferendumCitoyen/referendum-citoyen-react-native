import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step6Props {
  containerWidth: number;
  player: any;
  onAnalyze?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step6: React.FC<Step6Props> = ({ containerWidth, player, onAnalyze, onLayout }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step6Container}>
        <Text style={stepSpecificStyles.step6Title}>Lecteur NFC</Text>

        <View style={stepSpecificStyles.step6ImageContainer}>
          <VideoView
            style={stepSpecificStyles.step6Image}
            player={player}
            contentFit="contain"
            nativeControls={false}
          />
        </View>

        <View style={stepSpecificStyles.step6ButtonContainer}>
          <TouchableOpacity
            style={stepSpecificStyles.step6Button}
            activeOpacity={0.8}
            onPress={onAnalyze || (() => console.log('Analyze NFC'))}
          >
            <Text style={stepSpecificStyles.step6ButtonText}>Analyse</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Step6;