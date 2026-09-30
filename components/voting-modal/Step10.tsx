import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image, ScrollView } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles, slideBoxStyle, slideFooterStyle, slideScrollContent } from './styles';
import { Spacing, useColors } from '@/constants/theme';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';

interface Step10Props {
  containerWidth: number;
  player: any;
  onCancel?: () => void;
  onConfirm?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  selectedVote?: number;
  proposalInfo?: ProposalInfo;
  /** Measured slide area (voting-flow): bounds the slide so it scrolls. */
  slideAreaHeight?: number;
}

const Step10: React.FC<Step10Props> = ({ containerWidth, player, onCancel, onConfirm, onLayout, selectedVote = 0, proposalInfo, slideAreaHeight }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);

  const variants = proposalInfo?.questions[0]?.variants ?? ['OUI', 'BLANC', 'NON'];
  const variantName = variants[selectedVote] ?? '';

  useEffect(() => {
    if (proposalInfo) {
      // No variant / index — anonymous voting (see Step9Vote comment).
      console.log(`[Step10] Confirming vote for proposal #${proposalInfo.id}`);
    }
  }, [selectedVote, proposalInfo]);

  const getVoteText = () => variantName.toUpperCase();
  const getButtonText = () => t('voting.step10VoteAction', { vote: variantName });

  return (
    // Bounded and scrollable (QA 2.0.2, item 3): at font scale 1.3 the
    // confirm buttons went below a 320 x 568 screen.
    <View style={[{ width: containerWidth }, slideBoxStyle(slideAreaHeight)]} onLayout={onLayout}>
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={slideScrollContent(stepSpecificStyles.step10Container)}
        bounces={false}
      >
        <View style={stepSpecificStyles.step10Content}>
          {/* Repeat the question here: this is the last screen before the vote
              is cast, and until now it named the answer without ever saying
              what the answer was to. Same field as Step 9 and Step 12 so all
              three name the vote identically. */}
          {(proposalInfo?.title || proposalInfo?.questions[0]?.title) ? (
            <Text style={stepSpecificStyles.step10Question}>
              {proposalInfo?.title || proposalInfo?.questions[0]?.title}
            </Text>
          ) : null}

          <Text style={stepSpecificStyles.step10Title}>
            {t('voting.step10Confirm', { vote: getVoteText() })}
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

      </ScrollView>
      {/* Fixed footer, outside the scroll (2026-09-24): at text size 1.3 on
          an iPhone SE the question, the confirmation line and the ballot
          picture pushed Annuler / Confirmer below the fold. The last decision
          before a vote is cast stays on screen. */}
      <View style={[slideFooterStyle(colors, Spacing.modal.step10Padding), stepSpecificStyles.step10ButtonContainer]}>
          <TouchableOpacity
            style={stepSpecificStyles.step10CancelButton}
            activeOpacity={0.8}
            onPress={onCancel || (() => console.log('Cancel'))}
          >
            <Text style={stepSpecificStyles.step10CancelButtonText}>{t('common.cancel')}</Text>
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
  );
};

export default Step10;
