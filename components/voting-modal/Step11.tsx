import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent, Dimensions } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { formatRpcError, type Network } from '@/constants/rarime-config';
import type { ProposalInfo, Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { Buffer } from 'buffer';
import { ensureCircuitsReady } from '@/utils/circuit-preload';
import { castMainnetVote } from '@/utils/mainnet-vote-flow';
import { getOrCreatePrivateKey } from '@/utils/identity';

// voting-flow's sliding container chain has no defined height on iOS
// (flex: undefined in styles.ts) so `height: '100%'` on a slide collapses
// to 0 — the LottieView spinner and status text end up stacked around y=0.
// Use a concrete minHeight on both platforms instead.
const SLIDE_MIN_HEIGHT = Math.round(Dimensions.get('window').height * 0.75);

interface Step11Props {
  containerWidth: number;
  isActive?: boolean;
  onSuccess?: (txHash: string) => void;
  onError?: (reason?: string, error?: unknown) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  freedomTool?: FreedomTool;
  rarime?: Rarime;
  passport?: RarimePassport;
  proposalInfo?: ProposalInfo;
  answerIndex?: number;
  /** Active network from NetworkContext. The vote path is picked by both
   * network *and* document type (confirmed with Rarimo team 2026-05-21):
   *
   *   TD3 (passport) + mainnet → Groth16 pipeline (utils/mainnet-vote-flow.ts).
   *     The deployed BioPassportVoting (0x8Dea…) is Groth16; the SDK's
   *     Noir path doesn't match its ABI.
   *
   *   everything else → freedomTool.submitProposal(). The SDK auto-routes
   *     via `proposalInfo.sendVoteContractAddress` to IDCardVoting/
   *     executeTD1Noir (TD1) or BioPassportVoting/executeNoir (TD3 testnet),
   *     and posts to the v3 vote relayer. Base URLs come from the network-
   *     specific FreedomTool config so the same call works on both networks.
   */
  network?: Network;
}

const Step11: React.FC<Step11Props> = ({
  containerWidth,
  isActive,
  onSuccess,
  onError,
  onLayout,
  freedomTool,
  rarime,
  passport,
  proposalInfo,
  answerIndex,
  network = 'testnet',
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState('');
  const hasCalledCallback = useRef(false);
  const isSubmitting = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  // The Groth16 mainnet path (TD3 only) bypasses the SDK entirely; every
  // other path needs freedomTool. Default isTd3=false until passport loads
  // so we don't drop the freedomTool requirement prematurely.
  const isTd3Doc = !!passport && passport.dataGroup1.length === 93;
  // Used to suffix doc-type-aware translation keys (step11MissingData,
  // step9ErrorDescription). When `passport` hasn't loaded yet, fall back to
  // the ID-card variant — the strings only show up after the user has
  // entered Step 11 so passport is virtually always populated by then.
  const docSfx = isTd3Doc ? 'passport' : 'idCard';
  const usesGroth16MainnetPath = network === 'mainnet' && isTd3Doc;
  const canSubmitReal = usesGroth16MainnetPath
    ? rarime && passport && proposalInfo && answerIndex !== undefined
    : freedomTool && rarime && passport && proposalInfo && answerIndex !== undefined;

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      hasCalledCallback.current = false;
      isSubmitting.current = false;
      setStatusText(t('voting.step11Preparing'));
    } else if (!isActive && hasStarted) {
      // Same race as Step 7 — see that file's comment. Don't clear the
      // ref guards on deactivation; the submit effect would otherwise re-fire
      // in the same commit and trigger a duplicate vote-submit.
      setHasStarted(false);
    }
  }, [isActive, hasStarted]);

  // Fallback: if the required refs somehow never arrive, fail after a
  // generous timeout instead of waiting forever.
  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current) return;
    if (canSubmitReal) return;
    const timer = setTimeout(() => {
      if (hasCalledCallback.current || canSubmitReal) return;
      hasCalledCallback.current = true;
      setStatusText(t(`voting.step11MissingData_${docSfx}`));
      onError?.();
    }, 15000);
    return () => clearTimeout(timer);
  }, [hasStarted, canSubmitReal, onError, t]);

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || isSubmitting.current) return;

    // Same wait pattern as Step 7: refs may be populated asynchronously by
    // voting-flow's init. Only hard-fail with "missing data" if they never
    // arrive (see timeout below).
    if (!canSubmitReal) return;

    isSubmitting.current = true;
    (async () => {
      try {
        // ----------------------------------------------------------------
        // Vote-path routing (by network + doc type, see props comment):
        //
        //   TD3 + mainnet  → castMainnetVote() Groth16 against
        //                    BioPassportVoting (this branch).
        //
        //   everything else → freedomTool.submitProposal() Noir, SDK auto-
        //                    routes destination per proposal.sendVoteContract
        //                    (the testnet branch below). Covers TD1 on both
        //                    networks + TD3 testnet.
        // ----------------------------------------------------------------
        if (usesGroth16MainnetPath) {
          // `canSubmitReal` already validated these are defined on Mainnet
          // (rarime + passport + proposalInfo + answerIndex). Non-null
          // assertions here are safe.
          const p = passport!;
          const proposal = proposalInfo!;
          const ai = answerIndex!;

          setStatusText(t('voting.step11Preparing'));
          const mrzData = p.getMRZData();
          const sk = await getOrCreatePrivateKey();
          const passportHashBig = p.getPassportHash();
          // RarimeUtils.getProfileKey returns the 64-char hex profile key
          // (Poseidon of the BJJ pubpoint). We import it lazily to avoid
          // pulling the SDK into the module evaluation cost on testnet.
          const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
          const profileKeyHex = RarimeUtils.getProfileKey(sk);

          // answerIndex omitted — anonymous vote (see Step9Vote comment).
          console.log(`[Step11][mainnet] casting vote on proposal #${proposal.id}`);
          setStatusText(t('voting.step11GeneratingProof'));

          const { txId } = await castMainnetVote({
            dg1: new Uint8Array(p.dataGroup1),
            bjjPrivateKeyHex: sk,
            passportHash: passportHashBig,
            profileKey: '0x' + profileKeyHex,
            proposalId: Number(proposal.id),
            citizenship: mrzData.issuingCountry,
            voteIndices: [ai],
            // On first vote ever, the 757 MB zkey download dominates. Surface
            // progress through the status line so the user isn't staring at
            // a silent spinner for many minutes.
            onZkeyProgress: (p) => {
              if (p.totalBytesExpectedToWrite > 0) {
                const pct = Math.round(
                  (p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100,
                );
                setStatusText(t('voting.step11DownloadingData', { percent: pct }));
              }
            },
          });
          console.log('[Step11][mainnet] vote tx id:', txId);
          hasCalledCallback.current = true;
          setStatusText(t('voting.step11VoteSubmitted'));
          onSuccess?.(txId);
          return;
        }

        // ----------------------------------------------------------------
        // SDK Noir flow (freedomTool.submitProposal). Covers everything
        // except TD3-on-mainnet: TD1 testnet, TD1 mainnet, TD3 testnet.
        // The SDK reads proposalInfo.sendVoteContractAddress to pick the
        // right destination (IDCardVoting vs BioPassportVoting) and
        // selects executeTD1Noir vs executeNoir per doc type internally.
        // ----------------------------------------------------------------
        const ft = freedomTool!;
        const r = rarime!;
        const p = passport!;
        const proposal = proposalInfo!;
        const ai = answerIndex!;
        // Pre-check: already voted?
        setStatusText(t('voting.step11Preparing'));
        const alreadyVoted = await ft.isAlreadyVoted(proposal, r);
        if (alreadyVoted) {
          console.log('[FreedomTool] Step11: Already voted on this proposal');
          hasCalledCallback.current = true;
          setStatusText(t(`voting.step9ErrorDescription_${docSfx}`));
          onError?.(t(`voting.step9ErrorDescription_${docSfx}`));
          return;
        }

        // Make sure the Noir trusted setup + circuit bytecode are on disk
        // before calling submitProposal. Normally preloaded on the home
        // screen, but surface progress here as a fallback so the user
        // isn't staring at a silent spinner for several minutes.
        try {
          await ensureCircuitsReady((p) => {
            if (p.stage === 'trusted-setup' || p.stage === 'bytecode') {
              const percent = Math.max(0, Math.min(100, Math.round(p.overallPercent * 100)));
              setStatusText(t('voting.step11DownloadingData', { percent }));
            } else if (p.stage === 'checking') {
              setStatusText(t('voting.step11FinalizingData'));
            }
          });
        } catch (dlErr: any) {
          console.error('[FreedomTool] Step11: Circuit preload failed:', dlErr);
          hasCalledCallback.current = true;
          const msg = t('voting.step11DownloadFailed');
          setStatusText(msg);
          onError?.(msg, dlErr);
          return;
        }

        setStatusText(t('voting.step11GeneratingProof'));
        const mrzData = p.getMRZData();
        const citizenshipHex = BigInt("0x" + Buffer.from(mrzData.issuingCountry).toString("hex")).toString();
        console.log(`[FreedomTool] Step11: Submitting vote...`);
        console.log(`[FreedomTool] Step11: proposal=#${proposal.id} "${proposal.title}"`);
        // answerIndex / variant intentionally NOT logged — anonymous vote.
        // SECURITY: `issuingCountry` is a 3-letter country code (too short
        // for the digit-length filter); the redaction labels catch
        // `citizenship` but the trailing `(FRA)` in parens would still
        // leak the country. Gate the per-user nationality dump out of
        // release builds entirely. The citizenshipWhitelist + selector +
        // sendVoteContract are properties of the proposal, not the
        // voter, and are safe to keep.
        if (__DEV__) {
          console.log(`[FreedomTool] Step11: citizenshipMask=${citizenshipHex} (${mrzData.issuingCountry})`);
        }
        console.log(`[FreedomTool] Step11: citizenshipWhitelist=[${proposal.criteria.citizenshipWhitelist.map(String).join(', ')}]`);
        console.log(`[FreedomTool] Step11: selector=${proposal.criteria.selector}, sendVoteContract=${proposal.sendVoteContractAddress}`);

        // Pre-flight eligibility via the SDK's own check. This looks at voting
        // period and already-voted — it does NOT compare passport.issueTimestamp
        // to criteria.timestampUpperbound, because the SDK's buildQueryProofParams
        // deliberately bypasses that bound (UINT64_MAX-1) for recently re-registered
        // identities so they can still vote on open proposals.
        try {
          await ft.verify(proposal, p, r);
        } catch (vErr: any) {
          console.warn('[Step11] SDK verify() rejected:', vErr?.message);
          throw vErr;
        }

        // No withRetry here on purpose: submitProposal runs the full ~3–5 min
        // proof generation. Retrying a failure re-runs the whole thing and on
        // Android tends to leave the HTTP stack in a worse state (see logs
        // showing JsonRpcProvider "failed to detect network" after repeated
        // FileSystemLegacyModule aborts). Surface the error; let the user
        // retry from a clean slate.
        const txHash = await ft.submitProposal({
          answers: [ai],
          proposalInfo: proposal,
          rarime: r,
          passport: p,
        });

        console.log('[FreedomTool] Step11: Vote TX hash:', txHash);
        hasCalledCallback.current = true;
        setStatusText(t('voting.step11VoteSubmitted'));
        onSuccess?.(txHash);
      } catch (err: any) {
        console.error('[FreedomTool] Step11: Vote error:', err);
        console.error('[FreedomTool] Step11: Error details:', JSON.stringify({ message: err?.message, code: err?.code, data: err?.data, status: err?.status }, null, 2));
        hasCalledCallback.current = true;
        const msg = err?.message || '';
        let errorMsg: string;
        // Messages thrown by freedomTool.verify()
        if (msg.includes('already voted') || msg.includes('User has already voted')) {
          errorMsg = t(`voting.step9ErrorDescription_${docSfx}`);
        } else if (msg.startsWith('[VOTE_INELIGIBLE]')) {
          // mainnet-vote-flow.ts uses this prefix when it can identify which
          // circuit constraint failed (e.g., passport expired vs the proposal's
          // expirationDateLowerbound). The message after the prefix is already
          // user-facing French — strip the marker and display verbatim.
          errorMsg = msg.replace('[VOTE_INELIGIBLE]', '').trim();
        } else if (msg.includes('Voting has not started')) {
          errorMsg = t('voting.step11VotingNotStarted');
        } else if (msg.includes('Voting has ended')) {
          errorMsg = t('voting.step11VotingEnded');
        } else if (
          // 0xd71fd263 = PAIRING_FAILED from BaseUltraVerifier. The on-chain
          // pairing check rejected the Noir proof. Known Android-only issue:
          // the bundled noir.aar prover produces proofs that don't match the
          // deployed verifier. Not recoverable from the app layer — surface
          // a precise error so the user can report it.
          //
          // The SDK does a local static-call first (logs "0xd71fd263"
          // explicitly) but still POSTs to the relayer, which 400s with
          // "execution reverted" / "failed to estimate gas". By the time
          // the error reaches us, the selector has been laundered into the
          // relayer's HTTP body, so we also match that wording — an Android
          // build that survives `verify()` but fails `eth_estimateGas` is
          // virtually always the same prover/verifier mismatch.
          msg.includes('0xd71fd263') ||
          msg.includes('PAIRING_FAILED') ||
          msg.toLowerCase().includes('pairing_failed') ||
          (msg.includes('execution reverted') && msg.includes('failed to estimate gas'))
        ) {
          errorMsg = t('voting.step11ProverIncompatible');
        } else {
          errorMsg = formatRpcError(err);
        }
        setStatusText(errorMsg);
        onError?.(errorMsg, err);
      }
    })();
  }, [hasStarted, canSubmitReal, freedomTool, rarime, passport, proposalInfo, answerIndex, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth, minHeight: SLIDE_MIN_HEIGHT }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step11Container}>
        <LottieView
          source={require('@/assets/animations/loading.json')}
          style={stepSpecificStyles.step11Loading}
          autoPlay
          loop
        />

        <Text style={{
          fontFamily: Typography.fontFamily.medium,
          fontWeight: Typography.fontWeight.medium,
          fontSize: Typography.fontSize.small,
          color: colors.text,
        }}>
          {statusText}
        </Text>
      </View>
    </View>
  );
};

export default Step11;
