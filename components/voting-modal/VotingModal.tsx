import { useColors } from "@/constants/theme";
import { useModalVideoPlayers } from "@/hooks/useModalVideoPlayers";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Path, Svg } from "react-native-svg";
import type { Rarime, RarimePassport, FreedomTool, ProposalInfo } from "@rarimo/rarime-rn-sdk";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import {
  RARIME_TESTNET_CONFIG,
  FREEDOM_TOOL_CONFIG,
  PRIVATE_KEY_STORAGE_KEY,
  DEFAULT_PROPOSAL_ID,
  withRetry,
  formatRpcError,
} from "@/constants/rarime-config";
import Step1 from "./Step1";
import Step10 from "./Step10";
import Step11 from "./Step11";
import Step12Error from "./Step12Error";
import Step12Success from "./Step12Success";
import Step2 from "./Step2";
import Step3 from "./Step3";
import Step4 from "./Step4";
import Step5 from "./Step5";
import Step6 from "./Step6";
import Step7 from "./Step7";
import Step8 from "./Step8";
import Step9Vote from "./Step9Vote";
import Step9Error from "./Step9Error";
import ManualMRZInput from "./ManualMRZInput";
import { createModalStyles } from "./styles";

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

interface VotingModalProps {
  isVisible: boolean;
  onClose: () => void;
  proposalId?: string;
}

const VotingModal: React.FC<VotingModalProps> = ({ isVisible, onClose, proposalId: proposalIdProp }) => {
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [verificationResult, setVerificationResult] = useState<
    "success" | "error" | null
  >(null);
  const [voteSubmissionResult, setVoteSubmissionResult] = useState<
    "success" | "error" | null
  >(null);
  const [stepHeights, setStepHeights] = useState<Record<string, number>>({});
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
  const snapPoints = useMemo(() => {
    let stepKey = `step${currentStep}`;
    if (currentStep === 8) stepKey += `_${verificationResult}`;
    if (currentStep === 12) stepKey += `_${voteSubmissionResult || "loading"}`;

    const measuredHeight = stepHeights[stepKey];

    // Steps 1-3: tall onboarding screens
    if (currentStep <= 3) {
      return [Platform.OS === "android" ? "98%" : "96%"];
    }

    // Step 8 success
    if (currentStep === 8 && verificationResult === "success") {
      return ["45%"];
    }

    // Step 9: vote selection — scale with number of variants
    if (currentStep === 9) {
      const numVariants = proposalInfo?.questions[0]?.variants?.length ?? 3;
      const pct = Math.min(95, 45 + numVariants * 8);
      return [`${pct}%`];
    }

    // Step 10: vote confirmation
    if (currentStep === 10) {
      return ["58%"];
    }

    if (measuredHeight) {
      return [measuredHeight];
    }

    // Fallback heights
    let height;
    if (currentStep === 4) height = ["70%"];
    else if (currentStep === 5) height = ["80%"];
    else if (currentStep === 6) height = ["55%"];
    else if (currentStep === 7) height = ["58%"];
    else if (currentStep === 8 && verificationResult === "success")
      height = ["35%"];
    else if (currentStep === 8 && verificationResult === "error")
      height = ["55%"];
    else if (currentStep === 11) height = ["50%"];
    else if (currentStep === 12 && !voteSubmissionResult) height = ["50%"];
    else if (currentStep === 12 && voteSubmissionResult === "success")
      height = ["65%"];
    else if (currentStep === 12 && voteSubmissionResult === "error")
      height = ["60%"];
    else height = ["85%"];

    return height;
  }, [currentStep, verificationResult, voteSubmissionResult, stepHeights]);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(375);

  // Callback for steps to report their heights
  const handleStepLayout = useCallback((stepKey: string, height: number) => {
    setStepHeights((prev) => {
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
  const { players, handleStepChange, pauseAll, pauseVerificationVideo } =
    useModalVideoPlayers();
  const { player1, player2, player3, player4, player5 } = players;

  // Init Rarime + FreedomTool + load proposal (lazy import to avoid crypto polyfill issues)
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
        const pid = proposalIdProp || DEFAULT_PROPOSAL_ID;
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
  }, [proposalIdProp]);

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.present();
      setCurrentStep(1);
      setVerificationResult(null);
      setVoteSubmissionResult(null);
      setMRZData(null);
      setNFCData(null);
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
  }, [
    isVisible,
    slideAnim,
    progressOpacity1,
    progressOpacity2,
    progressOpacity3,
    handleStepChange,
    pauseAll,
  ]);

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
    if (currentStep < 12) {
      const nextStep = currentStep + 1;
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

      // Force snap when sheet height changes
      if (nextStep >= 10) {
        setTimeout(() => {
          bottomSheetRef.current?.snapToIndex(0);
        }, 100);
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
    // Go back to Step 5 (MRZ camera scan)
    console.log("[VotingModal] Going back to MRZ scan");
    setCurrentStep(5);
    setMRZData(null); // Clear the invalid MRZ data

    // Slide animation back to step 5
    Animated.timing(slideAnim, {
      toValue: -4 * containerWidth, // Step 5 is at index 4 (0-indexed)
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Handle video playback for step 5
    handleStepChange(5);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVerificationSuccess = useCallback(() => {
    setVerificationResult("success");
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

  const handleVoteSelect = useCallback((answerIndex: number) => {
    setSelectedVote(answerIndex);
    // Advance to step 10 (vote confirmation)
    setCurrentStep(10);
    Animated.timing(slideAnim, {
      toValue: -9 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    handleStepChange(10);
    setTimeout(() => {
      bottomSheetRef.current?.snapToIndex(0);
    }, 100);
  }, [slideAnim, containerWidth, handleStepChange]);

  const handleVoteSubmissionSuccess = useCallback(() => {
    setVoteSubmissionResult("success");
    setCurrentStep(12);
    Animated.timing(slideAnim, {
      toValue: -11 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setTimeout(() => {
      bottomSheetRef.current?.snapToIndex(0);
    }, 100);
  }, [slideAnim, containerWidth]);

  const handleVoteSubmissionError = useCallback(() => {
    setVoteSubmissionResult("error");
    setCurrentStep(12);
    Animated.timing(slideAnim, {
      toValue: -11 * containerWidth,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setTimeout(() => {
      bottomSheetRef.current?.snapToIndex(0);
    }, 100);
  }, [slideAnim, containerWidth]);

  const handleMRZScanned = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    console.log("[VotingModal] MRZ data scanned:", data);
    setMRZData(data);
    // Auto-proceed to next step (Step 6 - NFC scan)
    handleNext();
  }, [handleNext]);

  const handleNFCSuccess = useCallback((data: NFCScanResult) => {
    console.log("[VotingModal] NFC scan successful");
    setNFCData(data);

    // Create RarimePassport from NFC data
    if (data.dg1Bytes && data.sodBytes) {
      (async () => {
        try {
          const { RarimePassport: RP } = await import("@rarimo/rarime-rn-sdk");
          const dg1 = new Uint8Array(Buffer.from(data.dg1Bytes, "base64"));
          const sod = new Uint8Array(Buffer.from(data.sodBytes, "base64"));
          passportRef.current = new RP({ dataGroup1: dg1, sod });
          console.log("[FreedomTool] RarimePassport created from NFC data");
        } catch (err) {
          console.error("[FreedomTool] Failed to create RarimePassport:", err);
        }
      })();
    }

    // Proceed to next step (Step 7 - Verification)
    handleNext();
  }, [handleNext]);

  const handleNFCError = useCallback(() => {
    console.log("[VotingModal] NFC scan failed");
    // For now, just proceed to show error in next step
    // You can customize this behavior
    handleNext();
  }, [handleNext]);

  const handleManualInputOpen = useCallback(() => {
    console.log("Opening manual MRZ input");
    setIsManualInputVisible(true);
  }, []);

  const handleManualInputClose = useCallback(() => {
    setIsManualInputVisible(false);
  }, []);

  const handleManualInputSubmit = useCallback((data: { documentNumber: string; birthDate: string; expiryDate: string }) => {
    console.log("[VotingModal] Manual MRZ data submitted:", data);
    setIsManualInputVisible(false);
    handleMRZScanned(data);
  }, [handleMRZScanned]);

  return (
    <>
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose={true}
      enableContentPanningGesture={currentStep < 4}
      backdropComponent={renderBackdrop}
      backgroundStyle={modalStyles.bottomSheetBackground}
      handleIndicatorStyle={modalStyles.handleIndicator}
      onDismiss={handleDismiss}
      android_keyboardInputMode="adjustResize"
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
              },
            ]}
          >
            <Step1
              player={player1}
              containerWidth={containerWidth}
              onLayout={(e) =>
                handleStepLayout("step1", e.nativeEvent.layout.height)
              }
            />
            <Step2
              player={player2}
              containerWidth={containerWidth}
              onLayout={(e) =>
                handleStepLayout("step2", e.nativeEvent.layout.height)
              }
            />
            <Step3
              player={player3}
              containerWidth={containerWidth}
              onLayout={(e) =>
                handleStepLayout("step3", e.nativeEvent.layout.height)
              }
            />
            <Step4
              player={player1}
              containerWidth={containerWidth}
              onStartAnalysis={handleNext}
              onLayout={(e) =>
                handleStepLayout("step4", e.nativeEvent.layout.height)
              }
            />
            <Step5
              containerWidth={containerWidth}
              isActive={currentStep === 5}
              onMRZScanned={handleMRZScanned}
              onManualFill={handleManualInputOpen}
              onLayout={(e) =>
                handleStepLayout("step5", e.nativeEvent.layout.height)
              }
            />
            <Step6
              containerWidth={containerWidth}
              player={player4}
              mrzData={mrzData}
              onNFCSuccess={handleNFCSuccess}
              onNFCError={handleNFCError}
              onGoBack={handleGoBackToMRZScan}
              onLayout={(e) =>
                handleStepLayout("step6", e.nativeEvent.layout.height)
              }
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
              onLayout={(e) =>
                handleStepLayout("step7", e.nativeEvent.layout.height)
              }
            />
            {/* Step 8 position - shows either success or error based on verification result */}
            <View style={{ width: containerWidth }}>
              {verificationResult === "success" ? (
                <Step8
                  containerWidth={containerWidth}
                  onVoteSuccess={handleNext}
                  onLayout={(e) =>
                    handleStepLayout("step8_success", e.nativeEvent.layout.height)
                  }
                />
              ) : verificationResult === "error" ? (
                <Step9Error
                  containerWidth={containerWidth}
                  onGoHome={onClose}
                  onLayout={(e) =>
                    handleStepLayout("step8_error", e.nativeEvent.layout.height)
                  }
                />
              ) : null}
            </View>
            {/* Step 9 - Vote selection */}
            <Step9Vote
              containerWidth={containerWidth}
              onVoteSelect={handleVoteSelect}
              onCancel={onClose}
              proposalInfo={proposalInfo ?? undefined}
              onLayout={(e) =>
                handleStepLayout("step9_vote", e.nativeEvent.layout.height)
              }
            />
            {/* Step 10 - Vote confirmation */}
            <Step10
              containerWidth={containerWidth}
              player={player3}
              selectedVote={selectedVote}
              proposalInfo={proposalInfo ?? undefined}
              onCancel={onClose}
              onConfirm={handleNext}
              onLayout={(e) =>
                handleStepLayout("step10", e.nativeEvent.layout.height)
              }
            />
            {/* Step 11 - Vote submission loading */}
            <Step11
              containerWidth={containerWidth}
              isActive={currentStep === 11}
              onSuccess={handleVoteSubmissionSuccess}
              onError={handleVoteSubmissionError}
              onLayout={(e) =>
                handleStepLayout("step11_loading", e.nativeEvent.layout.height)
              }
              freedomTool={freedomToolRef.current ?? undefined}
              rarime={rarimeRef.current ?? undefined}
              passport={passportRef.current ?? undefined}
              proposalInfo={proposalInfo ?? undefined}
              answerIndex={selectedVote}
            />
            {/* Step 11 position - shows either success or error based on vote submission result */}
            {voteSubmissionResult === "success" ? (
              <Step12Success
                containerWidth={containerWidth}
                onViewResults={onClose}
                onLayout={(e) =>
                  handleStepLayout(
                    "step11_success",
                    e.nativeEvent.layout.height
                  )
                }
              />
            ) : voteSubmissionResult === "error" ? (
              <Step12Error
                containerWidth={containerWidth}
                onGoHome={onClose}
                onLayout={(e) =>
                  handleStepLayout("step11_error", e.nativeEvent.layout.height)
                }
              />
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
      </BottomSheetView>
    </BottomSheetModal>
    <ManualMRZInput
      isVisible={isManualInputVisible}
      onClose={handleManualInputClose}
      onSubmit={handleManualInputSubmit}
    />
    </>
  );
};

export default VotingModal;
