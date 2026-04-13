import React, { useState } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import LottieView from 'lottie-react-native';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step12SuccessProps {
  containerWidth: number;
  voteIdentifier?: string;
  onViewResults?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step12Success: React.FC<Step12SuccessProps> = ({ containerWidth, voteIdentifier, onViewResults, onLayout }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (voteIdentifier) {
      await Clipboard.setStringAsync(voteIdentifier);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (voteIdentifier) {
      await Share.share({
        message: t('voting.step12ShareMessage', { voteId: voteIdentifier }),
      });
    }
  };

  return (
    <View style={[{ width: containerWidth, height: '100%' }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step12SuccessContainer}>
        <View style={stepSpecificStyles.step12SuccessContent}>
          <Text style={stepSpecificStyles.step12SuccessTitle}>
            {t('voting.step12SuccessTitle')}
          </Text>

          <Text style={stepSpecificStyles.step12SuccessDescription}>
            {t('voting.step12SuccessDescription')}
          </Text>

          <LottieView
            source={require('@/assets/animations/success.json')}
            style={stepSpecificStyles.step12SuccessAnimation}
            autoPlay
            loop={false}
          />

          {voteIdentifier && (
            <View style={{
              width: '100%',
              backgroundColor: colors.background,
              borderRadius: 12,
              padding: 16,
              gap: 8,
            }}>
              <Text style={{
                fontFamily: Typography.fontFamily.medium,
                fontWeight: Typography.fontWeight.medium,
                fontSize: Typography.fontSize.small,
                color: '#666666',
                textAlign: 'center',
              }}>
                {t('voting.step12VoteIdLabel')}
              </Text>

              <Text
                selectable
                style={{
                  fontFamily: Typography.fontFamily.mono || Typography.fontFamily.medium,
                  fontSize: 13,
                  color: colors.text,
                  textAlign: 'center',
                }}
              >
                {voteIdentifier}
              </Text>

              <View style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 12,
                marginTop: 4,
              }}>
                <TouchableOpacity
                  onPress={handleCopy}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 16,
                    backgroundColor: colors.secondary,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{
                    fontFamily: Typography.fontFamily.medium,
                    fontSize: Typography.fontSize.small,
                    color: colors.buttonText,
                  }}>
                    {copied ? t('voting.step12VoteIdCopied') : t('voting.step12VoteIdCopy')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleShare}
                  activeOpacity={0.7}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 16,
                    backgroundColor: colors.secondary,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{
                    fontFamily: Typography.fontFamily.medium,
                    fontSize: Typography.fontSize.small,
                    color: colors.buttonText,
                  }}>
                    {t('voting.step12Share')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={{
                fontFamily: Typography.fontFamily.medium,
                fontWeight: Typography.fontWeight.medium,
                fontSize: 12,
                color: '#666666',
                textAlign: 'center',
                marginTop: 4,
              }}>
                {t('voting.step12VoteIdKeep')}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={stepSpecificStyles.step12SuccessButton}
          activeOpacity={0.8}
          onPress={onViewResults || (() => console.log('View results'))}
        >
          <Text style={stepSpecificStyles.step12SuccessButtonText}>{t('voting.step12SuccessButton')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step12Success;
