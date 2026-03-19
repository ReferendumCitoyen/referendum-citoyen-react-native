import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { withRetry, formatRpcError } from '@/constants/rarime-config';
import type { ProposalInfo, Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { Buffer } from 'buffer';

interface Step11Props {
  containerWidth: number;
  isActive?: boolean;
  onSuccess?: () => void;
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

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || isSubmitting.current) return;

    if (!canSubmitReal) {
      hasCalledCallback.current = true;
      setStatusText(t('voting.step11MissingData'));
      onError?.();
      return;
    }

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

        setStatusText(t('voting.step11GeneratingProof'));
        const mrzData = passport.getMRZData();
        const citizenshipHex = BigInt("0x" + Buffer.from(mrzData.issuingCountry).toString("hex")).toString();
        console.log(`[FreedomTool] Step11: Submitting vote...`);
        console.log(`[FreedomTool] Step11: proposal=#${proposalInfo.id} "${proposalInfo.title}"`);
        console.log(`[FreedomTool] Step11: answerIndex=${answerIndex}, variant="${proposalInfo.questions[0]?.variants?.[answerIndex]}"`);
        console.log(`[FreedomTool] Step11: citizenshipMask=${citizenshipHex} (${mrzData.issuingCountry})`);
        console.log(`[FreedomTool] Step11: citizenshipWhitelist=[${proposalInfo.criteria.citizenshipWhitelist.map(String).join(', ')}]`);
        console.log(`[FreedomTool] Step11: selector=${proposalInfo.criteria.selector}, sendVoteContract=${proposalInfo.sendVoteContractAddress}`);

        const txHash = await withRetry(
          () =>
            freedomTool.submitProposal({
              answers: [answerIndex],
              proposalInfo,
              rarime,
              passport,
            }),
          {
            label: 'submitProposal',
            onRetry: (attempt, max) => {
              setStatusText(t('voting.step11NetworkRetry', { attempt, max }));
            },
          }
        );

        console.log('[FreedomTool] Step11: Vote TX hash:', txHash);
        hasCalledCallback.current = true;
        setStatusText(t('voting.step11VoteSubmitted'));
        onSuccess?.();
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
