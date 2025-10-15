import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Text, StyleSheet, View, TouchableOpacity, Animated, Easing } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { Svg, Path, Circle } from 'react-native-svg';

interface VotingModalSimpleProps {
  isVisible: boolean;
  onClose: () => void;
}

const VotingModalSimple = ({ isVisible, onClose }: VotingModalSimpleProps) => {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);
  const [currentStep, setCurrentStep] = useState(1);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(375);
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  const player = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4846_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  const player2 = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  const player3 = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5078_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.present();
      setCurrentStep(1); // Reset to step 1 when opening
      slideAnim.setValue(0); // Reset animation position
      progressOpacity1.setValue(1);
      progressOpacity2.setValue(0.25);
      progressOpacity3.setValue(0.25);
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [isVisible, slideAnim, progressOpacity1, progressOpacity2, progressOpacity3]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (currentStep < 3) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);

      // Slide animation
      Animated.timing(slideAnim, {
        toValue: -(nextStep - 1) * containerWidth,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      // Progress bar animations
      if (nextStep === 2) {
        Animated.timing(progressOpacity2, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      } else if (nextStep === 3) {
        Animated.timing(progressOpacity3, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }
    }
  }, [currentStep, slideAnim, containerWidth, progressOpacity2, progressOpacity3]);


  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.bottomSheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      onDismiss={handleDismiss}
    >
      <BottomSheetView
        style={styles.container}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Processus de vote</Text>
        </View>

        {/* Sliding Container */}
        <View style={styles.slidingWrapper}>
          <Animated.View
            style={[
              styles.slidingContainer,
              {
                transform: [{ translateX: slideAnim }],
              }
            ]}
          >
            {/* Step 1 */}
            <View style={[styles.stepSlide, { width: containerWidth }]}>
              <View style={styles.mediaContainer}>
                <VideoView
                  style={styles.cardVideo}
                  player={player}
                  contentFit="cover"
                  nativeControls={false}
                />
              </View>
              <View style={styles.contentSection}>
                <View style={styles.stepContent}>
                  <View style={styles.stepHeader}>
                    <View style={styles.numberCircle}>
                      <Text style={styles.numberText}>1</Text>
                    </View>
                    <Text style={styles.stepTitle}>Scannez votre Carte d'identité anonymement</Text>
                  </View>
                  <Text style={styles.stepDescription}>
                    Scannez votre Carte d'identité pour valider votre âge et votre nationalité. Vos données sont chiffrées et non traçables. Vous êtes 100% anonyme.
                  </Text>
                </View>
              </View>
            </View>

            {/* Step 2 */}
            <View style={[styles.stepSlide, { width: containerWidth }]}>
              <View style={styles.mediaContainer}>
                <VideoView
                  style={styles.phoneImage}
                  player={player2}
                  contentFit="contain"
                  nativeControls={false}
                />
              </View>
              <View style={styles.contentSection}>
                <View style={styles.stepContent}>
                  <View style={styles.stepHeader}>
                    <View style={styles.numberCircle}>
                      <Text style={styles.numberText}>2</Text>
                    </View>
                    <Text style={styles.stepTitle}>Vérifiez votre âge et nationalité localement sur votre appareil</Text>
                  </View>
                  <Text style={styles.stepDescription}>
                    Cette application vérifie les données sur la puce NFC à l'intérieur de votre Carte d'identité. Les données ne sont pas transférées ni conservées sur un serveur tiers.
                  </Text>
                </View>
              </View>
            </View>

            {/* Step 3 */}
            <View style={[styles.stepSlide, { width: containerWidth }]}>
              <View style={styles.mediaContainer}>
                <VideoView
                  style={styles.ballotImage}
                  player={player3}
                  contentFit="contain"
                  nativeControls={false}
                />
              </View>
              <View style={styles.contentSection}>
                <View style={styles.stepContent}>
                  <View style={styles.stepHeader}>
                    <View style={styles.numberCircle}>
                      <Text style={styles.numberText}>3</Text>
                    </View>
                    <Text style={styles.stepTitle}>Vote anonyme</Text>
                  </View>
                  <Text style={styles.stepDescription}>
                    Une fois vos données vérifiées et authentiques, l'application produit un jeton anonyme vous permettant de voter.
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Footer with Progress and Button */}
        <View style={styles.footer}>
          <View style={styles.progressContainer}>
            <Animated.View
              style={[
                styles.progressBar,
                styles.progressBarActive,
                { opacity: progressOpacity1 }
              ]}
            />
            <Animated.View
              style={[
                styles.progressBar,
                styles.progressBarActive,
                { opacity: progressOpacity2 }
              ]}
            />
            <Animated.View
              style={[
                styles.progressBar,
                styles.progressBarActive,
                { opacity: progressOpacity3 }
              ]}
            />
          </View>
          <TouchableOpacity style={styles.arrowButton} activeOpacity={0.8} onPress={handleNext}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path
                d="M5 12H19M19 12L12 5M19 12L12 19"
                stroke={Colors.white}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Spacing.modal.borderRadius,
    borderTopRightRadius: Spacing.modal.borderRadius,
  },
  handleIndicator: {
    backgroundColor: Colors.border,
    width: 40,
    height: 4,
  },
  container: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.modal.titlePadding,
    paddingHorizontal: Spacing.modal.titlePaddingHorizontal,
    width: '100%',
  },
  title: {
    flex: 1,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: Colors.primary,
    textAlign: 'center',
  },
  slidingWrapper: {
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  slidingContainer: {
    flexDirection: 'row',
  },
  stepSlide: {
    alignItems: 'center',
  },
  mediaContainer: {
    height: Spacing.modal.mediaContainerHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardVideo: {
    width: Spacing.modal.cardImageWidth,
    height: Spacing.modal.cardImageHeight,
  },
  phoneImage: {
    width: Spacing.modal.phoneImageSize,
    height: Spacing.modal.phoneImageSize,
  },
  ballotImage: {
    width: Spacing.modal.ballotImageSize,
    height: Spacing.modal.ballotImageSize,
  },
  contentSection: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingVertical: Spacing.modal.contentPadding,
    paddingHorizontal: Spacing.modal.contentPaddingHorizontal,
    gap: Spacing.modal.contentGap,
    backgroundColor: Colors.background,
    width: '100%',
    height: Spacing.modal.contentSectionHeight,
  },
  stepContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: Spacing.modal.stepTitleGap,
    width: '100%',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.modal.stepTitleGap,
    width: '100%',
  },
  numberCircle: {
    width: Spacing.modal.numberCircleSize,
    height: Spacing.modal.numberCircleSize,
    borderRadius: Spacing.modal.numberCircleSize / 2,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberText: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
  stepTitle: {
    flex: 1,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: Colors.primary,
  },
  stepDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: Colors.primary,
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.modal.footerPadding,
    paddingHorizontal: Spacing.modal.footerPaddingHorizontal,
    gap: Spacing.modal.footerGap,
    backgroundColor: Colors.background,
    width: '100%',
  },
  progressContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.modal.progressBarGap,
  },
  progressBar: {
    flex: 1,
    height: Spacing.modal.progressBarHeight,
    borderRadius: Spacing.modal.progressBarRadius,
  },
  progressBarActive: {
    backgroundColor: Colors.progressActive,
  },
  progressBarInactive: {
    backgroundColor: Colors.progressInactive,
  },
  arrowButton: {
    width: Spacing.modal.arrowButtonSize,
    height: Spacing.modal.arrowButtonSize,
    borderRadius: Spacing.modal.arrowButtonRadius,
    backgroundColor: Colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default VotingModalSimple;