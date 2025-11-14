import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';

interface Step10Props {
  containerWidth: number;
  player: any;
  onCancel?: () => void;
  onConfirm?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  selectedVote?: 'oui' | 'blanc' | 'non';
}

const Step10: React.FC<Step10Props> = ({ containerWidth, player, onCancel, onConfirm, onLayout, selectedVote = 'oui' }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);

  const getVoteText = () => {
    if (selectedVote === 'oui') return 'OUI';
    if (selectedVote === 'non') return 'NON';
    return 'BLANC';
  };

  const getButtonText = () => {
    if (selectedVote === 'oui') return 'Voter Oui';
    if (selectedVote === 'non') return 'Voter Non';
    return 'Voter Blanc';
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step10Container}>
        <View style={stepSpecificStyles.step10Content}>
          <Text style={stepSpecificStyles.step10Title}>
            Vous êtes sûr de vouloir voter: {getVoteText()} ?
          </Text>

          {Platform.OS === 'android' ? (
            <Image
              source={require('@/assets/images/poster-ballot.png')}
              style={stepSpecificStyles.step10BallotVideo}
              resizeMode="cover"
            />
          ) : (
            <VideoView
              style={stepSpecificStyles.step10BallotVideo}
              player={player}
              contentFit="cover"
              nativeControls={false}
              surfaceType="textureView"
            />
          )}
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
            <Text style={stepSpecificStyles.step10ConfirmButtonText}>{getButtonText()}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Step10;
