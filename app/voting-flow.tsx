import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';

// Import all steps
import Step1 from '@/components/voting-modal/Step1';
import Step2 from '@/components/voting-modal/Step2';
import Step3 from '@/components/voting-modal/Step3';
import Step4 from '@/components/voting-modal/Step4';
import Step5 from '@/components/voting-modal/Step5';
import Step6 from '@/components/voting-modal/Step6';
import Step7 from '@/components/voting-modal/Step7';
import Step8 from '@/components/voting-modal/Step8';
import Step9Vote from '@/components/voting-modal/Step9Vote';
import Step9Error from '@/components/voting-modal/Step9Error';
import ManualMRZInput from '@/components/voting-modal/ManualMRZInput';
import { createModalStyles } from '@/components/voting-modal/styles';
import { useModalVideoPlayers } from '@/hooks/useModalVideoPlayers';

export default function VotingFlowScreen() {
  const router = useRouter();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<'success' | 'error' | null>(null);
  const [voteSubmissionResult, setVoteSubmissionResult] = useState<'success' | 'error' | null>(null);
  const [mrzData, setMRZData] = useState<{ documentNumber: string; birthDate: string; expiryDate: string } | null>(null);
  const [nfcData, setNFCData] = useState<any>(null);
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  const { players, handleStepChange, pauseAll } = useModalVideoPlayers();
  const { player1, player2, player3, player4, player5 } = players;

  // Reset state when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Reset to step 1 when screen is focused
      setCurrentStep(1);
      setVerificationResult(null);
      setVoteSubmissionResult(null);
      setMRZData(null);
      setNFCData(null);

      // Reset animations
      slideAnim.setValue(0);
      progressOpacity1.setValue(1);
      progressOpacity2.setValue(0.25);
      progressOpacity3.setValue(0.25);

      return () => {
        // Cleanup when screen loses focus
        pauseAll();
      };
    }, [pauseAll, slideAnim, progressOpacity1, progressOpacity2, progressOpacity3])
  );

  const handleNext = useCallback(() => {
    const newStep = currentStep + 1;
    console.log(`🔄 Moving from step ${currentStep} to step ${newStep}`);
    setCurrentStep(newStep);

    Animated.timing(slideAnim, {
      toValue: -(newStep - 1) * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    handleStepChange(newStep);

    if (newStep === 2) {
      Animated.timing(progressOpacity1, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (newStep === 3) {
      Animated.timing(progressOpacity2, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (newStep === 4) {
      Animated.timing(progressOpacity3, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [currentStep, slideAnim, containerWidth, handleStepChange, progressOpacity1, progressOpacity2, progressOpacity3]);

  const handleMRZScanned = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    console.log("✅ MRZ Detected in voting flow:", data);
    setMRZData(data);
    handleNext();
  }, [handleNext]);

  const handleNFCSuccess = useCallback((data: any) => {
    console.log("✅ NFC Scan successful in voting flow");
    setNFCData(data);
    handleNext();
  }, [handleNext]);

  const handleGoBackToMRZScan = useCallback(() => {
    console.log("🔙 Going back to MRZ scan");
    setCurrentStep(5);
    setMRZData(null);
    Animated.timing(slideAnim, {
      toValue: -4 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(5);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleManualFill = useCallback(() => {
    console.log("📝 Opening manual MRZ input");
    setIsManualInputVisible(true);
  }, []);

  const handleManualInputClose = useCallback(() => {
    setIsManualInputVisible(false);
  }, []);

  const handleManualInputSubmit = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    console.log("📝 Manual MRZ data submitted:", data);
    setIsManualInputVisible(false);
    handleMRZScanned(data);
  }, [handleMRZScanned]);

  const handleVerificationSuccess = useCallback(() => {
    console.log('✅ Verification success - moving to voting screen');
    setVerificationResult('success');
    // Move to step 8 (voting screen) after a brief delay
    setTimeout(() => {
      setCurrentStep(8);
      Animated.timing(slideAnim, {
        toValue: -7 * containerWidth,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      handleStepChange(8);
    }, 1500);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVerificationError = useCallback(() => {
    setVerificationResult('error');
    setTimeout(() => handleNext(), 1500);
  }, [handleNext]);

  const handleVoteSuccess = useCallback(() => {
    console.log('📝 Moving to vote selection screen (step 9)');
    setCurrentStep(9);
    Animated.timing(slideAnim, {
      toValue: -8 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(9);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVoteSubmit = useCallback((vote: 'oui' | 'blanc' | 'non') => {
    console.log('✅ Vote submitted:', vote);
    setVoteSubmissionResult('success');
    // Close after showing success
    setTimeout(() => {
      handleClose();
    }, 2000);
  }, []);

  const handleVoteError = useCallback(() => {
    setVoteSubmissionResult('error');
  }, []);

  const handleClose = useCallback(() => {
    pauseAll();
    router.back();
  }, [router, pauseAll]);

  console.log('VotingFlow rendering - currentStep:', currentStep);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.topSection}>
        {/* Safe area spacer */}
        <View style={{ height: insets.top, backgroundColor: 'white' }} />

        {/* Title Section - Hidden for Step 4, 5, and 6 */}
        {currentStep < 4 && (
          <View style={modalStyles.titleSection}>
            <Text style={modalStyles.title}>Processus de vote</Text>
          </View>
        )}

        {/* Sliding Container */}
        <View
          style={[
            modalStyles.slidingWrapper,
            currentStep < 4 && { backgroundColor: '#EDEFF9' }
          ]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <Animated.View
            style={[
              modalStyles.slidingContainer,
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            <Step1 player={player1} containerWidth={containerWidth} />
            <Step2 player={player2} containerWidth={containerWidth} />
            <Step3 player={player3} containerWidth={containerWidth} />
            <Step4 player={player1} containerWidth={containerWidth} onStartAnalysis={handleNext} />
            <Step5
              containerWidth={containerWidth}
              isActive={currentStep === 5}
              onMRZScanned={handleMRZScanned}
              onManualFill={handleManualFill}
            />
            <Step6
              containerWidth={containerWidth}
              player={player4}
              mrzData={mrzData}
              onNFCSuccess={handleNFCSuccess}
              onGoBack={handleGoBackToMRZScan}
            />
            <Step7
              containerWidth={containerWidth}
              player={player5}
              isActive={currentStep === 7}
              nfcData={nfcData}
              onSuccess={handleVerificationSuccess}
              onError={handleVerificationError}
            />
            <Step8
              containerWidth={containerWidth}
              verificationResult={verificationResult}
              voteSubmissionResult={voteSubmissionResult}
              onVoteSuccess={handleVoteSuccess}
              onVoteError={handleVoteError}
              onClose={handleClose}
            />
            <Step9Vote
              containerWidth={containerWidth}
              onVoteSubmit={handleVoteSubmit}
              onCancel={handleClose}
            />
            {verificationResult === 'error' && (
              <Step9Error
                containerWidth={containerWidth}
                onRetry={() => {
                  setCurrentStep(5);
                  setVerificationResult(null);
                  setMRZData(null);
                  setNFCData(null);
                }}
                onClose={handleClose}
              />
            )}
          </Animated.View>
        </View>
      </View>

      <View style={[styles.bottomSection, currentStep < 4 && { backgroundColor: '#EDEFF9' }]}>
        {/* Progress and Navigation */}
        {currentStep < 4 && (
          <View style={styles.navigationSection}>
            <View style={styles.progressSection}>
              <Animated.View style={[styles.progressBar, { opacity: progressOpacity1, backgroundColor: '#3044DD' }]} />
              <Animated.View style={[styles.progressBar, { opacity: progressOpacity2, backgroundColor: '#3044DD' }]} />
              <Animated.View style={[styles.progressBar, { opacity: progressOpacity3, backgroundColor: '#3044DD' }]} />
            </View>
            <TouchableOpacity
              style={styles.arrowButton}
              onPress={handleNext}
              activeOpacity={0.7}
            >
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M9 18l6-6-6-6"
                  stroke="white"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ManualMRZInput
        isVisible={isManualInputVisible}
        onClose={handleManualInputClose}
        onSubmit={handleManualInputSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  topSection: {
    backgroundColor: 'white',
  },
  bottomSection: {
    flex: 1,
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  navigationSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 39,
  },
  arrowButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3044DD',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
