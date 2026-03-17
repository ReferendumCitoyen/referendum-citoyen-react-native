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
    if (!mrzData) {
      setScanStatus(t('voting.step6MissingMrz'));
      return;
    }

    // Scan NFC on the same screen for both platforms
    try {
      setIsScanning(true);
      setScanStatus(t('voting.step6Init'));

      const eDocModule = await import('@/modules/e-document');
      const { scanDocument } = eDocModule;

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));

      // Small delay on Android to ensure NFC is ready
      if (Platform.OS === 'android') {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setScanStatus(t('voting.step6Now'));

      // Add timeout for Android NFC (30 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('NFC scan timeout - aucune carte détectée')), 30000);
      });

      const scanPromise = scanDocument('I', {
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      }, challenge);

      const result = await Promise.race([scanPromise, timeoutPromise]);

      setScanStatus(t('voting.step6ReadSuccess'));
      setIsScanning(false);

      // Proceed to next step on success
      if (onNFCSuccess) {
        setTimeout(() => {
          onNFCSuccess(result);
        }, 500);
      }
    } catch (error: any) {
      // If it's an invalid MRZ key error, go back to camera step
      if (error.message === 'InvalidMRZKey' || error.code === 'InvalidMRZKey') {
        setScanStatus(t('voting.step6InvalidMrz'));
        setIsScanning(false);

        if (onGoBack) {
          setTimeout(() => {
            onGoBack();
          }, 1500);
        }
        return;
      }

      // For other errors, show message and let user retry
      setScanStatus(
        t('voting.step6ErrorWithMessage', {
          message: error.message || error.code || t('voting.step6ReadError'),
        })
      );
      setIsScanning(false);
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
            onPress={handleAnalyzePress}
            disabled={isScanning}
          >
            <Text style={stepSpecificStyles.step6ButtonText}>
              {isScanning ? t('voting.step6Scanning') : t('common.analyze')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Step6;
