import { useColors, Typography, Spacing } from "@/constants/theme";
import { useRouter, Stack } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  Image,
  Modal,
  ActivityIndicator,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
} from "react-native-vision-camera";
import { useTextRecognition } from "react-native-vision-camera-text-recognition";
import { Worklets } from "react-native-worklets-core";
import { parse } from "mrz";
import { getRandomValues } from "expo-crypto";
import {
  Rarime,
  RarimePassport,
  RarimeUtils,
  DocumentStatus,
  FreedomTool,
} from "@rarimo/rarime-rn-sdk";
import type { ProposalInfo } from "@rarimo/rarime-rn-sdk";
import * as SecureStore from "expo-secure-store";
import { Buffer } from "buffer";
import { Svg, Path } from "react-native-svg";
import {
  RARIME_TESTNET_CONFIG,
  FREEDOM_TOOL_CONFIG,
  PRIVATE_KEY_STORAGE_KEY,
  withRetry,
  formatRpcError,
} from "@/constants/rarime-config";
import { NfcDiagnosticCard } from "@/components/diagnostics/NfcDiagnosticCard";
import { RarimeTestnetCard } from "@/components/diagnostics/RarimeTestnetCard";

// --- Icons ---

const ArrowLeftIcon = ({
  color,
  size = 24,
}: {
  color: string;
  size?: number;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M19 12H5M5 12L12 19M5 12L12 5"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// --- Helpers ---

const shortenValue = (value: any, maxLength = 50): string => {
  if (value === null || value === undefined) return "N/A";
  const str = String(value);
  return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
};

const getByteLength = (base64: string | undefined): string => {
  if (!base64) return "N/A";
  try {
    return `${Buffer.from(base64, "base64").length} bytes`;
  } catch {
    return "N/A";
  }
};

// --- Date helpers ---

const convertMRZDateToFrench = (yymmdd: string): string => {
  if (!yymmdd || yymmdd.length !== 6) return yymmdd;
  return `${yymmdd.substring(4, 6)}/${yymmdd.substring(2, 4)}/${yymmdd.substring(0, 2)}`;
};

const convertFrenchDateToMRZ = (frenchDate: string): string => {
  if (!frenchDate) return frenchDate;
  const cleaned = frenchDate.replace(/\s/g, "");
  if (cleaned.length === 6 && !cleaned.includes("/")) return cleaned;
  const parts = cleaned.split("/");
  if (parts.length !== 3) return frenchDate;
  return `${parts[2].padStart(2, "0")}${parts[1].padStart(2, "0")}${parts[0].padStart(2, "0")}`;
};

const formatDateToFrench = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).substring(2);
  return `${dd}/${mm}/${yy}`;
};

const formatDateInput = (text: string): string => {
  const digits = text.replace(/\D/g, "").substring(0, 6);
  if (digits.length === 0) return "";

  let day = digits.substring(0, 2);
  let month = digits.substring(2, 4);
  const year = digits.substring(4, 6);

  if (day.length === 2) {
    const n = parseInt(day, 10);
    if (n === 0) day = "01";
    if (n > 31) day = "31";
  } else if (day.length === 1 && parseInt(day, 10) > 3) {
    day = "0" + day;
  }

  if (month.length === 2) {
    const n = parseInt(month, 10);
    if (n === 0) month = "01";
    if (n > 12) month = "12";
  } else if (month.length === 1 && parseInt(month, 10) > 1) {
    month = "0" + month;
  }

  if (digits.length <= 2) return day;
  if (digits.length <= 4) return `${day}/${month}`;
  return `${day}/${month}/${year}`;
};

// =============================================================================
// Component
// =============================================================================

export default function FrenchIDTestScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = createStyles(colors);

  // --- State ---

  const [documentNo, setDocumentNo] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [expiryDate, setExpiryDate] = React.useState("");
  const [can] = React.useState(""); // CAN disabled — causes scan failures on iOS

  const [isScanning, setIsScanning] = React.useState(false);
  const [scanStatus, setScanStatus] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [mrzScanProgress, setMrzScanProgress] = React.useState<'idle' | 'scanning' | 'partial' | 'success'>('idle');
  const [tagData, setTagData] = React.useState<any>(null);

  const [nfcProgress, setNfcProgress] = React.useState(0);
  const progressQueueRef = React.useRef<number[]>([]);
  const isProcessingProgressRef = React.useRef(false);

  const [nfcLogs, setNfcLogs] = React.useState<string[]>([]);
  const [showLogs, setShowLogs] = React.useState(true);

  // Date pickers
  const [showBirthDatePicker, setShowBirthDatePicker] = React.useState(false);
  const [showExpiryDatePicker, setShowExpiryDatePicker] = React.useState(false);
  const [birthDateObj, setBirthDateObj] = React.useState(new Date(1990, 0, 1));
  const [expiryDateObj, setExpiryDateObj] = React.useState(
    new Date(2030, 11, 31)
  );

  // Camera
  const [showCamera, setShowCamera] = React.useState(false);
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const { scanText } = useTextRecognition({ language: "latin" });

  // Rarime
  const [privateKey, setPrivateKey] = React.useState<string | null>(null);
  const [documentStatus, setDocumentStatus] = React.useState<string | null>(
    null
  );
  const [isCheckingStatus, setIsCheckingStatus] = React.useState(false);
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [registrationTxHash, setRegistrationTxHash] = React.useState<
    string | null
  >(null);
  const challengeRef = React.useRef<Uint8Array | null>(null);
  const rarimePassportRef = React.useRef<RarimePassport | null>(null);

  // Freedom Tool voting
  const [proposalId, setProposalId] = React.useState("236");
  const [proposalInfo, setProposalInfo] = React.useState<ProposalInfo | null>(null);
  const [isLoadingProposal, setIsLoadingProposal] = React.useState(false);
  const [isEligible, setIsEligible] = React.useState<boolean | null>(null);
  const [hasVoted, setHasVoted] = React.useState<boolean | null>(null);
  const [selectedAnswer, setSelectedAnswer] = React.useState<number | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = React.useState(false);
  const [voteTxHash, setVoteTxHash] = React.useState<string | null>(null);
  const [voteError, setVoteError] = React.useState<string | null>(null);

  // --- Effects ---

  // Init BJJ private key
  React.useEffect(() => {
    (async () => {
      try {
        let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
        // Validate key: must be 64 hex chars (no 0x prefix) to work with the SDK
        const rawKey = storedKey?.startsWith("0x") ? storedKey.slice(2) : storedKey;
        if (!rawKey || rawKey.length !== 64) {
          console.log("[Init] Invalid or missing key, generating new one");
          storedKey = RarimeUtils.generateBJJPrivateKey();
          await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
        }
        setPrivateKey(storedKey!);
      } catch (err) {
        console.error("Failed to initialize private key:", err);
      }
    })();
  }, []);

  // Progress queue processor
  const processProgressQueue = React.useCallback(() => {
    if (progressQueueRef.current.length === 0) {
      isProcessingProgressRef.current = false;
      return;
    }
    isProcessingProgressRef.current = true;
    const next = progressQueueRef.current.shift()!;
    setNfcProgress(next);
    setTimeout(() => processProgressQueue(), 400);
  }, []);

  const queueProgressUpdate = React.useCallback(
    (value: number) => {
      if (Platform.OS !== "android") return;
      progressQueueRef.current.push(value);
      if (!isProcessingProgressRef.current) processProgressQueue();
    },
    [processProgressQueue]
  );

  // NFC event listeners
  React.useEffect(() => {
    let listeners: any[] = [];

    const setup = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import(
          "@/modules/e-document"
        );

        listeners = [
          EDocumentModuleListener(
            EDocumentModuleEvents.RequestPresentPassport,
            () => {
              setScanStatus("Approchez votre carte d'identite");
              queueProgressUpdate(10);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.AuthenticatingWithPassport,
            () => {
              setScanStatus("Authentification PACE...");
              queueProgressUpdate(25);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.ReadingDataGroupProgress,
            () => {
              setScanStatus("Lecture des donnees...");
              queueProgressUpdate(60);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.ActiveAuthentication,
            () => {
              setScanStatus("Verification du chip...");
              queueProgressUpdate(85);
            }
          ),
          EDocumentModuleListener(
            EDocumentModuleEvents.SuccessfulRead,
            () => {
              setScanStatus("Lecture reussie !");
              queueProgressUpdate(100);
            }
          ),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus("Erreur de lecture");
            progressQueueRef.current = [];
            isProcessingProgressRef.current = false;
            setNfcProgress(0);
          }),
          EDocumentModuleListener(
            EDocumentModuleEvents.DebugLog,
            (event: unknown) => {
              const { message } = event as { message: string };
              console.log("[FrenchID]", message);
              const ts = new Date().toISOString().split("T")[1].slice(0, 8);
              setNfcLogs((prev) => [...prev, `${ts} ${message}`]);
            }
          ),
        ];
      } catch (err) {
        console.warn("Failed to setup event listeners:", err);
      }
    };

    setup();

    return () => {
      listeners.forEach((l) => {
        try {
          l.remove();
        } catch {}
      });
    };
  }, [queueProgressUpdate]);

  // --- MRZ Parser ---

  const mrzHistoryRef = React.useRef<string[][]>([]);

  const parseMRZ = React.useCallback((lines: string[]) => {
    if (lines.length < 3) return null;
    try {
      const td1Lines = lines.slice(-3);
      const sanitized = td1Lines.map((line) => {
        const cleaned = line
          .replaceAll("\u00AB", "<<")
          .replaceAll(" ", "")
          .toUpperCase();
        return cleaned.length > 30
          ? cleaned.substring(0, 30)
          : cleaned.padEnd(30, "<");
      });
      const result = parse(sanitized, { autocorrect: true });
      if (result?.valid && result.format === "TD1") return result;
    } catch {}
    return null;
  }, []);

  const sanitizeMRZLine = (line: string): string => {
    const cleaned = line.replaceAll('\u00AB', '<').replaceAll(' ', '').toUpperCase();
    return cleaned.length > 30 ? cleaned.substring(0, 30) : cleaned.padEnd(30, '<');
  };

  const buildConsensus = React.useCallback((history: string[][]): string[] => {
    return [0, 1, 2].map(lineIdx => {
      let result = '';
      for (let pos = 0; pos < 30; pos++) {
        const chars: Record<string, number> = {};
        for (const read of history) {
          const ch = read[lineIdx]?.[pos] || '<';
          chars[ch] = (chars[ch] || 0) + 1;
        }
        result += Object.entries(chars).sort((a, b) => b[1] - a[1])[0][0];
      }
      return result;
    });
  }, []);

  const isMRZLike = (line: string): boolean => {
    const cleaned = line.replaceAll('\u00AB', '<<').replaceAll(' ', '').toUpperCase();
    return (cleaned.includes('<<') || cleaned.startsWith('ID')) && cleaned.length >= 20;
  };

  const handleMRZSuccess = React.useCallback((result: ReturnType<typeof parse>) => {
    setMrzScanProgress('success');
    setDocumentNo(
      (result.fields.documentNumber || "").trim().toUpperCase()
    );
    setBirthDate(convertMRZDateToFrench(result.fields.birthDate || ""));
    setExpiryDate(
      convertMRZDateToFrench(result.fields.expirationDate || "")
    );
    setTimeout(() => {
      setShowCamera(false);
      setError(null);
    }, 500);
  }, []);

  const onMRZDetected = Worklets.createRunOnJS((lines: string[]) => {
    try {
      const mrzLikeLines = lines.filter(isMRZLike);
      const mrzLikeCount = mrzLikeLines.length;
      if (mrzLikeCount > 0 && mrzLikeCount < 3) {
        setMrzScanProgress('partial');
      } else if (mrzLikeCount === 0) {
        setMrzScanProgress('scanning');
      }

      // Try parsing the raw single frame directly
      const result = parseMRZ(lines);
      if (result?.valid) {
        handleMRZSuccess(result);
        return;
      }

      // Accumulate for consensus if we have 3 MRZ-like lines
      if (mrzLikeCount >= 3) {
        const sanitized = mrzLikeLines.slice(-3).map(sanitizeMRZLine);
        mrzHistoryRef.current.push(sanitized);
        if (mrzHistoryRef.current.length > 15) {
          mrzHistoryRef.current = mrzHistoryRef.current.slice(-15);
        }

        if (mrzHistoryRef.current.length >= 3) {
          const consensus = buildConsensus(mrzHistoryRef.current);
          console.log(`[MRZ Consensus] (${mrzHistoryRef.current.length} reads):`, consensus);
          try {
            const consensusResult = parse(consensus, { autocorrect: true });
            if (consensusResult?.valid && consensusResult.format === 'TD1') {
              handleMRZSuccess(consensusResult);
            }
          } catch {}
        }
      }
    } catch {}
  });

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      runAtTargetFps(2, () => {
        "worklet";
        const data = scanText(frame);
        try {
          let resultText = "";
          if (data) {
            if (Array.isArray(data) && data.length) {
              resultText = data.map((el: any) => el.resultText).join("\n");
            } else if (data && "resultText" in data) {
              resultText = (data as any).resultText as string;
            }
            if (resultText) onMRZDetected(resultText.split("\n"));
          }
        } catch {}
      });
    },
    [scanText, onMRZDetected]
  );

  // --- Handlers ---

  const openMRZScanner = async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        setError("Permission camera refusee");
        return;
      }
    }
    setShowCamera(true);
    setMrzScanProgress('idle');
    mrzHistoryRef.current = [];
    setError(null);
  };

  const onBirthDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") setShowBirthDatePicker(false);
    if (selectedDate) {
      setBirthDateObj(selectedDate);
      setBirthDate(formatDateToFrench(selectedDate));
    }
  };

  const onExpiryDateChange = (_event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") setShowExpiryDatePicker(false);
    if (selectedDate) {
      setExpiryDateObj(selectedDate);
      setExpiryDate(formatDateToFrench(selectedDate));
    }
  };

  const handleScan = async () => {
    if (!documentNo || !birthDate || !expiryDate) {
      setError("Veuillez remplir tous les champs MRZ");
      return;
    }
    setIsScanning(true);
    setError(null);
    setTagData(null);
    setScanStatus("");
    progressQueueRef.current = [];
    isProcessingProgressRef.current = false;
    setNfcProgress(0);

    try {
      const { scanDocument } = await import("@/modules/e-document");
      const challenge = getRandomValues(new Uint8Array(32));
      challengeRef.current = challenge;

      const bacBirthDate = convertFrenchDateToMRZ(birthDate);
      const bacExpiryDate = convertFrenchDateToMRZ(expiryDate);

      const result = await scanDocument(
        "I",
        {
          documentNumber: documentNo,
          dateOfBirth: bacBirthDate,
          dateOfExpiry: bacExpiryDate,
        },
        challenge
      );

      console.log("=== FRENCH ID SCAN RESULT ===");
      const { passportImageRaw, ...personSummary } = result.personDetails;
      console.log("Person:", personSummary);
      console.log("Image:", passportImageRaw ? `${passportImageRaw.length} chars` : "none");

      // --- Rarime SDK integration ---
      const dg1 = new Uint8Array(result.dg1Bytes);
      const sod = new Uint8Array(result.sodBytes);

      try {
        // French ID cards don't have DG15 or Active Authentication
        const rarimePassport = new RarimePassport({
          dataGroup1: dg1,
          sod: sod,
        });
        rarimePassportRef.current = rarimePassport;

        // Check document status
        if (privateKey) {
          setIsCheckingStatus(true);
          setDocumentStatus(null);
          try {
            console.log("[Rarime] Checking document status...");
            let currentKey = privateKey;
            const rarime = new Rarime({
              ...RARIME_TESTNET_CONFIG,
              userConfiguration: { userPrivateKey: currentKey },
            });
            const status = await rarime.getDocumentStatus(rarimePassport);
            console.log("[Rarime] Document status:", status);

            setDocumentStatus(status);
          } catch (statusErr) {
            console.error("[Rarime] getDocumentStatus error:", statusErr);
            setDocumentStatus(
              "ERROR: " + (statusErr as Error).message
            );
          } finally {
            setIsCheckingStatus(false);
          }
        }
      } catch (rarimeErr) {
        console.error("Rarime SDK Error:", rarimeErr);
      }

      setScanStatus("Scan termine avec succes !");
      setTagData(result);
      setError(null);
    } catch (ex: any) {
      console.warn("EDocument error:", ex);
      const debugInfo = `${ex?.name || 'Error'}: ${ex?.message || 'unknown'}\nCode: ${ex?.code || 'none'}\nInfo: ${JSON.stringify(ex?.userInfo || ex?.nativeError || {})}\nStack: ${ex?.stack?.substring(0, 300) || 'none'}`;
      setError(debugInfo);
      setScanStatus("");
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanStatus(""), 3000);
    }
  };

  const registerIdentity = async () => {
    const currentKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
    if (!currentKey || !rarimePassportRef.current) {
      setError(
        "Carte d'identite non scannee ou cle privee non disponible"
      );
      return;
    }
    setIsRegistering(true);
    setRegistrationTxHash(null);
    try {
      console.log("[Rarime] Starting registration...");
      const rarime = new Rarime({
        ...RARIME_TESTNET_CONFIG,
        userConfiguration: { userPrivateKey: currentKey },
      });
      const passport = rarimePassportRef.current;
      const status = await rarime.getDocumentStatus(passport);
      console.log("[Rarime] Status before register:", status);

      if (status === DocumentStatus.RegisteredWithThisPk) {
        console.log("[Rarime] Already registered with this key");
        setDocumentStatus(DocumentStatus.RegisteredWithThisPk);
        return;
      }

      // Bypass SDK guard for RegisteredWithOtherPk — call internal methods directly.
      // The smart contract's registerSimpleViaNoir will overwrite the old bond.
      const r = rarime as any;
      const hashAlgoOID = passport.extractDGHashAlgo();
      const oidToLength: Record<string, number> = {
        "1.3.14.3.2.26": 160, "1.2.840.113549.1.1.5": 160,             // SHA1
        "2.16.840.1.101.3.4.2.4": 224, "1.2.840.113549.1.1.14": 224,   // SHA224
        "2.16.840.1.101.3.4.2.1": 256, "1.2.840.113549.1.1.11": 256,   // SHA256
        "1.2.840.10045.4.3.2": 256,                                     // ECDSA-SHA256
        "2.16.840.1.101.3.4.2.2": 384, "1.2.840.113549.1.1.12": 384,   // SHA384
        "2.16.840.1.101.3.4.2.3": 512, "1.2.840.113549.1.1.13": 512,   // SHA512
      };
      const hashLength = oidToLength[hashAlgoOID];
      if (!hashLength) throw new Error(`Unsupported hash OID: ${hashAlgoOID}`);
      console.log("[Rarime] Generating registration proof...");
      const proof = await r.generateLiteRegisterProof(hashLength, passport);
      console.log("[Rarime] Verifying SOD...");
      const verifySodResponse = await r.verifySodRequest(passport, proof);
      const verifySodParsed = await verifySodResponse.json();
      console.log("[Rarime] Building calldata...");
      const txCallData = r.buildLiteRegisterCalldata(verifySodParsed, proof, passport);
      console.log("[Rarime] Sending registration TX...");
      const regResponse = await r.sendRegisterLiteTransaction(txCallData);
      const regParsed = await regResponse.json();
      const txHash = regParsed.data.id;

      console.log("[Rarime] Registration txHash:", txHash);
      setRegistrationTxHash(txHash);
      setDocumentStatus(DocumentStatus.RegisteredWithThisPk);
    } catch (regErr) {
      console.error("[Rarime] registerIdentity error:", regErr);
      setError("Registration failed: " + (regErr as Error).message);
    } finally {
      setIsRegistering(false);
    }
  };

  // --- Freedom Tool Voting ---

  // Decode bigint-encoded citizenship back to 3-letter ISO country code
  const decodeCitizenship = (code: bigint): string => {
    const hex = code.toString(16);
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      result += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return result;
  };

  const loadProposal = async () => {
    setIsLoadingProposal(true);
    setProposalInfo(null);
    setIsEligible(null);
    setHasVoted(null);
    setSelectedAnswer(null);
    setVoteTxHash(null);
    setVoteError(null);
    try {
      console.log(`[FreedomTool] Loading proposal ${proposalId}...`);
      const ft = new FreedomTool(FREEDOM_TOOL_CONFIG);
      const info = await ft.getProposalInfo(proposalId);
      console.log("[FreedomTool] Proposal loaded:", info.title);
      const whitelistedCountries = info.criteria.citizenshipWhitelist.map(decodeCitizenship);
      console.log("[FreedomTool] Whitelisted citizenships:", whitelistedCountries);
      if (whitelistedCountries.length > 0 && !whitelistedCountries.includes("FRA")) {
        console.warn("[FreedomTool] WARNING: France (FRA) is NOT in the whitelist!");
      }
      setProposalInfo(info);
    } catch (err) {
      console.error("[FreedomTool] getProposalInfo error:", err);
      setVoteError("Failed to load proposal: " + (err as Error).message);
    } finally {
      setIsLoadingProposal(false);
    }
  };

  const checkEligibility = async () => {
    if (!proposalInfo || !rarimePassportRef.current) return;
    // Always read the latest key from SecureStore (may have been recovered)
    const currentKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
    if (!currentKey) return;
    setVoteError(null);
    try {
      console.log("[FreedomTool] Checking eligibility...");
      const ft = new FreedomTool(FREEDOM_TOOL_CONFIG);
      const rarime = new Rarime({
        ...RARIME_TESTNET_CONFIG,
        userConfiguration: { userPrivateKey: currentKey },
      });

      // Check if already voted
      const voted = await ft.isAlreadyVoted(proposalInfo, rarime);
      console.log("[FreedomTool] Already voted:", voted);
      setHasVoted(voted);

      if (!voted) {
        // Verify eligibility (throws if not eligible)
        await ft.verify(proposalInfo, rarimePassportRef.current, rarime);
        console.log("[FreedomTool] Eligible: true");
        setIsEligible(true);
      }
    } catch (err) {
      console.error("[FreedomTool] Eligibility check error:", err);
      setIsEligible(false);
      setVoteError((err as Error).message);
    }
  };

  const submitVote = async () => {
    if (!proposalInfo || !rarimePassportRef.current || selectedAnswer === null) return;
    const currentKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
    if (!currentKey) return;
    setIsSubmittingVote(true);
    setVoteError(null);
    setVoteTxHash(null);
    try {
      // Pre-flight citizenship check
      const whitelist = proposalInfo.criteria.citizenshipWhitelist;
      if (whitelist.length > 0) {
        const allowed = whitelist.map(decodeCitizenship);
        if (!allowed.includes("FRA")) {
          setVoteError(
            `Votre nationalite (FRA) n'est pas dans la liste autorisee pour cette proposition.\n` +
            `Nationalites autorisees : [${allowed.join(", ")}].\n` +
            `Essayez une autre proposition.`
          );
          setIsSubmittingVote(false);
          return;
        }
      }

      console.log(`[FreedomTool] Submitting vote answer=${selectedAnswer}...`);
      const ft = new FreedomTool(FREEDOM_TOOL_CONFIG) as any;
      const rarime = new Rarime({
        ...RARIME_TESTNET_CONFIG,
        userConfiguration: { userPrivateKey: currentKey },
      }) as any;
      const passport = rarimePassportRef.current;

      // Step-by-step to capture full error details
      await ft.verify(proposalInfo, passport, rarime);
      console.log("[FreedomTool] Verify passed");

      // Debug: log passport data before proof generation
      console.log("[FreedomTool] DG1 length:", passport.dataGroup1.length, "(expected: 95)");
      console.log("[FreedomTool] DG1 hex:", Buffer.from(passport.dataGroup1).toString("hex"));
      try {
        console.log("[FreedomTool] PassportKey:", passport.getPassportKey().toString(16));
      } catch (e) { console.warn("[FreedomTool] PassportKey error:", e); }
      try {
        const mrzData = passport.getMRZData();
        console.log("[FreedomTool] MRZ data:", JSON.stringify(mrzData));
      } catch (e) { console.warn("[FreedomTool] MRZ parse error:", e); }

      const passportInfo = await rarime.getPassportInfo(passport);
      console.log("[FreedomTool] PassportInfo fetched");
      console.log("[FreedomTool] On-chain passportInfo:", JSON.stringify(passportInfo, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v
      ));

      const queryProofParams = await ft.buildQueryProofParams(
        [selectedAnswer], proposalInfo, passportInfo
      );
      console.log("[FreedomTool] QueryProofParams built");
      console.log("[FreedomTool] QueryProofParams:", JSON.stringify(queryProofParams));
      console.log("[FreedomTool] criteria.timestampUpperbound:", proposalInfo.criteria.timestampUpperbound.toString());
      console.log("[FreedomTool] passportInfo[1][1] (issueTimestamp):", passportInfo[1][1].toString());
      console.log("[FreedomTool] issueTimestamp > timestampUpperbound?", passportInfo[1][1] > proposalInfo.criteria.timestampUpperbound);

      // Snapshot SMT root BEFORE proof generation to detect race condition
      const smtRootBefore = await (rarime as any).getSMTProof(passport);
      console.log("[FreedomTool] SMT root BEFORE proof:", smtRootBefore.root);

      let queryProof;
      try {
        queryProof = await rarime.generateQueryProof(queryProofParams, passport);
      } catch (proofErr) {
        console.error("[FreedomTool] Proof generation failed:", proofErr);
        console.error("[FreedomTool] This likely means circuit constraints are unsatisfied.");
        console.error("[FreedomTool] DG1 length:", passport.dataGroup1.length, "expected: 95");
        throw proofErr;
      }
      console.log("[FreedomTool] ZK proof generated");
      console.log("[FreedomTool] ALL pub_signals:", JSON.stringify(queryProof.pub_signals));
      console.log("[FreedomTool] pub_signals count:", queryProof.pub_signals.length);
      console.log("[FreedomTool] pub_signals[5] (TD1 citizenship):", queryProof.pub_signals[5]);
      console.log("[FreedomTool] pub_signals[14] (currentDate passed to contract):", queryProof.pub_signals[14]);

      // Check if root changed during proof generation
      const smtRootAfter = await (rarime as any).getSMTProof(passport);
      console.log("[FreedomTool] SMT root AFTER proof:", smtRootAfter.root);
      if (smtRootBefore.root !== smtRootAfter.root) {
        console.warn("[FreedomTool] ⚠️ SMT root CHANGED during proof generation - race condition!");
      } else {
        console.log("[FreedomTool] ✅ SMT root stable");
      }
      // Check which pub_signal matches the SMT root (to find the right index)
      queryProof.pub_signals.forEach((sig: string, idx: number) => {
        if (sig && smtRootBefore.root && ('0x' + sig).toLowerCase() === smtRootBefore.root.toLowerCase()) {
          console.log(`[FreedomTool] pub_signals[${idx}] matches SMT root`);
        }
      });

      const txCallData = await ft.buildProposalCallData(
        [selectedAnswer], proposalInfo, rarime, passport, queryProof, passportInfo
      );
      console.log("[FreedomTool] CallData built, length:", txCallData.length);
      console.log("[FreedomTool] Destination:", proposalInfo.sendVoteContractAddress);

      // Call getPublicSignalsTD1 to see how the CONTRACT builds pub_signals
      try {
        const { createIDCardVotingContract } = await import('@rarimo/rarime-rn-sdk/build/helpers/contracts');
        const { JsonRpcProvider: JRP } = await import('ethers');
        const idCardVotingView = createIDCardVotingContract(
          proposalInfo.sendVoteContractAddress, new JRP(FREEDOM_TOOL_CONFIG.api.votingRpcUrl)
        );
        // Build userPayload same way as SDK
        const { AbiCoder: AC } = await import('ethers');
        const abiC = new AC();
        let identityCreationTimestamp = 0n;
        if (passportInfo[1][1] > proposalInfo.criteria.timestampUpperbound) {
          identityCreationTimestamp = (2n ** 64n - 1n) - 1n;
        }
        const userPayload = abiC.encode(
          ["uint256", "uint256[]", "tuple(uint256,uint256,uint256)"],
          [proposalInfo.id, [selectedAnswer].map((v: number) => 1 << Number(v)),
           ["0x" + queryProof.pub_signals[0], "0x" + queryProof.pub_signals[6], identityCreationTimestamp]]
        );
        const contractPubSignals = await idCardVotingView.contractInstance.getPublicSignalsTD1(
          smtRootBefore.root,
          "0x" + queryProof.pub_signals[14],
          userPayload
        );
        console.log("[Contract] getPublicSignalsTD1 returned", contractPubSignals.length, "signals");
        // Compare each position with proof's pub_signals
        contractPubSignals.forEach((sig: string, idx: number) => {
          const proofSig = "0x" + queryProof.pub_signals[idx];
          const match = sig.toLowerCase() === proofSig.toLowerCase() ? "✅" : "❌ MISMATCH";
          if (sig.toLowerCase() !== proofSig.toLowerCase()) {
            console.warn(`[Compare] [${idx}] ${match} contract=${sig} proof=${proofSig}`);
          }
        });
        console.log("[Compare] Done (with citizenship=0) - mismatches shown above");

        // Now test with FRA as citizenship to see if ALL positions match
        const userPayloadFRA = abiC.encode(
          ["uint256", "uint256[]", "tuple(uint256,uint256,uint256)"],
          [proposalInfo.id, [selectedAnswer].map((v: number) => 1 << Number(v)),
           ["0x" + queryProof.pub_signals[0], "0x" + queryProof.pub_signals[5], identityCreationTimestamp]]
        );
        const contractPubSignalsFRA = await idCardVotingView.contractInstance.getPublicSignalsTD1(
          smtRootBefore.root,
          "0x" + queryProof.pub_signals[14],
          userPayloadFRA
        );
        console.log("[Contract] getPublicSignalsTD1 with FRA:");
        let fraMatchCount = 0;
        contractPubSignalsFRA.forEach((sig: string, idx: number) => {
          const proofSig = "0x" + queryProof.pub_signals[idx];
          if (sig.toLowerCase() !== proofSig.toLowerCase()) {
            console.warn(`[CompareFRA] [${idx}] ❌ MISMATCH contract=${sig} proof=${proofSig}`);
          } else {
            fraMatchCount++;
          }
        });
        console.log(`[CompareFRA] ${fraMatchCount}/24 match. If all 24 match → pass FRA as citizenship!`);
      } catch (compareErr: any) {
        console.error("[Compare] getPublicSignalsTD1 error:", compareErr.message);
      }

      // Simulate via eth_call to get exact revert reason
      try {
        const simResult = await fetch(FREEDOM_TOOL_CONFIG.api.votingRpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", method: "eth_call",
            params: [{ to: proposalInfo.sendVoteContractAddress, data: txCallData }, "latest"],
            id: 1,
          }),
        });
        const simJson = await simResult.json();
        if (simJson.error) {
          console.error("[eth_call] Revert data:", JSON.stringify(simJson.error));
          const revertData = simJson.error?.data || simJson.error?.message || "";
          console.error("[eth_call] Revert hex:", revertData);
        } else {
          console.log("[eth_call] Simulation OK (no revert):", simJson.result);
        }
      } catch (simErr) {
        console.error("[eth_call] Simulation fetch error:", simErr);
      }

      console.log("[FreedomTool] Sending to relayer...");

      // Send vote — capture full response on error
      const sendVoteRequest = {
        data: {
          attributes: {
            tx_data: txCallData,
            destination: proposalInfo.sendVoteContractAddress,
          },
        },
      };
      const response = await fetch(
        FREEDOM_TOOL_CONFIG.api.votingRelayerUrl +
          "/integrations/proof-verification-relayer/v3/vote",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sendVoteRequest),
        }
      );
      if (!response.ok) {
        const errorBody = await response.text();
        console.error("[FreedomTool] Relayer error body:", errorBody);
        throw new Error(`Relayer HTTP ${response.status}: ${errorBody}`);
      }
      const result = await response.json();
      const txHash = result.data.id;

      console.log("[FreedomTool] Vote TX hash:", txHash);
      setVoteTxHash(txHash);
      setHasVoted(true);
    } catch (err) {
      console.error("[FreedomTool] submitProposal error:", err);
      setVoteError("Vote failed: " + (err as Error).message);
    } finally {
      setIsSubmittingVote(false);
    }
  };

  // --- Render ---

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeftIcon color={colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Test French ID</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* iOS Info Notice */}
        {Platform.OS === "ios" && (
          <View style={styles.iosNotice}>
            <Text style={styles.iosNoticeTitle}>
              Lecture NFC sur iPhone
            </Text>
            <Text style={styles.iosNoticeText}>
              La lecture NFC des cartes d'identite francaises est supportee.
              La lecture peut etre plus lente que sur Android.
            </Text>
          </View>
        )}

        {/* NFC Diagnostic (iOS only) */}
        <NfcDiagnosticCard />

        {/* Camera Scanner */}
        {showCamera && device && (
          <View style={styles.cameraContainer}>
            <Camera
              style={styles.camera}
              device={device}
              isActive={showCamera}
              frameProcessor={frameProcessor}
            />
            {/* ID card overlay guide */}
            <View style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 60,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <View style={{
                width: '88%',
                aspectRatio: 1.586,
                borderWidth: mrzScanProgress === 'success' ? 4 : mrzScanProgress === 'partial' ? 3 : 2,
                borderColor: mrzScanProgress === 'success' ? '#10B981' : mrzScanProgress === 'partial' ? '#FBBF24' : 'rgba(255,255,255,0.7)',
                borderRadius: 12,
                backgroundColor: mrzScanProgress === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(0,0,0,0.25)',
                justifyContent: 'space-between',
                padding: 12,
              }}>
                <Text style={{
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 12, fontWeight: 'bold', letterSpacing: 2,
                  alignSelf: 'flex-end',
                }}>CARTE D'IDENTITÉ</Text>
                <View style={{
                  backgroundColor: mrzScanProgress === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.1)',
                  borderWidth: 1,
                  borderColor: mrzScanProgress === 'success' ? '#10B981' : mrzScanProgress === 'partial' ? '#FBBF24' : 'rgba(255,255,255,0.4)',
                  borderRadius: 4, padding: 6,
                }}>
                  <Text style={{ color: mrzScanProgress === 'success' ? '#10B981' : 'rgba(255,255,255,0.6)', fontSize: 7, letterSpacing: 1 }}>
                    IDFRA{'<'.repeat(25)}
                  </Text>
                  <Text style={{ color: mrzScanProgress === 'success' ? '#10B981' : 'rgba(255,255,255,0.6)', fontSize: 7, letterSpacing: 1 }}>
                    1234567890FRA9001011M{'<'.repeat(9)}
                  </Text>
                  <Text style={{ color: mrzScanProgress === 'success' ? '#10B981' : 'rgba(255,255,255,0.6)', fontSize: 7, letterSpacing: 1 }}>
                    NOM{'<'.repeat(2)}PRENOM{'<'.repeat(19)}
                  </Text>
                </View>
              </View>
              <Text style={{
                color: '#fff', fontSize: 14, fontWeight: '600',
                textAlign: 'center', marginTop: 12,
                textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
              }}>
                {mrzScanProgress === 'idle' && 'Positionnez le dos de la carte'}
                {mrzScanProgress === 'scanning' && 'Recherche du MRZ...'}
                {mrzScanProgress === 'partial' && 'MRZ partiellement détecté...'}
                {mrzScanProgress === 'success' && '✅ MRZ détecté !'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeCameraButton}
              onPress={() => setShowCamera(false)}
            >
              <Text style={styles.closeCameraText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Rarime Testnet Status */}
        <RarimeTestnetCard
          passport={rarimePassportRef.current}
          documentStatus={documentStatus}
          isCheckingStatus={isCheckingStatus}
          isRegistering={isRegistering}
          registrationTxHash={registrationTxHash}
          onRegister={registerIdentity}
          onReset={(newKey) => {
            setPrivateKey(newKey);
            setDocumentStatus(null);
            setRegistrationTxHash(null);
          }}
        />

        {/* Freedom Tool Voting */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Freedom Tool Vote</Text>

          {/* Proposal ID input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Proposal ID</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={proposalId}
                onChangeText={setProposalId}
                keyboardType="numeric"
                placeholder="236"
              />
              <TouchableOpacity
                style={[styles.registerButton, isLoadingProposal && styles.buttonDisabled]}
                onPress={loadProposal}
                disabled={isLoadingProposal}
              >
                {isLoadingProposal ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.registerButtonText}>Load</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Proposal info */}
          {proposalInfo && (
            <>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Title:</Text>
                <Text style={styles.resultValue}>{proposalInfo.title}</Text>
              </View>
              {proposalInfo.description ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Description:</Text>
                  <Text style={styles.resultValue}>{proposalInfo.description}</Text>
                </View>
              ) : null}

              {/* Citizenship whitelist */}
              {(() => {
                const wl = proposalInfo.criteria.citizenshipWhitelist;
                if (wl.length === 0) return (
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Nationalites:</Text>
                    <Text style={styles.resultValue}>Toutes (pas de restriction)</Text>
                  </View>
                );
                const countries = wl.map(decodeCitizenship);
                const fraAllowed = countries.includes("FRA");
                return (
                  <>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>Nationalites autorisees:</Text>
                      <Text style={styles.resultValue}>{countries.join(", ")}</Text>
                    </View>
                    {!fraAllowed && (
                      <View style={[styles.statusBadge, styles.statusError]}>
                        <Text style={styles.statusBadgeText}>
                          France (FRA) non autorisee
                        </Text>
                      </View>
                    )}
                  </>
                );
              })()}

              {/* Eligibility check */}
              {rarimePassportRef.current && privateKey && (
                <TouchableOpacity
                  style={[styles.registerButton, { backgroundColor: "#6366F1" }]}
                  onPress={checkEligibility}
                >
                  <Text style={styles.registerButtonText}>Check Eligibility</Text>
                </TouchableOpacity>
              )}

              {hasVoted === true && (
                <View style={[styles.statusBadge, styles.statusRegisteredOther]}>
                  <Text style={styles.statusBadgeText}>Already voted</Text>
                </View>
              )}

              {isEligible === true && !hasVoted && (
                <View style={[styles.statusBadge, styles.statusRegisteredOwn]}>
                  <Text style={styles.statusBadgeText}>Eligible to vote</Text>
                </View>
              )}

              {isEligible === false && (
                <View style={[styles.statusBadge, styles.statusError]}>
                  <Text style={styles.statusBadgeText}>Not eligible</Text>
                </View>
              )}

              {/* Vote options */}
              {isEligible && !hasVoted && proposalInfo.questions.length > 0 && (
                <>
                  <Text style={styles.sectionSubtitle}>
                    {proposalInfo.questions[0].title}
                  </Text>
                  <View style={{ gap: 8 }}>
                    {proposalInfo.questions[0].variants.map((variant, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={[
                          styles.registerButton,
                          {
                            backgroundColor:
                              selectedAnswer === idx ? "#6366F1" : "#94A3B8",
                          },
                        ]}
                        onPress={() => setSelectedAnswer(idx)}
                      >
                        <Text style={styles.registerButtonText}>{variant}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {selectedAnswer !== null && (
                    <TouchableOpacity
                      style={[
                        styles.scanButton,
                        isSubmittingVote && styles.buttonDisabled,
                      ]}
                      onPress={submitVote}
                      disabled={isSubmittingVote}
                    >
                      {isSubmittingVote ? (
                        <View style={styles.loadingRow}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text style={styles.scanButtonText}>
                            Submitting vote...
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.scanButtonText}>Submit Vote</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Vote TX hash */}
              {voteTxHash && (
                <View style={styles.txHashContainer}>
                  <Text style={styles.resultLabel}>Vote TX Hash:</Text>
                  <Text style={styles.resultValue} selectable>
                    {voteTxHash}
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Vote error */}
          {voteError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{voteError}</Text>
            </View>
          )}
        </View>

        {/* MRZ Input Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Donnees MRZ (au dos de la carte)
          </Text>

          <TouchableOpacity
            style={styles.cameraButton}
            onPress={openMRZScanner}
          >
            <Text style={styles.cameraButtonText}>
              Scanner avec camera
            </Text>
          </TouchableOpacity>

          <Text style={styles.orText}>ou saisir manuellement:</Text>

          {/* Document number */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Numero de document</Text>
            <TextInput
              style={styles.input}
              placeholder="12AB34567"
              placeholderTextColor={colors.textSecondary}
              value={documentNo}
              onChangeText={(t) => setDocumentNo(t.trim().toUpperCase())}
              autoCapitalize="characters"
              editable={!isScanning}
            />
          </View>

          {/* Birth date */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Date de naissance</Text>
            <View style={styles.dateInputRow}>
              <TextInput
                style={[styles.input, styles.dateInput]}
                placeholder="JJ/MM/AA"
                placeholderTextColor={colors.textSecondary}
                value={birthDate}
                onChangeText={(t) => setBirthDate(formatDateInput(t))}
                keyboardType="numeric"
                maxLength={8}
                editable={!isScanning}
              />
              <TouchableOpacity
                style={styles.calendarButton}
                onPress={() => setShowBirthDatePicker(true)}
              >
                <Text style={styles.calendarButtonText}>Cal.</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Expiry date */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Date d'expiration</Text>
            <View style={styles.dateInputRow}>
              <TextInput
                style={[styles.input, styles.dateInput]}
                placeholder="JJ/MM/AA"
                placeholderTextColor={colors.textSecondary}
                value={expiryDate}
                onChangeText={(t) => setExpiryDate(formatDateInput(t))}
                keyboardType="numeric"
                maxLength={8}
                editable={!isScanning}
              />
              <TouchableOpacity
                style={styles.calendarButton}
                onPress={() => setShowExpiryDatePicker(true)}
              >
                <Text style={styles.calendarButtonText}>Cal.</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Date Picker Modals */}
          {Platform.OS === "ios" ? (
            <>
              <Modal
                visible={showBirthDatePicker}
                transparent
                animationType="slide"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>
                        Date de naissance
                      </Text>
                      <TouchableOpacity
                        onPress={() => setShowBirthDatePicker(false)}
                        style={styles.modalCloseButton}
                      >
                        <Text style={styles.modalCloseText}>Fermer</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={birthDateObj}
                      mode="date"
                      display="spinner"
                      onChange={onBirthDateChange}
                      maximumDate={new Date()}
                      style={styles.datePicker}
                      locale="fr-FR"
                      textColor={colors.text}
                      themeVariant="light"
                    />
                  </View>
                </View>
              </Modal>
              <Modal
                visible={showExpiryDatePicker}
                transparent
                animationType="slide"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>
                        Date d'expiration
                      </Text>
                      <TouchableOpacity
                        onPress={() => setShowExpiryDatePicker(false)}
                        style={styles.modalCloseButton}
                      >
                        <Text style={styles.modalCloseText}>Fermer</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={expiryDateObj}
                      mode="date"
                      display="spinner"
                      onChange={onExpiryDateChange}
                      minimumDate={new Date()}
                      style={styles.datePicker}
                      locale="fr-FR"
                      textColor={colors.text}
                      themeVariant="light"
                    />
                  </View>
                </View>
              </Modal>
            </>
          ) : (
            <>
              {showBirthDatePicker && (
                <DateTimePicker
                  value={birthDateObj}
                  mode="date"
                  display="default"
                  onChange={onBirthDateChange}
                  maximumDate={new Date()}
                />
              )}
              {showExpiryDatePicker && (
                <DateTimePicker
                  value={expiryDateObj}
                  mode="date"
                  display="default"
                  onChange={onExpiryDateChange}
                  minimumDate={new Date()}
                />
              )}
            </>
          )}
        </View>

        {/* Scan Button */}
        <TouchableOpacity
          style={[
            styles.scanButton,
            (!documentNo || !birthDate || !expiryDate || isScanning) &&
              styles.buttonDisabled,
          ]}
          onPress={handleScan}
          disabled={!documentNo || !birthDate || !expiryDate || isScanning}
        >
          <Text style={styles.scanButtonText}>
            {isScanning ? "Scan en cours..." : "Scanner la carte NFC"}
          </Text>
        </TouchableOpacity>

        {/* Progress (Android) */}
        {Platform.OS === "android" && isScanning && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${nfcProgress}%` }]}
              />
            </View>
            <Text style={styles.progressText}>{nfcProgress}%</Text>
          </View>
        )}

        {/* Status */}
        {scanStatus ? (
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>{scanStatus}</Text>
          </View>
        ) : null}

        {/* Error */}
        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Erreur:</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Results */}
        {tagData?.personDetails && (
          <View style={styles.resultCard}>
            <Text style={styles.cardTitle}>
              Carte d'identite scannee
            </Text>

            <Text style={styles.sectionSubtitle}>Champs disponibles:</Text>
            <Text style={styles.fieldsListText}>
              {Object.keys(tagData).join(", ")}
            </Text>

            {tagData.personDetails.passportImageRaw && (
              <Image
                source={{
                  uri: `data:image/jpeg;base64,${tagData.personDetails.passportImageRaw}`,
                }}
                style={styles.photo}
                resizeMode="cover"
              />
            )}

            <Text style={styles.sectionSubtitle}>Details personnels:</Text>
            {Object.entries(tagData.personDetails).map(([key, value]) => (
              <View style={styles.resultRow} key={key}>
                <Text style={styles.resultLabel}>{key}:</Text>
                <Text style={styles.resultValue}>
                  {shortenValue(value)}
                </Text>
              </View>
            ))}

            <Text style={styles.sectionSubtitle}>Donnees brutes:</Text>
            {(
              [
                ["SOD", tagData.sodBytes],
                ["DG1", tagData.dg1Bytes],
                ["DG11", tagData.dg11Bytes],
              ] as [string, string | undefined][]
            ).map(([label, val]) => (
              <View style={styles.resultRow} key={label}>
                <Text style={styles.resultLabel}>{label}:</Text>
                <Text style={styles.resultValue}>
                  {getByteLength(val)}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={styles.viewRawButton}
              onPress={() =>
                console.log(
                  "Full data:",
                  JSON.stringify(tagData, null, 2)
                )
              }
            >
              <Text style={styles.viewRawButtonText}>
                Voir donnees brutes (logs)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* NFC Debug Logs */}
        <View style={styles.logsSection}>
          <TouchableOpacity
            style={styles.logsHeader}
            onPress={() => setShowLogs(!showLogs)}
          >
            <Text style={styles.logsTitle}>
              {showLogs ? "\u25BC" : "\u25B6"} NFC Debug Logs (
              {nfcLogs.length})
            </Text>
            <TouchableOpacity
              onPress={() => setNfcLogs([])}
              style={styles.clearLogsButton}
            >
              <Text style={styles.clearLogsText}>Clear</Text>
            </TouchableOpacity>
          </TouchableOpacity>

          {showLogs && (
            <ScrollView
              style={styles.logsContainer}
              nestedScrollEnabled
              contentContainerStyle={styles.logsContentContainer}
            >
              {nfcLogs.length === 0 ? (
                <Text style={styles.logLine}>
                  No logs yet. Start a scan to see NFC debug output.
                </Text>
              ) : (
                nfcLogs.map((log, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.logLine,
                      log.includes("[TX]") && styles.logTx,
                      log.includes("[RX]") && styles.logRx,
                      log.includes("[ERROR]") && styles.logError,
                      log.includes("===") && styles.logHeader,
                    ]}
                  >
                    {log}
                  </Text>
                ))
              )}
            </ScrollView>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: Spacing.screen.top,
      paddingHorizontal: Spacing.screen.horizontal,
      paddingBottom: 16,
      backgroundColor: colors.cardBackground,
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitle: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: 20,
      color: colors.text,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: Spacing.screen.horizontal,
      gap: 16,
    },

    // iOS notice
    iosNotice: {
      backgroundColor: "#DBEAFE",
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: "#3B82F6",
    },
    iosNoticeTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#1E40AF",
      marginBottom: 8,
    },
    iosNoticeText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: "#1E40AF",
      lineHeight: 20,
    },

    // Cards
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      gap: 12,
    },
    cardTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 18,
      color: colors.text,
    },
    sectionSubtitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
    },
    fieldsListText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.textSecondary,
    },

    // Inputs
    inputGroup: {
      gap: 6,
    },
    inputLabel: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
    },
    labelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      fontFamily: Typography.fontFamily.medium,
      color: colors.text,
      backgroundColor: colors.cardBackground,
    },
    inputValid: {
      borderColor: "#10B981",
      borderWidth: 2,
    },
    inputWarning: {
      borderColor: "#F59E0B",
      borderWidth: 2,
    },
    validationIndicator: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 12,
    },
    validationOk: {
      color: "#10B981",
    },
    validationPending: {
      color: "#F59E0B",
    },
    dateInputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    dateInput: {
      flex: 1,
    },
    calendarButton: {
      backgroundColor: colors.primary,
      padding: 12,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 44,
      height: 44,
    },
    calendarButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },
    orText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
    },

    // Camera
    cameraContainer: {
      position: "relative",
      width: "100%",
      height: 400,
      backgroundColor: "#000",
      borderRadius: 12,
      overflow: "hidden",
    },
    camera: {
      width: "100%",
      height: "100%",
    },
    closeCameraButton: {
      position: "absolute",
      top: 16,
      right: 16,
      backgroundColor: "rgba(0,0,0,0.6)",
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
    },
    closeCameraText: {
      color: "#fff",
      fontFamily: Typography.fontFamily.bold,
      fontSize: 14,
    },
    cameraOverlay: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: "rgba(0,0,0,0.6)",
      padding: 16,
    },
    cameraInstructions: {
      color: "#fff",
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      textAlign: "center",
    },
    cameraButton: {
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    cameraButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#FFFFFF",
    },

    // Scan button
    scanButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      padding: 18,
      alignItems: "center",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    scanButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 18,
      color: "#FFFFFF",
    },

    // Progress
    progressContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    progressBar: {
      flex: 1,
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.primary,
    },
    progressText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.text,
      width: 40,
    },

    // Status
    statusContainer: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      alignItems: "center",
    },
    statusText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 16,
      color: colors.text,
    },

    // Error
    errorContainer: {
      backgroundColor: "#FEE2E2",
      borderRadius: 12,
      padding: 16,
    },
    errorTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#DC2626",
      marginBottom: 4,
    },
    errorText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: "#DC2626",
    },

    // Results
    resultCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      gap: 4,
    },
    resultRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    resultLabel: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
      flex: 1,
    },
    resultValue: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
      flex: 2,
      textAlign: "right",
    },
    photo: {
      width: 120,
      height: 150,
      borderRadius: 8,
      alignSelf: "center",
      marginVertical: 12,
    },
    viewRawButton: {
      marginTop: 12,
      backgroundColor: colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center",
    },
    viewRawButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },

    // Rarime status badges
    statusBadge: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    statusNotRegistered: {
      backgroundColor: colors.border,
    },
    statusRegisteredOwn: {
      backgroundColor: "#D1FAE5",
    },
    statusRegisteredOther: {
      backgroundColor: "#FEF3C7",
    },
    statusError: {
      backgroundColor: "#FEE2E2",
    },
    statusBadgeText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    loadingText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
    },
    registerButton: {
      backgroundColor: "#10B981",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center",
    },
    registerButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: "#FFFFFF",
    },
    txHashContainer: {
      backgroundColor: colors.border,
      padding: 12,
      borderRadius: 8,
    },
    resetButton: {
      backgroundColor: colors.border,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
      alignItems: "center",
    },
    resetButtonText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
    },

    // Date picker modal
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.cardBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 40,
      alignItems: "center",
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      width: "100%",
    },
    modalTitle: {
      fontSize: 18,
      fontFamily: Typography.fontFamily.bold,
      color: colors.text,
    },
    modalCloseButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      backgroundColor: colors.primary,
      borderRadius: 8,
    },
    modalCloseText: {
      fontSize: 16,
      fontFamily: Typography.fontFamily.bold,
      color: "#FFFFFF",
    },
    datePicker: {
      width: "100%",
      height: 200,
      alignSelf: "center",
    },

    // NFC Debug Logs
    logsSection: {
      backgroundColor: "#1F2937",
      borderRadius: 12,
      overflow: "hidden",
    },
    logsHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 12,
      backgroundColor: "#374151",
    },
    logsTitle: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: 16,
      color: "#F9FAFB",
    },
    clearLogsButton: {
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: "#4B5563",
      borderRadius: 6,
    },
    clearLogsText: {
      color: "#EF4444",
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
    },
    logsContainer: {
      maxHeight: 300,
    },
    logsContentContainer: {
      padding: 12,
    },
    logLine: {
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      fontSize: 11,
      color: "#D1D5DB",
      marginBottom: 2,
      lineHeight: 16,
    },
    logTx: {
      color: "#60A5FA",
    },
    logRx: {
      color: "#34D399",
    },
    logError: {
      color: "#EF4444",
    },
    logHeader: {
      color: "#FBBF24",
      fontFamily: Typography.fontFamily.bold,
    },
  });
