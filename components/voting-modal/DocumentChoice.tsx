import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform } from 'react-native';
import FadeInImage from '@/components/FadeInImage';
import { createModalStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { CAP_SMALL } from '@/utils/font-scale-cap';
import { Svg, Path } from 'react-native-svg';

interface DocumentChoiceProps {
  /** Called once with the user's pick — true = passport, false = ID card. */
  onSelect: (isPassport: boolean) => void;
  slideAreaHeight?: number;
}

const ChevronIcon = ({ color }: { color: string }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 6l6 6-6 6"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Thumbnail geometry. The slot is square so the two rows line up; each picture
// fills it on its long edge and keeps its own ratio on the short one.
const THUMB_SLOT = 56;
const THUMB_ID_CARD = { width: THUMB_SLOT, height: Math.round(THUMB_SLOT * (168 / 264)), borderRadius: 4 };
const THUMB_PASSPORT = { width: Math.round(THUMB_SLOT * (121 / 168)), height: THUMB_SLOT, borderRadius: 4 };

// Gate screen shown before the numbered step carousel. Unlike the prime
// app (where the document type is dictated by which proposal/contract the
// user tapped — see isPassportVotingTarget), this beta always lets the
// user pick, since the whole point here is exercising both scan paths and
// the vote/register backend is mocked anyway (constants/mock-backend.ts).
const DocumentChoice: React.FC<DocumentChoiceProps> = ({ onSelect, slideAreaHeight }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);

  const renderOption = (kind: 'idCard' | 'passport') => {
    const isPassport = kind === 'passport';
    return (
      <TouchableOpacity
        key={kind}
        activeOpacity={0.7}
        onPress={() => onSelect(isPassport)}
        accessibilityRole="button"
        accessibilityLabel={t(`voting.documentChoice${isPassport ? 'Passport' : 'IdCard'}Title`)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
          backgroundColor: colors.cardBackground,
        }}
      >
        {/* A fixed square slot keeps both rows' text starting at the same x,
            while the picture inside it is given its own ratio — 264×168 for
            the card, 121×168 for the passport. Letterboxing inside a square
            box relied on resizeMode surviving the wrapper, and it didn't:
            both thumbnails were coming out cropped. */}
        <View
          style={{
            width: THUMB_SLOT,
            height: THUMB_SLOT,
            marginRight: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FadeInImage
            source={
              isPassport
                ? require('@/assets/images/doc-thumb-passport.jpg')
                : require('@/assets/images/doc-thumb-idcard.jpg')
            }
            style={isPassport ? THUMB_PASSPORT : THUMB_ID_CARD}
            resizeMode="contain"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: Typography.fontFamily.semibold,
              fontSize: Typography.fontSize.body,
              color: colors.text,
            }}
            maxFontSizeMultiplier={CAP_SMALL}
          >
            {t(`voting.documentChoice${isPassport ? 'Passport' : 'IdCard'}Title`)}
          </Text>
          <Text
            style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.textSecondary || colors.text,
              opacity: 0.7,
              marginTop: 2,
            }}
            maxFontSizeMultiplier={CAP_SMALL}
          >
            {t(`voting.documentChoice${isPassport ? 'Passport' : 'IdCard'}Subtitle`)}
          </Text>
        </View>
        <ChevronIcon color={colors.textSecondary || colors.text} />
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={[
        { width: '100%' },
        Platform.OS === 'ios' ? { maxHeight: slideAreaHeight } : { flex: 1 },
      ]}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24 }}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <Text style={modalStyles.stepTitle} maxFontSizeMultiplier={CAP_SMALL}>
        {t('voting.documentChoiceTitle')}
      </Text>
      <Text
        style={[modalStyles.stepDescription, { marginTop: 8, marginBottom: 24 }]}
        maxFontSizeMultiplier={CAP_SMALL}
      >
        {t('voting.documentChoiceDescription')}
      </Text>

      {renderOption('idCard')}
      {renderOption('passport')}
    </ScrollView>
  );
};

export default DocumentChoice;
