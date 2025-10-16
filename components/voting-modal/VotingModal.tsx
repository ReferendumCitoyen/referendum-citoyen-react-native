import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Text, View, TouchableOpacity, Animated, Easing } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Colors } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { modalStyles } from './styles';
import { useModalVideoPlayers } from '@/hooks/useModalVideoPlayers';
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
  const [stepHeights, setStepHeights] = useState<Record<string, number>>({});
  const snapPoints = useMemo(() => {
    // Generate unique key for current step configuration
    let stepKey = `step${currentStep}`;
    if (currentStep === 8) stepKey += `_${verificationResult}`;
    if (currentStep === 11) stepKey += `_${voteSubmissionResult || 'loading'}`;

    // Check if we have a measured height for this step
    const measuredHeight = stepHeights[stepKey];

    // For steps 1-3, always use percentage to keep them tall
    if (currentStep <= 3) {
      console.log(`[BottomSheet] Step: ${currentStep}, Using fixed percentage: 85%`);
      return ['85%'];
    }

    // For Step 8 success, use fixed percentage
    if (currentStep === 8 && verificationResult === 'success') {
      console.log(`[BottomSheet] Step: ${currentStep}, Using fixed percentage: 45%`);
      return ['45%'];
    }

    // For Step 9 (vote confirmation - "voter oui"), use fixed percentage
    if (currentStep === 9) {
      console.log(`[BottomSheet] Step: ${currentStep}, Using fixed percentage: 50%`);
      return ['50%'];
    }

    if (measuredHeight) {
      console.log(`[BottomSheet] Step: ${currentStep}, Key: ${stepKey}, Measured Height: ${measuredHeight}px`);
      return [measuredHeight];
    }

    // Fallback to percentage heights while measurements are being taken
    let height;
    if (currentStep <= 3) height = ['85%'];
    else if (currentStep === 4) height = ['60%'];
    else if (currentStep === 5) height = ['65%'];
    else if (currentStep === 6) height = ['55%'];
    else if (currentStep === 7) height = ['58%'];
    else if (currentStep === 8 && verificationResult === 'success') height = ['35%'];
    else if (currentStep === 8 && verificationResult === 'error') height = ['55%'];
    else if (currentStep === 9) height = ['50%'];
    else if (currentStep === 10) height = ['45%'];
    else if (currentStep === 11 && !voteSubmissionResult) height = ['26%'];
    else if (currentStep === 11 && voteSubmissionResult === 'success') height = ['48%'];
    else if (currentStep === 11 && voteSubmissionResult === 'error') height = ['45%'];
    else height = ['85%'];

    console.log(`[BottomSheet] Step: ${currentStep}, Key: ${stepKey}, Fallback Height: ${height[0]}`);
    return height;
  }, [currentStep, verificationResult, voteSubmissionResult, stepHeights]);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(375);

  // Callback for steps to report their heights
  const handleStepLayout = useCallback((stepKey: string, height: number) => {
    setStepHeights(prev => {
      if (prev[stepKey] !== height) {
        return { ...prev, [stepKey]: height };
      }
      return prev;
    });
  }, []);

  // Progress bar animations
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  // Video players hook
  const { players, handleStepChange, pauseAll, pauseVerificationVideo } = useModalVideoPlayers();
  const { player1, player2, player3, player4, player5 } = players;

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
      // Start playing the first video when modal opens
      handleStepChange(1);
    } else {
      bottomSheetRef.current?.dismiss();
      // Pause all videos when closing
      pauseAll();
    }
  }, [isVisible, slideAnim, progressOpacity1, progressOpacity2, progressOpacity3, handleStepChange, pauseAll]);

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

      // Handle video playback
      handleStepChange(nextStep);

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

      // Force snap for step 9 (voter oui screen)
      if (nextStep === 9) {
        setTimeout(() => {
          bottomSheetRef.current?.snapToIndex(0);
        }, 100);
      }
    }
  }, [currentStep, slideAnim, containerWidth, progressOpacity2, progressOpacity3, handleStepChange]);

  const handleVerificationSuccess = useCallback(() => {
    setVerificationResult('success');
    setCurrentStep(8);
    pauseVerificationVideo();
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // Force snap to new height
    setTimeout(() => {
      bottomSheetRef.current?.snapToIndex(0);
    }, 100);
  }, [slideAnim, containerWidth, pauseVerificationVideo]);

  const handleVerificationError = useCallback(() => {
    setVerificationResult('error');
    setCurrentStep(8);
    pauseVerificationVideo();
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth, pauseVerificationVideo]);

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
      enableContentPanningGesture={currentStep < 4}
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
            <Step1 player={player1} containerWidth={containerWidth} onLayout={(e) => handleStepLayout('step1', e.nativeEvent.layout.height)} />
            <Step2 player={player2} containerWidth={containerWidth} onLayout={(e) => handleStepLayout('step2', e.nativeEvent.layout.height)} />
            <Step3 player={player3} containerWidth={containerWidth} onLayout={(e) => handleStepLayout('step3', e.nativeEvent.layout.height)} />
            <Step4 player={player1} containerWidth={containerWidth} onStartAnalysis={handleNext} onLayout={(e) => handleStepLayout('step4', e.nativeEvent.layout.height)} />
            <Step5 containerWidth={containerWidth} onManualFill={handleNext} onLayout={(e) => handleStepLayout('step5', e.nativeEvent.layout.height)} />
            {/* TODO: Step 6 Analyse button should trigger NFC in future */}
            <Step6 containerWidth={containerWidth} player={player4} onAnalyze={handleNext} onLayout={(e) => handleStepLayout('step6', e.nativeEvent.layout.height)} />
            <Step7 containerWidth={containerWidth} player={player5} isActive={currentStep === 7} onSuccess={handleVerificationSuccess} onError={handleVerificationError} onLayout={(e) => handleStepLayout('step7', e.nativeEvent.layout.height)} />
            {/* Step 8 position - shows either success or error based on verification result */}
            {verificationResult === 'success' ? (
              <Step8 containerWidth={containerWidth} onVote={handleNext} onLayout={(e) => handleStepLayout('step8_success', e.nativeEvent.layout.height)} />
            ) : verificationResult === 'error' ? (
              <Step9Error containerWidth={containerWidth} onGoHome={onClose} onLayout={(e) => handleStepLayout('step8_error', e.nativeEvent.layout.height)} />
            ) : (
              <View style={{ width: containerWidth }} />
            )}
            {/* Step 9 - Vote confirmation */}
            <Step10 containerWidth={containerWidth} player={player3} onCancel={onClose} onConfirm={handleNext} onLayout={(e) => handleStepLayout('step10', e.nativeEvent.layout.height)} />
            {/* Step 10 - Vote submission loading */}
            <Step11 containerWidth={containerWidth} isActive={currentStep === 10} onSuccess={handleVoteSubmissionSuccess} onError={handleVoteSubmissionError} onLayout={(e) => handleStepLayout('step11_loading', e.nativeEvent.layout.height)} />
            {/* Step 11 position - shows either success or error based on vote submission result */}
            {voteSubmissionResult === 'success' ? (
              <Step12Success containerWidth={containerWidth} onViewResults={onClose} onLayout={(e) => handleStepLayout('step11_success', e.nativeEvent.layout.height)} />
            ) : voteSubmissionResult === 'error' ? (
              <Step12Error containerWidth={containerWidth} onGoHome={onClose} onLayout={(e) => handleStepLayout('step11_error', e.nativeEvent.layout.height)} />
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