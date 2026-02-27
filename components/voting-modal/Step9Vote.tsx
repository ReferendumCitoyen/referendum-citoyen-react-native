import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, LayoutChangeEvent } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';

interface Step9VoteProps {
  containerWidth: number;
  onVoteSubmit?: (vote: 'oui' | 'blanc' | 'non') => void;
  onCancel?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onVoteSelect?: (vote: 'oui' | 'blanc' | 'non') => void;
}

const Step9Vote: React.FC<Step9VoteProps> = ({ containerWidth, onVoteSubmit, onCancel, onLayout, onVoteSelect }) => {
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [selectedVote, setSelectedVote] = useState<'oui' | 'blanc' | 'non' | null>(null);
  const confirmationModalRef = useRef<BottomSheetModal>(null);

  const handleVoteSelect = (vote: 'oui' | 'blanc' | 'non') => {
    setSelectedVote(vote);
    if (onVoteSelect) {
      onVoteSelect(vote);
    } else {
      confirmationModalRef.current?.present();
    }
  };

  const handleConfirm = () => {
    if (selectedVote && onVoteSubmit) {
      confirmationModalRef.current?.dismiss();
      onVoteSubmit(selectedVote);
    }
  };

  const handleCancelConfirmation = () => {
    confirmationModalRef.current?.dismiss();
    setSelectedVote(null);
  };

  const getVoteText = () => {
    if (selectedVote === 'oui') return 'OUI';
    if (selectedVote === 'non') return 'NON';
    return 'BLANC';
  };

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  return (
    <>
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step9VoteContainer}>
        <Text style={stepSpecificStyles.step9VoteTitle}>
          Approuvez vous la Loi instaurant les zones à faibles émissions mobilité ?
        </Text>

        <View style={stepSpecificStyles.step9VoteOptionsContainer}>
          <TouchableOpacity
            style={stepSpecificStyles.step9VoteOptionButton}
            activeOpacity={0.8}
            onPress={() => handleVoteSelect('oui')}
          >
            <Text style={stepSpecificStyles.step9VoteOptionButtonText}>OUI</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={stepSpecificStyles.step9VoteOptionButton}
            activeOpacity={0.8}
            onPress={() => handleVoteSelect('blanc')}
          >
            <Text style={stepSpecificStyles.step9VoteOptionButtonText}>BLANC</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={stepSpecificStyles.step9VoteOptionButton}
            activeOpacity={0.8}
            onPress={() => handleVoteSelect('non')}
          >
            <Text style={stepSpecificStyles.step9VoteOptionButtonText}>NON</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step9VoteCancelButtonFullWidth}
          activeOpacity={0.8}
          onPress={onCancel}
        >
          <Text style={stepSpecificStyles.step9VoteCancelButtonText}>Annuler</Text>
        </TouchableOpacity>
      </View>
    </View>

      <BottomSheetModal
        ref={confirmationModalRef}
        snapPoints={[415]}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        backgroundStyle={{ backgroundColor: colors.white, borderRadius: 32 }}
        handleIndicatorStyle={{ backgroundColor: colors.border }}
      >
        <View style={stepSpecificStyles.step9VoteConfirmationCard}>
          <Text style={stepSpecificStyles.step9VoteTitle}>
            Vous êtes sûr de vouloir voter: {getVoteText()} ?
          </Text>

          <Image
            source={require('@/assets/images/poster-ballot.png')}
            style={stepSpecificStyles.step9VoteImage}
            resizeMode="contain"
          />

          <View style={stepSpecificStyles.step9VoteButtonRow}>
            <TouchableOpacity
              style={stepSpecificStyles.step9VoteCancelButton}
              activeOpacity={0.8}
              onPress={handleCancelConfirmation}
            >
              <Text style={stepSpecificStyles.step9VoteCancelButtonText}>Annuler</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={stepSpecificStyles.step9VoteConfirmButton}
              activeOpacity={0.8}
              onPress={handleConfirm}
            >
              <Text style={stepSpecificStyles.step9VoteConfirmButtonText}>
                Voter {getVoteText() === 'OUI' ? 'Oui' : getVoteText() === 'NON' ? 'Non' : 'Blanc'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
};

export default Step9Vote;
