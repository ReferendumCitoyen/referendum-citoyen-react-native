import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useColors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import {
  formatDateDisplay,
  sanitizeDateInput,
  parseFrenchDate,
  checkBirthDate,
  checkExpiryDate,
} from '@/utils/mrzDate';

interface ManualMRZInputProps {
  isVisible: boolean;
  onClose: () => void;
  onSubmit: (data: { documentNumber: string; birthDate: string; expiryDate: string }) => void;
}

const ManualMRZInput: React.FC<ManualMRZInputProps> = ({ isVisible, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [documentNumber, setDocumentNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  if (!isVisible) return null;

  // Convert French format (JJMMAA) to MRZ format (AAMMJJ)
  const convertToMRZFormat = (frenchDate: string): string => {
    if (frenchDate.length !== 6) return frenchDate;
    const jj = frenchDate.substring(0, 2);
    const mm = frenchDate.substring(2, 4);
    const aa = frenchDate.substring(4, 6);
    return aa + mm + jj;
  };

  // Date validation. Only show errors once the user has entered all 6 digits;
  // it would be noisy to flag "invalid" mid-typing. The eligibility policy
  // (≥18, not expired) lives in utils/mrzDate so the same checks fire on the
  // camera-scan path in Step5.
  const birthToken = birthDate.length === 6 ? checkBirthDate(parseFrenchDate(birthDate)) : null;
  const expiryToken = expiryDate.length === 6 ? checkExpiryDate(parseFrenchDate(expiryDate)) : null;

  const birthError =
    birthToken === 'invalid' ? t('mrzManual.birthInvalid') :
    birthToken === 'underage' ? t('mrzManual.birthUnderage') :
    null;

  const expiryError =
    expiryToken === 'invalid' ? t('mrzManual.expiryInvalid') :
    expiryToken === 'expired' ? t('mrzManual.expiryExpired') :
    null;

  const handleSubmit = () => {
    if (documentNumber && birthDate.length === 6 && expiryDate.length === 6 && !birthError && !expiryError) {
      onSubmit({
        documentNumber: documentNumber.toUpperCase(),
        birthDate: convertToMRZFormat(birthDate),
        expiryDate: convertToMRZFormat(expiryDate),
      });
      setDocumentNumber('');
      setBirthDate('');
      setExpiryDate('');
    }
  };

  const isValid =
    documentNumber.length > 0 &&
    birthDate.length === 6 &&
    expiryDate.length === 6 &&
    !birthError &&
    !expiryError;

  const styles = StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.cardBackground,
      zIndex: 10,
      // Elevation ensures the overlay paints above underlying native views
      // on Android (zIndex alone doesn't always win against Camera etc.).
      elevation: 10,
    },
    kavFill: {
      flex: 1,
    },
    scrollView: {
      flex: 1,
    },
    container: {
      // flexGrow (not flex) so content can exceed the viewport and become
      // scrollable — flex: 1 here would clamp content to viewport height and
      // hide the last field behind the keyboard.
      flexGrow: 1,
      padding: 24,
      paddingBottom: 48,
      gap: 24,
    },
    title: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.h1,
      lineHeight: Typography.lineHeight.h1,
      color: colors.text,
      textAlign: 'center',
    },
    inputGroup: {
      gap: 8,
    },
    label: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: colors.text,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 14,
      fontSize: 16,
      fontFamily: Typography.fontFamily.medium,
      color: colors.text,
    },
    hint: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.text,
      opacity: 0.6,
    },
    error: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 13,
      color: colors.errorText,
    },
    inputError: {
      borderColor: colors.errorText,
    },
    buttonRow: {
      gap: 12,
      marginTop: 8,
    },
    submitButton: {
      backgroundColor: colors.secondary,
      padding: 16,
      borderRadius: 8,
      alignItems: 'center' as const,
    },
    submitButtonDisabled: {
      opacity: 0.5,
    },
    submitButtonText: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: 18,
      color: colors.buttonText,
    },
    cancelButton: {
      padding: 14,
      borderRadius: 8,
      alignItems: 'center' as const,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 16,
      color: colors.text,
    },
  });

  // Outer View owns the opaque backdrop so it always fills the screen.
  // KeyboardAvoidingView lives INSIDE the backdrop — when it resizes for the
  // keyboard (behavior: 'height' on Android), it shrinks content only, not
  // the backdrop. Otherwise the KAV would expose the Step 5 camera/overlay
  // behind it when the keyboard opens.
  return (
    <View style={styles.overlay}>
      {/*
        Android's manifest uses `windowSoftInputMode="adjustResize"` — the OS
        already resizes the app window for the keyboard. Layering a KAV with
        `behavior: 'height'` on top of that was causing a white flash on focus
        (both the KAV and the OS were fighting over the resize). So: KAV with
        `padding` on iOS only, plain View on Android, and trust the OS resize
        combined with the ScrollView to keep every field reachable.
      */}
      <KeyboardAvoidingView
        style={styles.kavFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <Text style={styles.title}>{t('mrzManual.title')}</Text>

        <Text style={{
          fontFamily: Typography.fontFamily.medium,
          fontSize: 14,
          color: colors.errorText,
          textAlign: 'center',
        }}>
          {t('mrzManual.idCardOnly')}
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('mrzManual.documentNumber')}</Text>
          <TextInput
            style={styles.input}
            value={documentNumber}
            onChangeText={setDocumentNumber}
            placeholder={t('mrzManual.documentPlaceholder')}
            placeholderTextColor={colors.text + '80'}
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('mrzManual.birthDate')}</Text>
          <TextInput
            style={[styles.input, birthError && styles.inputError]}
            value={formatDateDisplay(birthDate)}
            onChangeText={(text) => setBirthDate(sanitizeDateInput(text))}
            placeholder={t('mrzManual.datePlaceholder')}
            placeholderTextColor={colors.text + '80'}
            keyboardType="number-pad"
            maxLength={8}
          />
          {birthError ? (
            <Text style={styles.error}>{birthError}</Text>
          ) : (
            <Text style={styles.hint}>{t('mrzManual.birthHint')}</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('mrzManual.expiryDate')}</Text>
          <TextInput
            style={[styles.input, expiryError && styles.inputError]}
            value={formatDateDisplay(expiryDate)}
            onChangeText={(text) => setExpiryDate(sanitizeDateInput(text))}
            placeholder={t('mrzManual.datePlaceholder')}
            placeholderTextColor={colors.text + '80'}
            keyboardType="number-pad"
            maxLength={8}
          />
          {expiryError ? (
            <Text style={styles.error}>{expiryError}</Text>
          ) : (
            <Text style={styles.hint}>{t('mrzManual.expiryHint')}</Text>
          )}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!isValid}
            activeOpacity={0.8}
          >
            <Text style={styles.submitButtonText}>{t('mrzManual.submit')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.cancelButtonText}>{t('common.backToScanner')}</Text>
          </TouchableOpacity>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default ManualMRZInput;
