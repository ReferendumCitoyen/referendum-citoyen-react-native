import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image, ScrollView } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors, Typography } from '@/constants/theme';
import { getRandomValues } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useDevMode } from '@/contexts/DevModeContext';

interface Step6Props {
  containerWidth: number;
  player: any;
  mrzData?: {
    documentNumber: string;
    birthDate: string;
    expiryDate: string;
  } | null;
  onAnalyze?: () => void;
  onNFCSuccess?: (data: any) => void;
  onNFCError?: () => void;
  onGoBack?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

const Step6: React.FC<Step6Props> = ({ containerWidth, player, mrzData, onAnalyze, onNFCSuccess, onNFCError, onGoBack, onLayout }) => {
  const { t } = useTranslation();
  const { devMode } = useDevMode();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [scanStep, setScanStep] = useState(0);
  const [showRetry, setShowRetry] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [nativeLogs, setNativeLogs] = useState<string[]>([]);

  // Android camera2 teardown (from Step 5) can take 2-3s and shares NFC-controller
  // resources on some SoCs. Track when Step 6 mounted so we can enforce a minimum
  // gap before the NFC scan starts — prevents "Tag was lost" on the first APDU.
  const mountedAtRef = useRef<number>(Date.now());
  useEffect(() => { mountedAtRef.current = Date.now(); }, []);

  // Listen to EDocument scan events
  useEffect(() => {
    let listeners: any[] = [];

    const setupEventListeners = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import('@/modules/e-document');

        listeners = [
          EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
            setScanStatus(t('voting.step6PresentCard'));
            setScanStep(1);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus(t('voting.step6Authenticating'));
            setScanStep(2);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus(t('voting.step6Reading'));
            setScanStep(3);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus(t('voting.step6ActiveAuth'));
            setScanStep(3);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus(t('voting.step6ReadSuccess'));
            setScanStep(4);
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus(t('voting.step6ReadError'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.DebugLog, (event: unknown) => {
            const { message } = event as { message: string };
            console.log('[Step6/Native]', message);
            setNativeLogs((prev) => [...prev.slice(-40), message]);
          }),
        ];
      } catch (_error) {
        // Event listeners not available
      }
    };

    setupEventListeners();

    return () => {
      listeners.forEach(listener => {
        try {
          listener.remove();
        } catch (error) {
          // Ignore cleanup errors
        }
      });
    };
  }, []);

  const handleAnalyzePress = async () => {
    console.log('[Step6] handleAnalyzePress called, mrzData:', JSON.stringify(mrzData));
    if (!mrzData) {
      setScanStatus(t('voting.step6MissingMrz'));
      return;
    }

    // Scan NFC on the same screen for both platforms
    try {
      setIsScanning(true);
      setScanStatus(t('voting.step6Init'));
      setNativeLogs([]);

      console.log('[Step6] Importing e-document module...');
      const eDocModule = await import('@/modules/e-document');
      const { scanDocument } = eDocModule;
      console.log('[Step6] scanDocument imported, type:', typeof scanDocument);

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));
      console.log('[Step6] Challenge generated, length:', challenge.length);

      // On Android, ensure at least 5s have elapsed since Step 6 mounted so the
      // camera2 session from Step 5 is fully torn down before NFC starts. On
      // some SoCs the NFC controller and camera DSP share resources; tapping
      // Analyze too quickly results in "Tag was lost" on the first APDU.
      if (Platform.OS === 'android') {
        const MIN_GAP_MS = 5000;
        const elapsed = Date.now() - mountedAtRef.current;
        const wait = Math.max(0, MIN_GAP_MS - elapsed);
        if (wait > 0) {
          setScanStatus(t('voting.step6Init'));
          await new Promise(resolve => setTimeout(resolve, wait));
        }
      }

      setScanStatus(t('voting.step6Now'));
      console.log('[Step6] Starting scanDocument with:', {
        type: 'I',
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('NFC scan timeout')), 30000);
      });

      const scanPromise = scanDocument('I', {
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      }, challenge);

      // Clear the timeout as soon as the scan settles (success or error) so the
      // two outcomes can never be shown simultaneously.
      const result = await Promise.race([scanPromise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
      });
      console.log('[Step6] Scan result received, keys:', Object.keys(result as any));

      setScanStatus(t('voting.step6ReadSuccess'));
      setIsScanning(false);
      setShowRetry(false);

      if (onNFCSuccess) {
        setTimeout(() => { onNFCSuccess(result); }, 500);
      }
    } catch (error: any) {
      console.error('[Step6] NFC scan error:', error);
      const errorDetails = JSON.stringify({ message: error.message, code: error.code, name: error.name, stack: error.stack?.substring(0, 300) });
      console.error('[Step6] Error details:', errorDetails);
      setDebugError(`${error.name || 'Error'}: ${error.message || 'unknown'}\n\nCode: ${error.code || 'none'}\n\nInfo: ${JSON.stringify(error.userInfo || error.nativeError || {})}\n\nStack: ${error.stack?.substring(0, 200) || 'none'}`);

      if (error.message === 'InvalidMRZKey' || error.code === 'InvalidMRZKey') {
        setScanStatus(t('voting.step6InvalidMrz'));
        setIsScanning(false);
        if (onGoBack) { setTimeout(() => { onGoBack(); }, 1500); }
        return;
      }

      setScanStatus(
        t('voting.step6ErrorWithMessage', {
          message: error.message || error.code || t('voting.step6ReadError'),
        })
      );
      setIsScanning(false);
      setShowRetry(true);
    }
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step6Container}>
        <Text style={stepSpecificStyles.step6Title}>{t('voting.step6Title')}</Text>

        <View style={stepSpecificStyles.step6ImageContainer}>
          {Platform.OS === 'android' ? (
            <Image
              source={require('@/assets/images/poster-phone-over-card.png')}
              style={stepSpecificStyles.step6Image}
              resizeMode="contain"
            />
          ) : (
            <VideoView
              style={stepSpecificStyles.step6Image}
              player={player}
              contentFit="contain"
              nativeControls={false}
              surfaceType="textureView"
            />
          )}
        </View>

        <Text style={{
          textAlign: 'center',
          marginTop: 12,
          marginBottom: 4,
          marginHorizontal: 16,
          fontSize: 14,
          color: colors.textSecondary || colors.text,
          opacity: 0.7,
        }}>
          {t('voting.step6Instruction')}
        </Text>

        {scanStatus && (
          <Text style={{
            textAlign: 'center',
            marginVertical: 8,
            fontSize: 14,
            color: scanStatus.includes('❌') ? colors.errorText : scanStatus.includes('✅') ? colors.successText : colors.text
          }}>
            {scanStatus}
          </Text>
        )}

        {isScanning && (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            {[1, 2, 3, 4].map((step) => (
              <View
                key={step}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: scanStep >= step ? colors.successText : colors.border,
                }}
              />
            ))}
          </View>
        )}

        {devMode && debugError && (
          <View style={{
            backgroundColor: colors.errorBackground,
            borderRadius: 8,
            padding: 10,
            marginHorizontal: 16,
            marginBottom: 8,
          }}>
            <Text selectable style={{
              fontFamily: Typography.fontFamily.mono,
              fontSize: 10,
              color: colors.errorText,
            }}>
              {debugError}
            </Text>
          </View>
        )}

        {devMode && nativeLogs.length > 0 && (
          <View style={{
            backgroundColor: colors.errorBackground,
            borderRadius: 8,
            padding: 10,
            marginHorizontal: 16,
            marginBottom: 8,
            maxHeight: 180,
          }}>
            <ScrollView>
              <Text selectable style={{
                fontFamily: Typography.fontFamily.mono,
                fontSize: 10,
                color: colors.errorText,
              }}>
                {nativeLogs.join('\n')}
              </Text>
            </ScrollView>
          </View>
        )}

        <View style={stepSpecificStyles.step6ButtonContainer}>
          <TouchableOpacity
            style={[stepSpecificStyles.step6Button, isScanning && { opacity: 0.5 }]}
            activeOpacity={0.8}
            onPress={() => { setShowRetry(false); setDebugError(null); setScanStep(0); setScanStatus(''); handleAnalyzePress(); }}
            disabled={isScanning}
          >
            <Text style={stepSpecificStyles.step6ButtonText}>
              {isScanning ? t('voting.step6Scanning') : showRetry ? t('common.retry') : t('common.analyze')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Step6;
