import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { getRandomValues } from 'expo-crypto';
import { useTranslation } from 'react-i18next';

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
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [showRetry, setShowRetry] = useState(false);

  // Listen to EDocument scan events
  useEffect(() => {
    let listeners: any[] = [];

    const setupEventListeners = async () => {
      try {
        const { EDocumentModuleListener, EDocumentModuleEvents } = await import('@/modules/e-document');

        listeners = [
          EDocumentModuleListener(EDocumentModuleEvents.RequestPresentPassport, () => {
            setScanStatus(t('voting.step6PresentCard'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus(t('voting.step6Authenticating'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus(t('voting.step6Reading'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus(t('voting.step6ActiveAuth'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus(t('voting.step6ReadSuccess'));
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus(t('voting.step6ReadError'));
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

      console.log('[Step6] Importing e-document module...');
      const eDocModule = await import('@/modules/e-document');
      const { scanDocument } = eDocModule;
      console.log('[Step6] scanDocument imported, type:', typeof scanDocument);

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));
      console.log('[Step6] Challenge generated, length:', challenge.length);

      // Small delay on Android to ensure NFC is ready
      if (Platform.OS === 'android') {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setScanStatus(t('voting.step6Now'));
      console.log('[Step6] Starting scanDocument with:', {
        type: 'I',
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('NFC scan timeout')), 30000);
      });

      const scanPromise = scanDocument('I', {
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      }, challenge);

      const result = await Promise.race([scanPromise, timeoutPromise]);
      console.log('[Step6] Scan result received, keys:', Object.keys(result as any));

      setScanStatus(t('voting.step6ReadSuccess'));
      setIsScanning(false);
      setShowRetry(false);

      if (onNFCSuccess) {
        setTimeout(() => { onNFCSuccess(result); }, 500);
      }
    } catch (error: any) {
      console.error('[Step6] NFC scan error:', error);
      console.error('[Step6] Error details:', JSON.stringify({ message: error.message, code: error.code, name: error.name, stack: error.stack?.substring(0, 300) }));

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
            color: scanStatus.includes('❌') ? '#DC2626' : scanStatus.includes('✅') ? '#059669' : colors.text
          }}>
            {scanStatus}
          </Text>
        )}

        <View style={stepSpecificStyles.step6ButtonContainer}>
          <TouchableOpacity
            style={[stepSpecificStyles.step6Button, isScanning && { opacity: 0.5 }]}
            activeOpacity={0.8}
            onPress={() => { setShowRetry(false); handleAnalyzePress(); }}
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
