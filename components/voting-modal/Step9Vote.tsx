import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, LayoutChangeEvent, Modal } from 'react-native';
import { createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';

interface Step9VoteProps {
  containerWidth: number;
  onVoteSubmit?: (answerIndex: number) => void;
  onCancel?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  onVoteSelect?: (answerIndex: number) => void;
  proposalInfo?: ProposalInfo;
}

const Step9Vote: React.FC<Step9VoteProps> = ({ containerWidth, onVoteSubmit, onCancel, onLayout, onVoteSelect, proposalInfo }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const questionTitle = proposalInfo?.questions[0]?.title ?? 'Vote';
  const variants = proposalInfo?.questions[0]?.variants ?? ['OUI', 'BLANC', 'NON'];

  const handleVoteSelect = (idx: number) => {
    console.log(`[Step9] Vote option tapped: "${variants[idx]}" (index ${idx}) — proposal #${proposalInfo?.id}, variants: [${variants.join(', ')}]`);
    setSelectedIndex(idx);
    if (onVoteSelect) {
      onVoteSelect(idx);
    } else {
      setShowConfirmation(true);
    }
  };

  const handleConfirm = () => {
    if (selectedIndex !== null && onVoteSubmit) {
      setShowConfirmation(false);
      onVoteSubmit(selectedIndex);
    }
  };

  const handleCancelConfirmation = () => {
    setShowConfirmation(false);
    setSelectedIndex(null);
  };

  const getVoteText = () => {
    if (selectedIndex === null) return '';
    return variants[selectedIndex] ?? '';
  };

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
          <Text style={stepSpecificStyles.step9VoteCancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    </View>

    {/* Vote confirmation dialog */}
    <Modal
      visible={showConfirmation}
      transparent
      animationType="fade"
      onRequestClose={handleCancelConfirmation}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
      }}>
        <View style={stepSpecificStyles.step9VoteConfirmationCard}>
          <Text style={stepSpecificStyles.step9VoteTitle}>
            {t('voting.step9Confirm', { vote: getVoteText().toUpperCase() })}
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
              <Text style={stepSpecificStyles.step9VoteCancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={stepSpecificStyles.step9VoteConfirmButton}
              activeOpacity={0.8}
              onPress={handleConfirm}
            >
              <Text style={stepSpecificStyles.step9VoteConfirmButtonText}>
                {t('voting.step9VoteAction', { vote: getVoteText() })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
};

export default Step9Vote;
