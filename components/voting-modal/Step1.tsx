import React from 'react';
import { View, Text, ScrollView, LayoutChangeEvent, Platform } from 'react-native';
import {
  createModalStyles,
  slideArtBox,
  slideArtContainerHeight,
  SLIDE_ART_ASPECT,
} from './styles';
import FadeInImage from '@/components/FadeInImage';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { CAP_SMALL } from '@/utils/font-scale-cap';

interface Step1Props {
  containerWidth: number;
  /** Available slide-area height; caps the iOS ScrollView so content scrolls
   * only when it overflows. */
  slideAreaHeight?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Names the entry method in the title: the CAN for an ID card, the MRZ
   * strip for a passport. */
  isPassportFlow?: boolean;
}

const Step1: React.FC<Step1Props> = ({
  containerWidth,
  slideAreaHeight,
  onLayout,
  isPassportFlow = false,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const art = slideArtBox(
    containerWidth,
    isPassportFlow ? SLIDE_ART_ASPECT.step1 : SLIDE_ART_ASPECT.step1Card,
  );

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
        <View
          style={[
            modalStyles.mediaContainer,
            { height: slideArtContainerHeight(art.height) },
          ]}
        >
          {/* The picture shows what the step asks the user to find. Card
              flow: the front of the card with the CAN picked out — the same
              picture the CAN step shows, which is what the testers asked for
              (2026-09-15: the MRZ composite is the wrong picture for a CAN
              step). Passport flow: an ID card and a passport side by side
              with the MRZ picked out, the whole of which has to stay visible
              — half of it being cropped away was exactly the bug. See
              slideArtBox. */}
          <FadeInImage
            source={
              isPassportFlow
                ? require('@/assets/images/step1-mrz-documents.jpg')
                : require('@/assets/images/card-can-location.jpg')
            }
            style={art}
            resizeMode="contain"
          />
        </View>
        <View style={modalStyles.contentSection}>
          <View style={modalStyles.stepContent}>
            <View style={modalStyles.stepHeader}>
              <View style={modalStyles.numberCircle}>
                <Text style={modalStyles.numberText} maxFontSizeMultiplier={CAP_SMALL}>
                  1
                </Text>
              </View>
              <Text style={modalStyles.stepTitle} maxFontSizeMultiplier={CAP_SMALL}>
                {t(`voting.step1Title_${isPassportFlow ? 'passport' : 'idCard'}`)}
              </Text>
            </View>
            <Text style={modalStyles.stepDescription} maxFontSizeMultiplier={CAP_SMALL}>
              {t('voting.step1Description')}
            </Text>
            {/* Kept for a locale that still has a second line; French now
                says everything in the one sentence above (B5, 2026-09-13). */}
            {t('voting.step1Privacy') ? (
              <Text
                style={[
                  modalStyles.stepDescription,
                  { fontWeight: 'bold', color: colors.errorText, marginTop: 8 },
                ]}
                maxFontSizeMultiplier={CAP_SMALL}
              >
                {t('voting.step1Privacy')}
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

export default Step1;
