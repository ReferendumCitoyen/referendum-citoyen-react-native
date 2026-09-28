import React from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image, ScrollView } from 'react-native';
import { VideoView } from 'expo-video';
import { useCameraPermission } from 'react-native-vision-camera';
import { createModalStyles, createStepSpecificStyles, slideFrameStyle, slideScrollContent } from './styles';
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
  /** The device has no NFC reader (every iPad): say so here and offer no
   * start button, rather than a false "activez le NFC" at step 6. */
  nfcUnsupported?: boolean;
  /** Leaves the flow (voting-flow's handleClose). Shown with the no-NFC
   * notice: on Android the sheet has no close button, and without it the
   * step was a dead end (QA 2.0.2, item 11). */
  onExit?: () => void;
  /** Measured height the flow leaves for a slide, as steps 7, 9, 10 and 13
   * take it: bounds the step so its ScrollView can scroll. */
  slideAreaHeight?: number;
}

const Step4: React.FC<Step4Props> = ({ player, introPlayer, containerWidth, onStartAnalysis, onLayout, isPassportFlow = false, nfcUnsupported = false, onExit, slideAreaHeight }) => {
  const { t } = useTranslation();
  const docSfx = isPassportFlow ? 'passport' : 'idCard';
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const { hasPermission, requestPermission } = useCameraPermission();

  const handleStartAnalysis = async () => {
    console.log('🔘 Step4: Start analysis pressed, hasPermission:', hasPermission);

    // Request camera permission before proceeding — passports only. An ID
    // card is opened with its CAN and never uses the camera, so asking would
    // be a permission prompt for nothing.
    if (isPassportFlow && !hasPermission) {
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

  // The intro clip's button used to read "Passer" and only dismissed the video,
  // revealing a second screen whose own button then started the scan. It now
  // says "Démarrer l'analyse" and does exactly that, so the intermediate screen
  // is gone — relabelling alone would have left two identically named buttons
  // one tap apart. The screen below is still the fallback when there is no
  // intro clip to play (tests, or a video that fails to load).
  //
  // Passport flow only: the clip shows a passport being read. The card flow
  // goes straight to the screen below, with the picture of the phone on the
  // card that the chip-reading step shows again.
  const nfcUnsupportedNotice = (
    <Text
      accessibilityRole="alert"
      style={{
        textAlign: 'center',
        marginHorizontal: 24,
        marginVertical: 16,
        fontSize: 16,
        lineHeight: 22,
        color: colors.errorText,
      }}
    >
      {t('voting.nfcUnsupportedDevice')}
    </Text>
  );

  // TODO(intro-video): nothing passes introPlayer any more; see
  // hooks/useModalVideoPlayers.ts for what has to be re-recorded, from the
  // SPECIMEN documents only, before this teaching screen can come back.
  if (introPlayer && isPassportFlow && !nfcUnsupported) {
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
            onPress={handleStartAnalysis}
            accessibilityRole="button"
            accessibilityLabel={t('voting.step4Start')}
          >
            <Text style={stepSpecificStyles.stepIntroSkipButtonText}>{t('voting.step4Start')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    // Bounded and scrollable, like steps 7, 9, 10 and 13 (QA 2.0.2, item 3):
    // at font scale 1.5 on a 320 x 568 screen "Démarrer l'analyse" and
    // "Retour à l'écran d'accueil" ended below the fold with no way to reach
    // them.
    <View style={[{ width: containerWidth }, slideFrameStyle(slideAreaHeight)]} onLayout={onLayout}>
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={slideScrollContent(stepSpecificStyles.step4Container)}
        bounces={false}
      >
        <View style={stepSpecificStyles.step4Content}>
          <Text style={stepSpecificStyles.step4Title}>{t(`voting.step4Title_${docSfx}`)}</Text>
        </View>
        {/* Without NFC the picture of the phone on the card shows a gesture
            that cannot work here, and it pushed the way out below a 320 x 568
            screen: the notice and the button take its place. */}
        {nfcUnsupported ? null : !isPassportFlow ? (
          // The card flow: the phone on the card, same picture as Step 6, so
          // the user has seen the position before the chip read asks for it.
          <Image
            source={require('@/assets/images/nfc-card-phone-position.jpg')}
            style={stepSpecificStyles.step6Image}
            resizeMode="contain"
          />
        ) : Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-passport.png')}
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
        {nfcUnsupported ? nfcUnsupportedNotice : (
          <TouchableOpacity
            style={stepSpecificStyles.step4Button}
            activeOpacity={0.8}
            onPress={handleStartAnalysis}
          >
            <Text style={stepSpecificStyles.step4ButtonText}>{t('voting.step4Start')}</Text>
          </TouchableOpacity>
        )}
        {nfcUnsupported && onExit ? (
          <TouchableOpacity
            style={stepSpecificStyles.step4Button}
            activeOpacity={0.8}
            onPress={onExit}
            accessibilityRole="button"
          >
            <Text style={stepSpecificStyles.step4ButtonText}>{t('common.backToHome')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default Step4;
