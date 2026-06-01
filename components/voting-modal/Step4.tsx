import React, { useState } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { useCameraPermission } from 'react-native-vision-camera';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step4Props {
  player: any;
  // Intro clip that plays *before* the "Démarrer l'analyse" content.
  // Optional so the test renders stay green.
  introPlayer?: any;
  containerWidth: number;
  onStartAnalysis?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  isPassportFlow?: boolean;
}

const Step4: React.FC<Step4Props> = ({ player, introPlayer, containerWidth, onStartAnalysis, onLayout, isPassportFlow = false }) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const { hasPermission, requestPermission } = useCameraPermission();

  // Intro phase. Voters who've gone through the flow before can tap "Passer"
  // to skip straight to the analysis CTA. Plays on both platforms — the
  // Android branch uses a re-muxed MP4 (see useModalVideoPlayers).
  const [showIntro, setShowIntro] = useState(true);

  const handleStartAnalysis = async () => {
    console.log('🔘 Step4: Start analysis pressed, hasPermission:', hasPermission);

    // Request camera permission before proceeding
    if (!hasPermission) {
      console.log('📸 Step4: Requesting camera permission...');
      const granted = await requestPermission();
      console.log('📸 Step4: Permission result:', granted);

      if (!granted) {
        // Permission denied - stay on this step
        console.log('❌ Step4: Camera permission denied');
        return;
      }
    }

    // Permission granted or already had it - proceed to next step
    console.log('✅ Step4: Permission OK, proceeding to Step 5');
    onStartAnalysis?.();
  };

  if (showIntro && introPlayer) {
    return (
      <View style={[{ width: containerWidth }]} onLayout={onLayout}>
        <View style={stepSpecificStyles.stepIntroContainer}>
          <VideoView
            style={stepSpecificStyles.stepIntroVideo}
            player={introPlayer}
            contentFit="contain"
            nativeControls={false}
          />
          <TouchableOpacity
            style={stepSpecificStyles.stepIntroSkipButton}
            activeOpacity={0.8}
            onPress={() => setShowIntro(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.skip')}
          >
            <Text style={stepSpecificStyles.stepIntroSkipButtonText}>{t('common.skip')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step4Container}>
        <View style={stepSpecificStyles.step4Content}>
          <Text style={stepSpecificStyles.step4Title}>{t(`voting.step4Title_${docSfx}`)}</Text>
        </View>
        {Platform.OS === 'android' ? (
          <Image
            // poster-passport.png is currently a placeholder copy of
            // poster-card.png — see Step1.tsx for the same TODO.
            source={isPassportFlow
              ? require('@/assets/images/poster-passport.png')
              : require('@/assets/images/poster-card.png')}
            style={stepSpecificStyles.step4Video}
            resizeMode="cover"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.step4Video}
            player={player}
            contentFit="cover"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}
        <TouchableOpacity
          style={stepSpecificStyles.step4Button}
          activeOpacity={0.8}
          onPress={handleStartAnalysis}
        >
          <Text style={stepSpecificStyles.step4ButtonText}>{t('voting.step4Start')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step4;
