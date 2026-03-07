// Step 1 - Placeholder
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';

interface Step1Props {
  onNext?: () => void;
  onClose?: () => void;
  onSuccess?: () => void;
  onError?: () => void;
  nfcData?: any;
  isFullScreen?: boolean;
}

const Step1: React.FC<Step1Props> = ({ onNext, onClose, onSuccess, isFullScreen }) => {
  const { t } = useTranslation();

  const handleAction = () => {
    if (onNext) onNext();
    if (onSuccess) onSuccess();
    if (onClose) onClose();
  };

  return (
    <View style={[styles.container, isFullScreen && styles.fullScreen]}>
      <Text style={styles.title}>{t('placeholderSteps.title', { step: '1' })}</Text>
      <Text style={styles.text}>{t('placeholderSteps.content', { step: '1' })}</Text>

      <TouchableOpacity style={styles.button} onPress={handleAction}>
        <Text style={styles.buttonText}>{t('placeholderSteps.continue')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  fullScreen: {
    borderRadius: 0,
  },
  title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.title,
    color: Colors.primary,
  },
  text: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: Colors.primary,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginTop: 20,
  },
  buttonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: Colors.white,
  },
});

export default Step1;
