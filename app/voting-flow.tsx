import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions, TouchableOpacity, ScrollView, StatusBar, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import type { Rarime, RarimePassport, FreedomTool, ProposalInfo } from '@rarimo/rarime-rn-sdk';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import {
  RARIME_TESTNET_CONFIG,
  FREEDOM_TOOL_CONFIG,
  PRIVATE_KEY_STORAGE_KEY,
  DEFAULT_PROPOSAL_ID,
  withRetry,
  formatRpcError,
} from '@/constants/rarime-config';

// Import all steps
import Step1 from '@/components/voting-modal/Step1';
import Step2 from '@/components/voting-modal/Step2';
import Step3 from '@/components/voting-modal/Step3';
import Step4 from '@/components/voting-modal/Step4';
import Step5 from '@/components/voting-modal/Step5';
import Step6 from '@/components/voting-modal/Step6';
import Step7 from '@/components/voting-modal/Step7';
import Step8 from '@/components/voting-modal/Step8';
import Step9Error from '@/components/voting-modal/Step9Error';
import Step9Vote from '@/components/voting-modal/Step9Vote';
import Step10 from '@/components/voting-modal/Step10';
import Step11 from '@/components/voting-modal/Step11';
import Step12Success from '@/components/voting-modal/Step12Success';
import Step12Error from '@/components/voting-modal/Step12Error';
import ManualMRZInput from '@/components/voting-modal/ManualMRZInput';
import { createModalStyles } from '@/components/voting-modal/styles';
import { useModalVideoPlayers } from '@/hooks/useModalVideoPlayers';

interface NFCScanResult {
  personDetails?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    nationality?: string;
    documentNumber?: string;
    dateOfExpiry?: string;
  };
  dg1Bytes?: string;
  sodBytes?: string;
  dg15Bytes?: string;
  aaSignature?: string;
}

export default function VotingFlowScreen() {
  const router = useRouter();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<'success' | 'error' | null>(null);
  const [voteSubmissionResult, setVoteSubmissionResult] = useState<'success' | 'error' | null>(null);
  const [mrzData, setMRZData] = useState<{ documentNumber: string; birthDate: string; expiryDate: string } | null>(null);
  const [nfcData, setNFCData] = useState<NFCScanResult | null>(null);
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);
  const [selectedVote, setSelectedVote] = useState<number>(0);

  // Rarime / FreedomTool state
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [proposalInfo, setProposalInfo] = useState<ProposalInfo | null>(null);
  const rarimeRef = useRef<Rarime | null>(null);
  const freedomToolRef = useRef<FreedomTool | null>(null);
  const passportRef = useRef<RarimePassport | null>(null);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  const { players, handleStepChange, pauseAll } = useModalVideoPlayers();
  const { player1, player2, player3, player4, player5 } = players;

  // Init Rarime + FreedomTool + load proposal (lazy import to avoid crypto polyfill issues)
  useEffect(() => {
    (async () => {
      try {
        const { Rarime: RarimeClass, RarimeUtils: Utils, FreedomTool: FT } =
          await import('@rarimo/rarime-rn-sdk');

        let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
        if (!storedKey) {
          storedKey = Utils.generateBJJPrivateKey();
          await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
        }
        setPrivateKey(storedKey);

        const rarime = new RarimeClass({
          ...RARIME_TESTNET_CONFIG,
          userConfiguration: { userPrivateKey: storedKey },
        });
        rarimeRef.current = rarime;

        const ft = new FT(FREEDOM_TOOL_CONFIG);
        freedomToolRef.current = ft;

        console.log('[FreedomTool] Loading proposal', DEFAULT_PROPOSAL_ID);
        const info = await withRetry(
          () => ft.getProposalInfo(DEFAULT_PROPOSAL_ID),
          { label: 'getProposalInfo' }
        );
        console.log('[FreedomTool] Proposal loaded:', info.title);
        setProposalInfo(info);
      } catch (err) {
        console.error('[FreedomTool] Init error:', err);
      }
    })();
  }, []);

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
    setMRZData(data);
    handleNext();
  }, [handleNext]);

  const handleNFCSuccess = useCallback((data: NFCScanResult) => {
    setNFCData(data);

    // Create RarimePassport from NFC data
    if (data.dg1Bytes && data.sodBytes) {
      (async () => {
        try {
          const { RarimePassport: RP } = await import('@rarimo/rarime-rn-sdk');
          const dg1 = new Uint8Array(Buffer.from(data.dg1Bytes, 'base64'));
          const sod = new Uint8Array(Buffer.from(data.sodBytes, 'base64'));
          passportRef.current = new RP({ dataGroup1: dg1, sod });
          console.log('[FreedomTool] RarimePassport created from NFC data');
        } catch (err) {
          console.error('[FreedomTool] Failed to create RarimePassport:', err);
        }
      })();
    }

    handleNext();
  }, [handleNext]);

  const handleGoBackToMRZScan = useCallback(() => {
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
    setIsManualInputVisible(true);
  }, []);

  const handleManualInputClose = useCallback(() => {
    setIsManualInputVisible(false);
  }, []);

  const handleManualInputSubmit = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    setIsManualInputVisible(false);
    handleMRZScanned(data);
  }, [handleMRZScanned]);

  const handleVerificationSuccess = useCallback(() => {
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
    setCurrentStep(9);
    Animated.timing(slideAnim, {
      toValue: -8 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(9);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVoteSelect = useCallback((answerIndex: number) => {
    setSelectedVote(answerIndex);
    setCurrentStep(10);
    Animated.timing(slideAnim, {
      toValue: -9 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(10);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleStep9Confirm = useCallback(() => {
    setCurrentStep(11);
    Animated.timing(slideAnim, {
      toValue: -10 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(11);
  }, [selectedVote, slideAnim, containerWidth, handleStepChange]);

  const handleClose = useCallback(() => {
    pauseAll();
    router.back();
  }, [router, pauseAll]);

  const handleStep9Cancel = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const handleStep11Success = useCallback(() => {
    setVoteSubmissionResult('success');
    setCurrentStep(12);
    Animated.timing(slideAnim, {
      toValue: -11 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(12);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleStep11Error = useCallback(() => {
    setVoteSubmissionResult('error');
    setCurrentStep(13);
    Animated.timing(slideAnim, {
      toValue: -12 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(13);
  }, [slideAnim, containerWidth, handleStepChange]);

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
              rarime={rarimeRef.current ?? undefined}
              passport={passportRef.current ?? undefined}
              freedomTool={freedomToolRef.current ?? undefined}
            />
            <Step8
              containerWidth={containerWidth}
              verificationResult={verificationResult}
              voteSubmissionResult={voteSubmissionResult}
              onVoteSuccess={handleVoteSuccess}
              onClose={handleClose}
            />
            <Step9Vote
              containerWidth={containerWidth}
              onVoteSelect={handleVoteSelect}
              onCancel={handleStep9Cancel}
              proposalInfo={proposalInfo ?? undefined}
            />
            <Step10
              containerWidth={containerWidth}
              player={player3}
              selectedVote={selectedVote}
              proposalInfo={proposalInfo ?? undefined}
              onCancel={handleStep9Cancel}
              onConfirm={handleStep9Confirm}
            />
            <Step11
              containerWidth={containerWidth}
              isActive={currentStep === 11}
              onSuccess={handleStep11Success}
              onError={handleStep11Error}
              freedomTool={freedomToolRef.current ?? undefined}
              rarime={rarimeRef.current ?? undefined}
              passport={passportRef.current ?? undefined}
              proposalInfo={proposalInfo ?? undefined}
              answerIndex={selectedVote}
            />
            <Step12Success
              containerWidth={containerWidth}
              onViewResults={handleClose}
            />
            <Step12Error
              containerWidth={containerWidth}
              onGoHome={handleClose}
            />
            {verificationResult === 'error' && (
              <Step9Error
                containerWidth={containerWidth}
                onGoHome={handleClose}
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
