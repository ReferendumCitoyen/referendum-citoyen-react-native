import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, LayoutChangeEvent, Modal, ScrollView } from 'react-native';
import { createStepSpecificStyles, slideBoxStyle, slideFooterStyle, slideScrollContent } from './styles';
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
  /** Measured slide area (voting-flow): bounds the slide so it scrolls. */
  slideAreaHeight?: number;
}

const Step9Vote: React.FC<Step9VoteProps> = ({ containerWidth, onVoteSubmit, onCancel, onLayout, onVoteSelect, proposalInfo, slideAreaHeight }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // The referendum's own name, not questions[0].title — that field holds the
  // ballot wording ("Approuvez-vous le plan…"), which duplicates what the
  // options below already ask. Step 10 and Step 12 read the same field so all
  // three screens name the vote identically. Falls back to the question text
  // for any proposal that has no title.
  const questionTitle = proposalInfo?.title || proposalInfo?.questions[0]?.title || 'Vote';
  const variants = proposalInfo?.questions[0]?.variants ?? ['OUI', 'BLANC', 'NON'];

  const handleVoteSelect = (idx: number) => {
    // Vote choice intentionally NOT logged — this is an anonymous voting
    // flow; recording the user's choice in logcat / Metro stdout would
    // defeat the privacy property. Log the proposal id only.
    console.log(`[Step9] Vote option tapped on proposal #${proposalInfo?.id}`);
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
    {/* Bounded and scrollable (QA 2.0.2, item 2): a long question pushed
        "Annuler", and at font scale 1.3 "Non" and "Blanc", below the screen. */}
    <View style={[{ width: containerWidth }, slideBoxStyle(slideAreaHeight)]} onLayout={onLayout}>
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        // flex-start: the options stay under the question as before, instead
        // of being spread over the whole slide by space-between.
        contentContainerStyle={[
          slideScrollContent(stepSpecificStyles.step9VoteContainer),
          { justifyContent: 'flex-start' },
        ]}
        bounces={false}
      >
        <Text style={stepSpecificStyles.step9VoteTitle}>
          {questionTitle}
        </Text>

      </ScrollView>
      {/* Every option, and Annuler, in a fixed footer outside the scroll
          (2026-09-24): with four options and a long question, an iPhone SE
          or a 360 x 640 phone at text size 1.3 showed the first options and
          hid the last below the fold. A ballot must show all its options at
          once; the question above is what scrolls. */}
      <View style={[slideFooterStyle(colors, 24), { gap: 16 }]}>
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
        backgroundColor: colors.overlay,
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
