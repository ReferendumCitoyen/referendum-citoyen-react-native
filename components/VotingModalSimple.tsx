import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { Text, StyleSheet, View, TouchableOpacity } from 'react-native';
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

  const player = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4846_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [isVisible]);

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
      <BottomSheetView style={styles.container}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Processus de vote</Text>
        </View>

        {/* Card Video */}
        <VideoView
          style={styles.cardVideo}
          player={player}
          contentFit="cover"
          nativeControls={false}
        />

        {/* Content Section */}
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

        {/* Footer with Progress and Button */}
        <View style={styles.footer}>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, styles.progressBarActive]} />
            <View style={[styles.progressBar, styles.progressBarInactive]} />
            <View style={[styles.progressBar, styles.progressBarInactive]} />
          </View>
          <TouchableOpacity style={styles.arrowButton} activeOpacity={0.8}>
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
    alignSelf: 'stretch',
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
  cardVideo: {
    width: Spacing.modal.cardImageWidth,
    height: Spacing.modal.cardImageHeight,
  },
  contentSection: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingVertical: Spacing.modal.contentPadding,
    paddingHorizontal: Spacing.modal.contentPaddingHorizontal,
    gap: Spacing.modal.contentGap,
    backgroundColor: Colors.background,
    alignSelf: 'stretch',
  },
  stepContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: Spacing.modal.stepTitleGap,
    alignSelf: 'stretch',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.modal.stepTitleGap,
    alignSelf: 'stretch',
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
    alignSelf: 'stretch',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.modal.footerPadding,
    paddingHorizontal: Spacing.modal.footerPaddingHorizontal,
    gap: Spacing.modal.footerGap,
    backgroundColor: Colors.background,
    alignSelf: 'stretch',
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