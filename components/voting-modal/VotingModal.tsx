import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Text, View, TouchableOpacity, Animated, Easing } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useVideoPlayer } from 'expo-video';
import { Colors } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { modalStyles } from './styles';
import Step1 from './Step1';
import Step2 from './Step2';
import Step3 from './Step3';
import Step4 from './Step4';
import Step5 from './Step5';
import Step6 from './Step6';
import Step7 from './Step7';
import Step8 from './Step8';
import Step9Error from './Step9Error';
import Step10 from './Step10';
import Step11 from './Step11';
import Step12Success from './Step12Success';
import Step12Error from './Step12Error';

interface VotingModalProps {
  isVisible: boolean;
  onClose: () => void;
}

const VotingModal: React.FC<VotingModalProps> = ({ isVisible, onClose }) => {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<'success' | 'error' | null>(null);
  const [voteSubmissionResult, setVoteSubmissionResult] = useState<'success' | 'error' | null>(null);
  const snapPoints = useMemo(() => {
    if (currentStep === 8 && verificationResult === 'success') return [380];
    if (currentStep === 8 && verificationResult === 'error') return [490];
    if (currentStep === 9) return [440];
    if (currentStep === 10) return ['85%'];
    if (currentStep === 11 && voteSubmissionResult === 'success') return [480];
    if (currentStep === 11 && voteSubmissionResult === 'error') return [440];
    return ['85%'];
  }, [currentStep, verificationResult, voteSubmissionResult]);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(375);

  // Progress bar animations
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  // Video players for each step
  const player1 = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4846_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.audioMixingMode = 'mixWithOthers';
    player.play();
  });

  const player2 = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.audioMixingMode = 'mixWithOthers';
    player.play();
  });

  const player3 = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5078_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.audioMixingMode = 'mixWithOthers';
    player.play();
  });

  const player4 = useVideoPlayer(require('@/assets/videos/phoneOverCard.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.audioMixingMode = 'mixWithOthers';
    player.play();
  });

  const player5 = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5198_0.mp4'), player => {
    player.loop = true;
    player.muted = true;
    player.audioMixingMode = 'mixWithOthers';
    player.play();
  });

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.present();
      setCurrentStep(1);
      setVerificationResult(null);
      setVoteSubmissionResult(null);
      slideAnim.setValue(0);
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
    if (currentStep < 11) {
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

  const handleVerificationSuccess = useCallback(() => {
    setVerificationResult('success');
    setCurrentStep(8);
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleVerificationError = useCallback(() => {
    setVerificationResult('error');
    setCurrentStep(8);
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleVoteSubmissionSuccess = useCallback(() => {
    setVoteSubmissionResult('success');
    setCurrentStep(11);
    Animated.timing(slideAnim, {
      toValue: -10 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleVoteSubmissionError = useCallback(() => {
    setVoteSubmissionResult('error');
    setCurrentStep(11);
    Animated.timing(slideAnim, {
      toValue: -10 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      backdropComponent={renderBackdrop}
      backgroundStyle={modalStyles.bottomSheetBackground}
      handleIndicatorStyle={modalStyles.handleIndicator}
      onDismiss={handleDismiss}
    >
      <BottomSheetView
        style={modalStyles.container}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {/* Title Section - Hidden for Step 4, 5, and 6 */}
        {currentStep < 4 && (
          <View style={modalStyles.titleSection}>
            <Text style={modalStyles.title}>Processus de vote</Text>
          </View>
        )}

        {/* Sliding Container with All Steps */}
        <View style={modalStyles.slidingWrapper}>
          <Animated.View
            style={[
              modalStyles.slidingContainer,
              {
                transform: [{ translateX: slideAnim }],
              }
            ]}
          >
            <Step1 player={player1} containerWidth={containerWidth} />
            <Step2 player={player2} containerWidth={containerWidth} />
            <Step3 player={player3} containerWidth={containerWidth} />
            <Step4 player={player1} containerWidth={containerWidth} onStartAnalysis={handleNext} />
            <Step5 containerWidth={containerWidth} onManualFill={handleNext} />
            {/* TODO: Step 6 Analyse button should trigger NFC in future */}
            <Step6 containerWidth={containerWidth} player={player4} onAnalyze={handleNext} />
            <Step7 containerWidth={containerWidth} player={player5} isActive={currentStep === 7} onSuccess={handleVerificationSuccess} onError={handleVerificationError} />
            {/* Step 8 position - shows either success or error based on verification result */}
            {verificationResult === 'success' ? (
              <Step8 containerWidth={containerWidth} onVote={handleNext} />
            ) : verificationResult === 'error' ? (
              <Step9Error containerWidth={containerWidth} onGoHome={onClose} />
            ) : (
              <View style={{ width: containerWidth }} />
            )}
            {/* Step 9 - Vote confirmation */}
            <Step10 containerWidth={containerWidth} player={player3} onCancel={onClose} onConfirm={handleNext} />
            {/* Step 10 - Vote submission loading */}
            <Step11 containerWidth={containerWidth} isActive={currentStep === 10} onSuccess={handleVoteSubmissionSuccess} onError={handleVoteSubmissionError} />
            {/* Step 11 position - shows either success or error based on vote submission result */}
            {voteSubmissionResult === 'success' ? (
              <Step12Success containerWidth={containerWidth} onViewResults={onClose} />
            ) : voteSubmissionResult === 'error' ? (
              <Step12Error containerWidth={containerWidth} onGoHome={onClose} />
            ) : (
              <View style={{ width: containerWidth }} />
            )}
          </Animated.View>
        </View>

        {/* Footer with Progress and Button - Hidden for Step 4, 5, and 6 */}
        {currentStep < 4 && (
          <View style={modalStyles.footer}>
            <View style={modalStyles.progressContainer}>
              <Animated.View
                style={[
                  modalStyles.progressBar,
                  modalStyles.progressBarActive,
                  { opacity: progressOpacity1 }
                ]}
              />
              <Animated.View
                style={[
                  modalStyles.progressBar,
                  modalStyles.progressBarActive,
                  { opacity: progressOpacity2 }
                ]}
              />
              <Animated.View
                style={[
                  modalStyles.progressBar,
                  modalStyles.progressBarActive,
                  { opacity: progressOpacity3 }
                ]}
              />
            </View>
            <TouchableOpacity style={modalStyles.arrowButton} activeOpacity={0.8} onPress={handleNext}>
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
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default VotingModal;