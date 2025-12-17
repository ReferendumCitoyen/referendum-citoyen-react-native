// Step 7 - Placeholder
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Typography, Spacing } from '@/constants/theme';

interface Step7Props {
  onNext?: () => void;
  onClose?: () => void;
  onSuccess?: () => void;
  onError?: () => void;
  nfcData?: any;
  isFullScreen?: boolean;
}

const Step7: React.FC<Step7Props> = ({ onNext, onClose, onSuccess, onError, nfcData, isFullScreen }) => {
  const handleAction = () => {
    if (onNext) onNext();
    if (onSuccess) onSuccess();
    if (onClose) onClose();
  };

  return (
    <View style={[styles.container, isFullScreen && styles.fullScreen]}>
      <Text style={styles.title}>Step 7</Text>
      <Text style={styles.text}>Content for step 7</Text>
      
      <TouchableOpacity style={styles.button} onPress={handleAction}>
        <Text style={styles.buttonText}>Continuer</Text>
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

export default Step7;
