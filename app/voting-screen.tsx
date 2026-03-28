import { useColors } from "@/constants/theme";
import { useModalVideoPlayers } from "@/hooks/useModalVideoPlayers";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Path, Svg } from "react-native-svg";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { Rarime, RarimePassport, FreedomTool, ProposalInfo } from "@rarimo/rarime-rn-sdk";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import {
  RARIME_TESTNET_CONFIG,
  FREEDOM_TOOL_CONFIG,
  PRIVATE_KEY_STORAGE_KEY,
  DEFAULT_PROPOSAL_ID,
  withRetry,
} from "@/constants/rarime-config";
import Step1 from "@/components/voting-modal/Step1";
import Step10 from "@/components/voting-modal/Step10";
import Step11 from "@/components/voting-modal/Step11";
import Step12Error from "@/components/voting-modal/Step12Error";
import Step12Success from "@/components/voting-modal/Step12Success";
import Step2 from "@/components/voting-modal/Step2";
import Step3 from "@/components/voting-modal/Step3";
import Step4 from "@/components/voting-modal/Step4";
import Step5 from "@/components/voting-modal/Step5";
import Step6 from "@/components/voting-modal/Step6";
import Step7 from "@/components/voting-modal/Step7";
import Step8 from "@/components/voting-modal/Step8";
import Step9Vote from "@/components/voting-modal/Step9Vote";
import Step9Error from "@/components/voting-modal/Step9Error";
import ManualMRZInput from "@/components/voting-modal/ManualMRZInput";
import { createModalStyles } from "@/components/voting-modal/styles";

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

export default function VotingScreen() {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { proposalId: proposalIdParam } = useLocalSearchParams<{ proposalId: string }>();

  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<
    "success" | "error" | null
  >(null);
  const [voteSubmissionResult, setVoteSubmissionResult] = useState<
    "success" | "error" | null
  >(null);
  const [mrzData, setMRZData] = useState<{
    documentNumber: string;
    birthDate: string;
    expiryDate: string;
  } | null>(null);
  const [nfcData, setNFCData] = useState<NFCScanResult | null>(null);
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);
  const [selectedVote, setSelectedVote] = useState<number>(0);

  // Rarime / FreedomTool state
  const [proposalInfo, setProposalInfo] = useState<ProposalInfo | null>(null);
  const rarimeRef = useRef<Rarime | null>(null);
  const freedomToolRef = useRef<FreedomTool | null>(null);
  const passportRef = useRef<RarimePassport | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(375);

  // Progress bar animations
  const progressOpacity1 = useRef(new Animated.Value(1)).current;
  const progressOpacity2 = useRef(new Animated.Value(0.25)).current;
  const progressOpacity3 = useRef(new Animated.Value(0.25)).current;

  // Video players hook
  const { players, handleStepChange, pauseAll, pauseVerificationVideo } =
    useModalVideoPlayers();
  const { player1, player2, player3, player4, player5 } = players;

  const onClose = useCallback(() => router.back(), [router]);

  // Init step 1 on mount, pause videos on unmount
  const pauseAllRef = useRef(pauseAll);
  pauseAllRef.current = pauseAll;
  const handleStepChangeRef = useRef(handleStepChange);
  handleStepChangeRef.current = handleStepChange;

  useEffect(() => {
    handleStepChangeRef.current(1);
    return () => { pauseAllRef.current(); };
  }, []);

  // Init Rarime + FreedomTool + load proposal
  useEffect(() => {
    (async () => {
      try {
        const { Rarime: RarimeClass, RarimeUtils: Utils, FreedomTool: FT } =
          await import("@rarimo/rarime-rn-sdk");
        let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
        if (!storedKey) {
          storedKey = Utils.generateBJJPrivateKey();
          await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
        }
        rarimeRef.current = new RarimeClass({
          ...RARIME_TESTNET_CONFIG,
          userConfiguration: { userPrivateKey: storedKey },
        });
        const ft = new FT(FREEDOM_TOOL_CONFIG);
        freedomToolRef.current = ft;
        const pid = proposalIdParam || DEFAULT_PROPOSAL_ID;
        console.log("[FreedomTool] Loading proposal", pid);
        const info = await withRetry(
          () => ft.getProposalInfo(pid),
          { label: "getProposalInfo" }
        );
        console.log("[FreedomTool] Proposal loaded:", info.title);
        setProposalInfo(info);
      } catch (err) {
        console.error("[FreedomTool] Init error:", err);
      }
    })();
  }, [proposalIdParam]);

  const handleNext = useCallback(() => {
    if (currentStep < 12) {
      const nextStep = currentStep + 1;
      console.log(`[VotingScreen] Step ${currentStep} → Step ${nextStep}`);
      setCurrentStep(nextStep);

      Animated.timing(slideAnim, {
        toValue: -(nextStep - 1) * containerWidth,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      handleStepChange(nextStep);

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
  }, [
    currentStep,
    slideAnim,
    containerWidth,
    progressOpacity2,
    progressOpacity3,
    handleStepChange,
  ]);

  const handleGoBackToMRZScan = useCallback(() => {
    console.log("[VotingScreen] Going back to MRZ scan");
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

  const handleVerificationSuccess = useCallback(() => {
    console.log("[VotingScreen] Verification SUCCESS → Step 8 (ready to vote)");
    setVerificationResult("success");
    setCurrentStep(8);
    pauseVerificationVideo();
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth, pauseVerificationVideo]);

  const handleVerificationError = useCallback(() => {
    console.log("[VotingScreen] Verification ERROR → Step 8");
    setVerificationResult("error");
    setCurrentStep(8);
    pauseVerificationVideo();
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth, pauseVerificationVideo]);

  const handleVoteCancelToStep8 = useCallback(() => {
    setCurrentStep(8);
    Animated.timing(slideAnim, {
      toValue: -7 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleVoteCancelToStep9 = useCallback(() => {
    setCurrentStep(9);
    setSelectedVote(0);
    Animated.timing(slideAnim, {
      toValue: -8 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleVoteSelect = useCallback((answerIndex: number) => {
    const variantName = proposalInfo?.questions[0]?.variants?.[answerIndex] ?? `index=${answerIndex}`;
    console.log(`[VotingScreen] Vote selected: "${variantName}" (index ${answerIndex}) for proposal #${proposalInfo?.id}`);
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

  const handleVoteSubmissionSuccess = useCallback(() => {
    console.log("[VotingScreen] Vote submission SUCCESS → Step 12");
    setVoteSubmissionResult("success");
    setCurrentStep(12);
    Animated.timing(slideAnim, {
      toValue: -11 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleVoteSubmissionError = useCallback(() => {
    console.log("[VotingScreen] Vote submission ERROR → Step 12");
    setVoteSubmissionResult("error");
    setCurrentStep(12);
    Animated.timing(slideAnim, {
      toValue: -11 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideAnim, containerWidth]);

  const handleMRZScanned = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    console.log("[VotingScreen] MRZ data scanned:", data);
    setMRZData(data);
    handleNext();
  }, [handleNext]);

  const handleNFCSuccess = useCallback((data: NFCScanResult) => {
    console.log("[VotingScreen] NFC scan successful");
    setNFCData(data);

    if (data.dg1Bytes && data.sodBytes) {
      (async () => {
        try {
          const { RarimePassport: RP } = await import("@rarimo/rarime-rn-sdk");
          const dg1 = new Uint8Array(Buffer.from(data.dg1Bytes!, "base64"));
          const sod = new Uint8Array(Buffer.from(data.sodBytes!, "base64"));
          passportRef.current = new RP({ dataGroup1: dg1, sod });
          const mrzData = passportRef.current.getMRZData();
          console.log(`[FreedomTool] RarimePassport created — nationality: ${mrzData.issuingCountry}, docNo: ${mrzData.documentNumber}`);
        } catch (err) {
          console.error("[FreedomTool] Failed to create RarimePassport:", err);
        }
      })();
    }

    handleNext();
  }, [handleNext]);

  const handleNFCError = useCallback(() => {
    console.log("[VotingScreen] NFC scan failed");
    handleNext();
  }, [handleNext]);

  const handleManualInputOpen = useCallback(() => {
    setIsManualInputVisible(true);
  }, []);

  const handleManualInputClose = useCallback(() => {
    setIsManualInputVisible(false);
  }, []);

  const handleManualInputSubmit = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    console.log("[VotingScreen] Manual MRZ data submitted:", data);
    setIsManualInputVisible(false);
    handleMRZScanned(data);
  }, [handleMRZScanned]);

  return (
    <>
      <Stack.Screen
        options={{
          title: currentStep < 4 ? 'Processus de vote' : '',
          gestureEnabled: false,
          headerRight: () => (
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ fontSize: 17, color: colors.secondary }}>Fermer</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View
        style={[modalStyles.container, { paddingBottom: insets.bottom }]}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {/* Sliding Container with All Steps */}
        <View style={[modalStyles.slidingWrapper, { flex: 1 }]}>
          <Animated.View
            style={[
              modalStyles.slidingContainer,
              {
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            <Step1
              player={player1}
              containerWidth={containerWidth}
            />
            <Step2
              player={player2}
              containerWidth={containerWidth}
            />
            <Step3
              player={player3}
              containerWidth={containerWidth}
            />
            <Step4
              player={player1}
              containerWidth={containerWidth}
              onStartAnalysis={handleNext}
            />
            <Step5
              containerWidth={containerWidth}
              isActive={currentStep === 5}
              onMRZScanned={handleMRZScanned}
              onManualFill={handleManualInputOpen}
            />
            <Step6
              containerWidth={containerWidth}
              player={player4}
              mrzData={mrzData}
              onNFCSuccess={handleNFCSuccess}
              onNFCError={handleNFCError}
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
            {/* Step 8 - success or error */}
            <View style={{ width: containerWidth }}>
              {verificationResult === "success" ? (
                <Step8
                  containerWidth={containerWidth}
                  onVoteSuccess={handleNext}
                />
              ) : verificationResult === "error" ? (
                <Step9Error
                  containerWidth={containerWidth}
                  onGoHome={onClose}
                />
              ) : null}
            </View>
            {/* Step 9 - Vote selection */}
            <Step9Vote
              containerWidth={containerWidth}
              onVoteSelect={handleVoteSelect}
              onCancel={handleVoteCancelToStep8}
              proposalInfo={proposalInfo ?? undefined}
            />
            {/* Step 10 - Vote confirmation */}
            <Step10
              containerWidth={containerWidth}
              player={player3}
              selectedVote={selectedVote}
              proposalInfo={proposalInfo ?? undefined}
              onCancel={handleVoteCancelToStep9}
              onConfirm={handleNext}
            />
            {/* Step 11 - Vote submission loading */}
            <Step11
              containerWidth={containerWidth}
              isActive={currentStep === 11}
              onSuccess={handleVoteSubmissionSuccess}
              onError={handleVoteSubmissionError}
              freedomTool={freedomToolRef.current ?? undefined}
              rarime={rarimeRef.current ?? undefined}
              passport={passportRef.current ?? undefined}
              proposalInfo={proposalInfo ?? undefined}
              answerIndex={selectedVote}
            />
            {/* Step 12 - success or error */}
            {voteSubmissionResult === "success" ? (
              <Step12Success
                containerWidth={containerWidth}
                onViewResults={onClose}
              />
            ) : voteSubmissionResult === "error" ? (
              <Step12Error
                containerWidth={containerWidth}
                onGoHome={onClose}
              />
            ) : (
              <View style={{ width: containerWidth }} />
            )}
          </Animated.View>
        </View>

        {/* Footer with Progress and Button - Steps 1-3 only */}
        {currentStep < 4 && (
          <View style={modalStyles.footer}>
            <View style={modalStyles.progressContainer}>
              <Animated.View
                style={[
                  modalStyles.progressBar,
                  modalStyles.progressBarActive,
                  { opacity: progressOpacity1 },
                ]}
              />
              <Animated.View
                style={[
                  modalStyles.progressBar,
                  modalStyles.progressBarActive,
                  { opacity: progressOpacity2 },
                ]}
              />
              <Animated.View
                style={[
                  modalStyles.progressBar,
                  modalStyles.progressBarActive,
                  { opacity: progressOpacity3 },
                ]}
              />
            </View>
            <TouchableOpacity
              style={modalStyles.arrowButton}
              activeOpacity={0.8}
              onPress={handleNext}
            >
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12H19M19 12L12 5M19 12L12 19"
                  stroke={colors.white}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>
          </View>
        )}

        {/* Manual MRZ input overlay */}
        <ManualMRZInput
          isVisible={isManualInputVisible}
          onClose={handleManualInputClose}
          onSubmit={handleManualInputSubmit}
        />
      </View>
    </>
  );
}
