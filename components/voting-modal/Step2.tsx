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

interface Step2Props {
  containerWidth: number;
  slideAreaHeight?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Only the body copy is document-specific now — the artwork above is
   * shared between both flows. */
  isPassportFlow?: boolean;
}

const Step2: React.FC<Step2Props> = ({
  containerWidth,
  slideAreaHeight,
  onLayout,
  isPassportFlow = false,
}) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const art = slideArtBox(containerWidth, SLIDE_ART_ASPECT.step2);
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
          {/* Photo of the actual gesture — card held against the back of the
              phone while the NFC prompt is up — rather than the abstract
              phone render this used before. Same on both platforms.

              Boxed to the photo's own ratio so the card at the right-hand
              edge stays in frame — it was being cropped off. */}
          <FadeInImage
            source={require('@/assets/images/step2-nfc-chip.jpg')}
            style={art}
            resizeMode="contain"
          />
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
