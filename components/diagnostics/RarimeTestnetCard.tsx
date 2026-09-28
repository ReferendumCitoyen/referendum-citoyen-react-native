import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  RarimePassport,
  RarimeUtils,
  DocumentStatus,
} from '@rarimo/rarime-rn-sdk';
import { useColors, Typography } from '@/constants/theme';
import { PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';

type Props = {
  // When provided, the full register-on-testnet flow is enabled.
  // Without it, the card only shows Profile Key + Reset.
  passport?: RarimePassport | null;
  documentStatus?: string | null;
  isCheckingStatus?: boolean;
  isRegistering?: boolean;
  registrationTxHash?: string | null;
  onRegister?: () => void;
  // Called after the local key is regenerated, so parent can clear derived state.
  onReset?: (newKey: string) => void;
};

export function RarimeTestnetCard({
  passport,
  documentStatus,
  isCheckingStatus,
  isRegistering,
  registrationTxHash,
  onRegister,
  onReset,
}: Props) {
  const colors = useColors();
  const styles = createStyles(colors);

  const [profileKey, setProfileKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
        const rawKey = storedKey?.startsWith('0x')
          ? storedKey.slice(2)
          : storedKey;
        if (!rawKey || rawKey.length !== 64) {
          storedKey = RarimeUtils.generateBJJPrivateKey();
          await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
        }
        try {
          setProfileKey(RarimeUtils.getProfileKey(storedKey!));
        } catch {
          setProfileKey(storedKey!);
        }
      } catch (err) {
        console.error('Failed to initialize private key:', err);
      }
    })();
  }, []);

  const resetPrivateKey = async () => {
    await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY);
    const newKey = RarimeUtils.generateBJJPrivateKey();
    await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, newKey);
    try {
      setProfileKey(RarimeUtils.getProfileKey(newKey));
    } catch {
      setProfileKey(newKey);
    }
    onReset?.(newKey);
  };

  const showRegisterButton =
    !!passport &&
    (documentStatus === DocumentStatus.NotRegistered ||
      documentStatus === DocumentStatus.RegisteredWithOtherPk) &&
    !!onRegister;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Rarime Testnet</Text>

      <View style={styles.resultRow}>
        <Text style={styles.resultLabel}>Profile Key:</Text>
        <Text style={styles.resultValue} selectable>
          {profileKey ?? 'Loading...'}
        </Text>
      </View>

      {documentStatus && (
        <View
          style={[
            styles.statusBadge,
            documentStatus === DocumentStatus.NotRegistered &&
              styles.statusNotRegistered,
            documentStatus === DocumentStatus.RegisteredWithThisPk &&
              styles.statusRegisteredOwn,
            documentStatus === DocumentStatus.RegisteredWithOtherPk &&
              styles.statusRegisteredOther,
            typeof documentStatus === 'string' &&
              documentStatus.startsWith('ERROR') &&
              styles.statusError,
          ]}
        >
          <Text style={styles.statusBadgeText}>
            {documentStatus === DocumentStatus.NotRegistered &&
              'Not Registered'}
            {documentStatus === DocumentStatus.RegisteredWithThisPk &&
              'Registered (Your Key)'}
            {documentStatus === DocumentStatus.RegisteredWithOtherPk &&
              'Registered (Other Key)'}
            {typeof documentStatus === 'string' &&
              documentStatus.startsWith('ERROR') &&
              documentStatus}
          </Text>
        </View>
      )}

      {isCheckingStatus && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Checking status on testnet...</Text>
        </View>
      )}

      {showRegisterButton && (
        <TouchableOpacity
          style={[styles.registerButton, isRegistering && styles.disabled]}
          onPress={onRegister}
          disabled={isRegistering}
        >
          {isRegistering ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.registerButtonText}>
                Registering (~5s)...
              </Text>
            </View>
          ) : (
            <Text style={styles.registerButtonText}>
              {documentStatus === DocumentStatus.RegisteredWithOtherPk
                ? 'Re-register with Current Key'
                : 'Register Identity on Testnet'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {registrationTxHash && (
        <View style={styles.txHashContainer}>
          <Text style={styles.resultLabel}>TX Hash:</Text>
          <Text style={styles.resultValue} selectable>
            {registrationTxHash}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.resetButton} onPress={resetPrivateKey}>
        <Text style={styles.resetButtonText}>Reset Private Key</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      gap: 12,
    },
    cardTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 18,
      color: colors.text,
    },
    disabled: {
      opacity: 0.5,
    },
    resultRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    resultLabel: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
      flex: 1,
    },
    resultValue: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
      flex: 2,
      textAlign: 'right',
    },
    statusBadge: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    statusNotRegistered: {
      backgroundColor: colors.border,
    },
    statusRegisteredOwn: {
      backgroundColor: '#D1FAE5',
    },
    statusRegisteredOther: {
      backgroundColor: '#FEF3C7',
    },
    statusError: {
      backgroundColor: '#FEE2E2',
    },
    statusBadgeText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    loadingText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
    },
    registerButton: {
      backgroundColor: '#10B981',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    registerButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: '#FFFFFF',
    },
    txHashContainer: {
      backgroundColor: colors.border,
      padding: 12,
      borderRadius: 8,
    },
    resetButton: {
      backgroundColor: colors.border,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
      alignItems: 'center',
    },
    resetButtonText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.textSecondary,
    },
  });
