import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step10Props {
  containerWidth: number;
  player: any;
  onCancel?: () => void;
  onConfirm?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step10: React.FC<Step10Props> = ({ containerWidth, player, onCancel, onConfirm, onLayout }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step10Container}>
        <View style={stepSpecificStyles.step10Content}>
          <Text style={stepSpecificStyles.step10Title}>
            Vous êtes sûr de vouloir voter: OUI ?
          </Text>

          <VideoView
            style={stepSpecificStyles.step10BallotVideo}
            player={player}
            contentFit="cover"
            nativeControls={false}
          />
        </View>

        <View style={stepSpecificStyles.step10ButtonContainer}>
          <TouchableOpacity
            style={stepSpecificStyles.step10CancelButton}
            activeOpacity={0.8}
            onPress={onCancel || (() => console.log('Cancel'))}
          >
            <Text style={stepSpecificStyles.step10CancelButtonText}>Annuler</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={stepSpecificStyles.step10ConfirmButton}
            activeOpacity={0.8}
            onPress={onConfirm || (() => console.log('Confirm vote'))}
          >
            <Text style={stepSpecificStyles.step10ConfirmButtonText}>Voter Oui</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Step10;
