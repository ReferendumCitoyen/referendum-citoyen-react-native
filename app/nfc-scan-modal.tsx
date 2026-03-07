import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { getRandomValues } from 'expo-crypto';
import { useTranslation } from 'react-i18next';

export default function NFCScanModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();

  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Get MRZ data from params
  const mrzData = params.mrzData ? JSON.parse(params.mrzData as string) : null;

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

  // Auto-start scan when component mounts
  useEffect(() => {
    if (mrzData && !isScanning) {
      startScan();
    }
  }, [mrzData]);

  const startScan = async () => {
    if (!mrzData) {
      setError(t('nfcScan.missingMrz'));
      return;
    }

    try {
      setIsScanning(true);
      setError(null);
      setScanStatus(t('voting.step6Init'));

      const { scanDocument } = await import('@/modules/e-document');
      const challenge = getRandomValues(new Uint8Array(32));

      if (Platform.OS === 'android') {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setScanStatus(t('voting.step6Now'));

      const result = await scanDocument('P', {
        documentNumber: mrzData.documentNumber,
        dateOfBirth: mrzData.birthDate,
        dateOfExpiry: mrzData.expiryDate,
      }, challenge);

      // Navigate back with success
      router.back();

    } catch (error: any) {
      setError(error.message || t('voting.step6ReadError'));
      setIsScanning(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('nfcScan.title')}</Text>

        {scanStatus && (
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>{scanStatus}</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.instruction}>
          {t('nfcScan.instruction')}
        </Text>

        <View style={styles.buttonContainer}>
          {!isScanning && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={startScan}
            >
              <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => router.back()}
          >
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    padding: Spacing.screen.horizontal,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.title,
    color: Colors.primary,
    textAlign: 'center',
  },
  statusContainer: {
    backgroundColor: '#DBEAFE',
    padding: 20,
    borderRadius: 12,
    width: '100%',
  },
  statusText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: '#1E40AF',
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    padding: 20,
    borderRadius: 12,
    width: '100%',
  },
  errorText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: '#991B1B',
    textAlign: 'center',
  },
  instruction: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: Colors.primary,
    textAlign: 'center',
    opacity: 0.7,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
    marginTop: 24,
  },
  retryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  retryButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
  cancelButton: {
    backgroundColor: '#6B7280',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
});
