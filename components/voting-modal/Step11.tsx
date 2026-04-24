import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { formatRpcError } from '@/constants/rarime-config';
import type { ProposalInfo, Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { Buffer } from 'buffer';
import { ensureCircuitsReady } from '@/utils/circuit-preload';

interface Step11Props {
  containerWidth: number;
  isActive?: boolean;
  onSuccess?: (txHash: string) => void;
  onError?: (reason?: string) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  freedomTool?: FreedomTool;
  rarime?: Rarime;
  passport?: RarimePassport;
  proposalInfo?: ProposalInfo;
  answerIndex?: number;
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
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState('');
  const hasCalledCallback = useRef(false);
  const isSubmitting = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  const canSubmitReal = freedomTool && rarime && passport && proposalInfo && answerIndex !== undefined;

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      hasCalledCallback.current = false;
      setStatusText(t('voting.step11Preparing'));
    } else if (!isActive && hasStarted) {
      setHasStarted(false);
      hasCalledCallback.current = false;
      isSubmitting.current = false;
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
      setStatusText(t('voting.step11MissingData'));
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
        // Pre-check: already voted?
        setStatusText(t('voting.step11Preparing'));
        const alreadyVoted = await freedomTool.isAlreadyVoted(proposalInfo, rarime);
        if (alreadyVoted) {
          console.log('[FreedomTool] Step11: Already voted on this proposal');
          hasCalledCallback.current = true;
          setStatusText(t('voting.step9ErrorDescription'));
          onError?.(t('voting.step9ErrorDescription'));
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
          onError?.(msg);
          return;
        }

        setStatusText(t('voting.step11GeneratingProof'));
        const mrzData = passport.getMRZData();
        const citizenshipHex = BigInt("0x" + Buffer.from(mrzData.issuingCountry).toString("hex")).toString();
        console.log(`[FreedomTool] Step11: Submitting vote...`);
        console.log(`[FreedomTool] Step11: proposal=#${proposalInfo.id} "${proposalInfo.title}"`);
        console.log(`[FreedomTool] Step11: answerIndex=${answerIndex}, variant="${proposalInfo.questions[0]?.variants?.[answerIndex]}"`);
        console.log(`[FreedomTool] Step11: citizenshipMask=${citizenshipHex} (${mrzData.issuingCountry})`);
        console.log(`[FreedomTool] Step11: citizenshipWhitelist=[${proposalInfo.criteria.citizenshipWhitelist.map(String).join(', ')}]`);
        console.log(`[FreedomTool] Step11: selector=${proposalInfo.criteria.selector}, sendVoteContract=${proposalInfo.sendVoteContractAddress}`);

        // Pre-flight eligibility via the SDK's own check. This looks at voting
        // period and already-voted — it does NOT compare passport.issueTimestamp
        // to criteria.timestampUpperbound, because the SDK's buildQueryProofParams
        // deliberately bypasses that bound (UINT64_MAX-1) for recently re-registered
        // identities so they can still vote on open proposals.
        try {
          await freedomTool.verify(proposalInfo, passport, rarime);
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
        const txHash = await freedomTool.submitProposal({
          answers: [answerIndex],
          proposalInfo,
          rarime,
          passport,
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
          errorMsg = t('voting.step9ErrorDescription');
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
          msg.includes('0xd71fd263') ||
          msg.includes('PAIRING_FAILED') ||
          msg.toLowerCase().includes('pairing_failed')
        ) {
          errorMsg = t('voting.step11ProverIncompatible');
        } else {
          errorMsg = formatRpcError(err);
        }
        setStatusText(errorMsg);
        onError?.(errorMsg);
      }
    })();
  }, [hasStarted, canSubmitReal, freedomTool, rarime, passport, proposalInfo, answerIndex, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth, height: '100%' }]} onLayout={onLayout}>
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
