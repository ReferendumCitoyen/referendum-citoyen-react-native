import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import LottieView from 'lottie-react-native';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { withRetry, formatRpcError } from '@/constants/rarime-config';
import type { ProposalInfo, Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';

interface Step11Props {
  containerWidth: number;
  isActive?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
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
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState('');
  const hasCalledCallback = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  const canSubmitReal = freedomTool && rarime && passport && proposalInfo && answerIndex !== undefined;

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      hasCalledCallback.current = false;
      setStatusText('Préparation...');
    } else if (!isActive && hasStarted) {
      setHasStarted(false);
      hasCalledCallback.current = false;
    }
  }, [isActive, hasStarted]);

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current) return;

    if (!canSubmitReal) {
      hasCalledCallback.current = true;
      setStatusText("Erreur : scannez d'abord votre carte d'identité.");
      onError?.();
      return;
    }

    (async () => {
      try {
        setStatusText('Génération de la preuve ZK...');
        console.log('[FreedomTool] Step11: Submitting vote...');

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
              setStatusText(`Erreur réseau — nouvelle tentative (${attempt}/${max})...`);
            },
          }
        );

        console.log('[FreedomTool] Step11: Vote TX hash:', txHash);
        hasCalledCallback.current = true;
        setStatusText('Vote soumis !');
        onSuccess?.();
      } catch (err) {
        console.error('[FreedomTool] Step11: Vote error:', err);
        hasCalledCallback.current = true;
        setStatusText(formatRpcError(err));
        onError?.();
      }
    })();
  }, [hasStarted, canSubmitReal, freedomTool, rarime, passport, proposalInfo, answerIndex, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
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
