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
        const isAlreadyVoted = err?.message?.includes('already voted');
        const errorMsg = isAlreadyVoted ? t('voting.step9ErrorDescription') : formatRpcError(err);
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
