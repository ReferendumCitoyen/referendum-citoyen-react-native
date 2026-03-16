import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, LayoutChangeEvent } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';

interface Step9VoteProps {
  containerWidth: number;
  onVoteSubmit?: (answerIndex: number) => void;
  onCancel?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onVoteSelect?: (answerIndex: number) => void;
  proposalInfo?: ProposalInfo;
}

const Step9Vote: React.FC<Step9VoteProps> = ({ containerWidth, onVoteSubmit, onCancel, onLayout, onVoteSelect, proposalInfo }) => {
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const confirmationModalRef = useRef<BottomSheetModal>(null);

  const questionTitle = proposalInfo?.questions[0]?.title ?? 'Vote';
  const variants = proposalInfo?.questions[0]?.variants ?? ['OUI', 'BLANC', 'NON'];

  const handleVoteSelect = (idx: number) => {
    setSelectedIndex(idx);
    if (onVoteSelect) {
      onVoteSelect(idx);
    } else {
      confirmationModalRef.current?.present();
    }
  };

  const handleConfirm = () => {
    if (selectedIndex !== null && onVoteSubmit) {
      confirmationModalRef.current?.dismiss();
      onVoteSubmit(selectedIndex);
    }
  };

  const handleCancelConfirmation = () => {
    confirmationModalRef.current?.dismiss();
    setSelectedIndex(null);
  };

  const getVoteText = () => {
    if (selectedIndex === null) return '';
    return variants[selectedIndex] ?? '';
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
          {questionTitle}
        </Text>

        <View style={stepSpecificStyles.step9VoteOptionsContainer}>
          {variants.map((variant, idx) => (
            <TouchableOpacity
              key={idx}
              style={stepSpecificStyles.step9VoteOptionButton}
              activeOpacity={0.8}
              onPress={() => handleVoteSelect(idx)}
            >
              <Text style={stepSpecificStyles.step9VoteOptionButtonText}>{variant}</Text>
            </TouchableOpacity>
          ))}
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
                Voter {getVoteText()}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
};

export default Step9Vote;
