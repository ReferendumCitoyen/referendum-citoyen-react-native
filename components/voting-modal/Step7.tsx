import React, { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutChangeEvent, Platform, Image, TouchableOpacity } from 'react-native';
import { VideoView } from 'expo-video';
import { createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { withRetry, formatRpcError } from '@/constants/rarime-config';
import type { Rarime, RarimePassport, FreedomTool } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';

interface NFCPersonDetails {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationality?: string;
  documentNumber?: string;
  dateOfExpiry?: string;
}

interface NFCData {
  personDetails?: NFCPersonDetails;
  dg1Bytes?: string;
  sodBytes?: string;
  dg15Bytes?: string;
  aaSignature?: string;
}

interface Step7Props {
  containerWidth: number;
  player: any;
  isActive?: boolean;
  nfcData?: NFCData | null;
  onSuccess?: () => void;
  onError?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  rarime?: Rarime;
  passport?: RarimePassport;
  freedomTool?: FreedomTool;
}

const Step7: React.FC<Step7Props> = ({
  containerWidth,
  player,
  isActive,
  nfcData,
  onSuccess,
  onError,
  onLayout,
  rarime,
  passport,
  freedomTool,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [statusText, setStatusText] = useState(t('voting.step7Verifying'));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasCalledCallback = useRef(false);
  const isVerifying = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      hasCalledCallback.current = false;
      isVerifying.current = false;
      setStatusText(t('voting.step7Verifying'));
      setErrorMessage(null);
    } else if (!isActive && hasStarted) {
      setHasStarted(false);
      hasCalledCallback.current = false;
      isVerifying.current = false;
    }
  }, [isActive, hasStarted]);

  // Fallback: if rarime/passport genuinely never arrive (init threw), don't
  // wait forever — surface a real error after a generous timeout.
  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current) return;
    if (rarime && passport) return;
    const timer = setTimeout(() => {
      if (hasCalledCallback.current) return;
      if (rarime && passport) return;
      hasCalledCallback.current = true;
      setErrorMessage(t('voting.step7MissingData'));
      onError?.();
    }, 15000);
    return () => clearTimeout(timer);
  }, [hasStarted, rarime, passport, onError, t]);

  useEffect(() => {
    if (!hasStarted || hasCalledCallback.current || isVerifying.current) return;

    // rarime + passport are populated asynchronously in voting-flow's init
    // effect (SDK import + Rarime native warmup). On the first pass they're
    // still undefined — wait rather than bailing. The effect re-runs when
    // they become defined. A separate timeout below surfaces a real error
    // if init genuinely fails.
    if (!rarime || !passport) return;

    isVerifying.current = true;
    (async () => {
      try {
        // Step 1: Check document registration status
        const mrzInfo = passport.getMRZData();
        console.log(`[Step7] Passport MRZ — nationality: ${mrzInfo.issuingCountry}, docNo: ${mrzInfo.documentNumber}, birthDate: ${mrzInfo.birthDate}`);
        setStatusText(t('voting.step7CheckingStatus'));
        const status = await withRetry(
          () => rarime.getDocumentStatus(passport),
          { label: 'getDocumentStatus' }
        );
        console.log('[Step7] Document status:', status);

        // Step 2: Register identity if not already registered
        const { DocumentStatus } = await import('@rarimo/rarime-rn-sdk');
        if (status === DocumentStatus.NotRegistered) {
          setStatusText(t('voting.step7Registering'));
          await withRetry(
            () => rarime.registerIdentity(passport),
            { label: 'registerIdentity' }
          );
          console.log('[Step7] Identity registered');
        }

        hasCalledCallback.current = true;
        console.log('[Step7] Verification complete — calling onSuccess');
        setStatusText(t('voting.step7Verified'));
        onSuccess?.();
      } catch (err) {
        console.error('[Step7] Verification error:', err);
        hasCalledCallback.current = true;
        setErrorMessage(formatRpcError(err));
        onError?.();
      }
    })();
  }, [hasStarted, rarime, passport, freedomTool, onSuccess, onError]);

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step7Container}>
        <Text style={stepSpecificStyles.step7Title}>{t('voting.step7Title')}</Text>

        {Platform.OS === 'android' ? (
          <Image
            source={require('@/assets/images/poster-verify.png')}
            style={stepSpecificStyles.step7Image}
            resizeMode="contain"
          />
        ) : (
          <VideoView
            style={stepSpecificStyles.step7Image}
            player={player}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}

        <Text style={stepSpecificStyles.step7Description}>
          {errorMessage || statusText}
        </Text>

        {nfcData?.personDetails && (
          <View style={{ marginTop: 16, padding: 16, backgroundColor: colors.white, borderRadius: 8 }}>
            <Text style={{
              fontFamily: Typography.fontFamily.semibold,
              fontSize: Typography.fontSize.body,
              color: colors.text,
              marginBottom: 8,
            }}>
              {`${nfcData.personDetails.firstName || ''} ${nfcData.personDetails.lastName || ''}`.trim() || t('voting.step7NameUnavailable')}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.text,
              opacity: 0.7,
            }}>
              {t('voting.step7BornOn', {
                date: nfcData.personDetails.dateOfBirth
                  ? `${nfcData.personDetails.dateOfBirth.slice(4, 6)}/${nfcData.personDetails.dateOfBirth.slice(2, 4)}/${nfcData.personDetails.dateOfBirth.slice(0, 2) >= '50' ? '19' : '20'}${nfcData.personDetails.dateOfBirth.slice(0, 2)}`
                  : 'N/A',
              })}
            </Text>
            <Text style={{
              fontFamily: Typography.fontFamily.medium,
              fontSize: Typography.fontSize.small,
              color: colors.text,
              opacity: 0.7,
            }}>
              {t('voting.step7Nationality', { value: nfcData.personDetails.nationality || 'N/A' })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

export default Step7;
