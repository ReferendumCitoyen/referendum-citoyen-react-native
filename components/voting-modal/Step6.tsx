import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, Platform, Image } from 'react-native';
import { VideoView } from 'expo-video';
import { createModalStyles, createStepSpecificStyles } from './styles';
import { useColors } from '@/constants/theme';
import { getRandomValues } from 'expo-crypto';

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
            setScanStatus("📱 Approchez votre carte d'identité du téléphone");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.AuthenticatingWithPassport, () => {
            setScanStatus("🔐 Authentification...");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ReadingDataGroupProgress, () => {
            setScanStatus("📖 Lecture des données...");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ActiveAuthentication, () => {
            setScanStatus("✅ Authentification active...");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.SuccessfulRead, () => {
            setScanStatus("✅ Lecture réussie !");
          }),
          EDocumentModuleListener(EDocumentModuleEvents.ScanError, () => {
            setScanStatus("❌ Erreur de lecture");
          }),
        ];
      } catch (error) {
        console.warn("Failed to setup event listeners:", error);
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
      console.error("❌ No MRZ data available for NFC scan");
      setScanStatus("❌ Données MRZ manquantes. Scannez d'abord le MRZ.");
      return;
    }

    try {
      setIsScanning(true);
      setScanStatus("🔄 Initialisation...");

      console.log("=== STARTING NFC SCAN IN VOTING MODAL ===");
      console.log("MRZ Data:", mrzData);

      const { scanDocument } = await import('@/modules/e-document');

      // Generate random challenge for Active Authentication
      const challenge = getRandomValues(new Uint8Array(32));

      const result = await scanDocument('P', {
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      }, challenge);

      console.log("=== NFC SCAN SUCCESS ===");
      const pd = result.personDetails || {};
      console.log(`${pd.firstName} ${pd.lastName} | ${pd.birthDate} | ${pd.nationality}`);
      console.log("=====================");

      setScanStatus("✅ Scan terminé !");
      setIsScanning(false);

      // Proceed to next step on success
      if (onNFCSuccess) {
        setTimeout(() => {
          onNFCSuccess(result);
        }, 500);
      }
    } catch (error: any) {
      console.error("❌ NFC Scan error:", error);

      // If it's an invalid MRZ key error, go back to camera step
      if (error.message === 'InvalidMRZKey' || error.code === 'InvalidMRZKey') {
        setScanStatus("❌ Données MRZ invalides. Retour au scanner...");
        setIsScanning(false);

        if (onGoBack) {
          setTimeout(() => {
            onGoBack();
          }, 1500);
        }
        return;
      }

      // For other errors, show message and let user retry
      setScanStatus(`❌ Erreur: ${error.message || 'Lecture échouée'}. Réessayez.`);
      setIsScanning(false);
    }
  };

  return (
    <View style={[{ width: containerWidth }]} onLayout={onLayout}>
      <View style={stepSpecificStyles.step6Container}>
        <Text style={stepSpecificStyles.step6Title}>Lecteur NFC</Text>

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
              {isScanning ? 'Scan en cours...' : 'Analyse'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Step6;
