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

interface ManualMRZInputProps {
  isVisible: boolean;
  onClose: () => void;
  onSubmit: (data: { documentNumber: string; birthDate: string; expiryDate: string }) => void;
}

const ManualMRZInput: React.FC<ManualMRZInputProps> = ({ isVisible, onClose, onSubmit }) => {
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

  const handleSubmit = () => {
    if (documentNumber && birthDate && expiryDate) {
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

  const isValid = documentNumber.length > 0 && birthDate.length === 6 && expiryDate.length === 6;

  const styles = StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.cardBackground,
      zIndex: 10,
    },
    container: {
      flex: 1,
      padding: 24,
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

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Saisie manuelle MRZ</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Numéro de document</Text>
          <TextInput
            style={styles.input}
            value={documentNumber}
            onChangeText={setDocumentNumber}
            placeholder="Ex: AB123456"
            placeholderTextColor={colors.text + '80'}
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date de naissance</Text>
          <TextInput
            style={styles.input}
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="JJMMAA"
            placeholderTextColor={colors.text + '80'}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={styles.hint}>Format: Jour Mois Année (ex: 150790 pour 15/07/1990)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date d'expiration</Text>
          <TextInput
            style={styles.input}
            value={expiryDate}
            onChangeText={setExpiryDate}
            placeholder="JJMMAA"
            placeholderTextColor={colors.text + '80'}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={styles.hint}>Format: Jour Mois Année (ex: 251229 pour 25/12/2029)</Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!isValid}
            activeOpacity={0.8}
          >
            <Text style={styles.submitButtonText}>Valider</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.cancelButtonText}>Retour au scanner</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default ManualMRZInput;
