import React, { useRef, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useColors } from '@/constants/theme';

interface ManualMRZInputProps {
  isVisible: boolean;
  onClose: () => void;
  onSubmit: (data: { documentNumber: string; birthDate: string; expiryDate: string }) => void;
}

const ManualMRZInput: React.FC<ManualMRZInputProps> = ({ isVisible, onClose, onSubmit }) => {
  const colors = useColors();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  React.useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [isVisible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  const handleSubmit = () => {
    if (documentNumber && birthDate && expiryDate) {
      onSubmit({
        documentNumber: documentNumber.toUpperCase(),
        birthDate,
        expiryDate,
      });
      // Reset fields
      setDocumentNumber('');
      setBirthDate('');
      setExpiryDate('');
    }
  };

  const styles = StyleSheet.create({
    container: {
      padding: 24,
      gap: 20,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    inputGroup: {
      gap: 8,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    input: {
      backgroundColor: colors.white,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      color: colors.text,
    },
    hint: {
      fontSize: 12,
      color: colors.text,
      opacity: 0.6,
    },
    button: {
      backgroundColor: colors.secondary,
      padding: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.white,
    },
  });

  const isValid = documentNumber.length > 0 && birthDate.length === 6 && expiryDate.length === 6;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={['65%']}
      enablePanDownToClose={true}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.text }}
      onDismiss={onClose}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.container}>
        <Text style={styles.title}>Saisie manuelle MRZ</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Numéro de document</Text>
          <BottomSheetTextInput
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
          <BottomSheetTextInput
            style={styles.input}
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="AAMMJJ"
            placeholderTextColor={colors.text + '80'}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={styles.hint}>Format: AAMMJJ (ex: 900101 pour 01/01/1990)</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date d'expiration</Text>
          <BottomSheetTextInput
            style={styles.input}
            value={expiryDate}
            onChangeText={setExpiryDate}
            placeholder="AAMMJJ"
            placeholderTextColor={colors.text + '80'}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={styles.hint}>Format: AAMMJJ (ex: 290101 pour 01/01/2029)</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, !isValid && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!isValid}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Valider</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default ManualMRZInput;
