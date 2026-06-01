import React from 'react';
import { View, Text, ScrollView, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { CAP_SMALL } from '@/utils/font-scale-cap';

interface Step2Props {
  player: any;
  containerWidth: number;
  slideAreaHeight?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  isPassportFlow?: boolean;
}

const Step2: React.FC<Step2Props> = ({
  player,
  containerWidth,
  slideAreaHeight,
  onLayout,
  isPassportFlow = false,
}) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  return (
    <View style={[modalStyles.stepSlide, { width: containerWidth }]} onLayout={onLayout}>
      <ScrollView
        style={[
          { width: '100%' },
          Platform.OS === 'ios' ? { maxHeight: slideAreaHeight } : { flex: 1 },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={modalStyles.mediaContainer}>
          {Platform.OS === 'android' ? (
            <Image
              source={require('@/assets/images/poster-phone.png')}
              style={stepSpecificStyles.phoneImage}
              resizeMode="contain"
            />
          ) : (
            <VideoView
              style={stepSpecificStyles.phoneImage}
              player={player}
              contentFit="contain"
              nativeControls={false}
              surfaceType="textureView"
              allowsVideoFrameAnalysis={false}
            />
          )}
        </View>
        <View style={modalStyles.contentSection}>
          <View style={modalStyles.stepContent}>
            <View style={modalStyles.stepHeader}>
              <View style={modalStyles.numberCircle}>
                <Text style={modalStyles.numberText} maxFontSizeMultiplier={CAP_SMALL}>
                  2
                </Text>
              </View>
              <Text style={modalStyles.stepTitle} maxFontSizeMultiplier={CAP_SMALL}>
                {t('voting.step2Title')}
              </Text>
            </View>
            <Text style={modalStyles.stepDescription} maxFontSizeMultiplier={CAP_SMALL}>
              {t(`voting.step2Description_${docSfx}`)}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default Step2;
