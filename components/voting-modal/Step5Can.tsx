import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, LayoutChangeEvent, Image } from 'react-native';
import { useColors, Typography } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { CAP_SMALL } from '@/utils/font-scale-cap';
import { CAN_LENGTH, isValidCan, sanitizeCanInput } from '@/utils/document-access-key';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { slideBoxStyle, slideFooterStyle } from './styles';

/**
 * Step 5 for an ID card: the CAN, and nothing else.
 *
 * The six digits printed on the card open its chip through PACE; the MRZ
 * strip is not needed, so the camera is gone from this flow (project
 * decision, 2026-09-09). The CAN is an access credential: it is never logged, and the
 * field keeps its value while the flow is open so a failed chip read can be
 * retried after correcting a digit rather than retyping it.
 */
interface Step5CanProps {
  containerWidth: number;
  /** Available slide-area height; caps the iOS ScrollView so the button stays
   * reachable above the keyboard. */
  slideAreaHeight?: number;
  onSubmit?: (can: string) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** True while step 5 is the current step. Re-arms the submit lock each
   * time the step becomes current again (after Back from step 6). */
  isActive?: boolean;
}

const Step5Can: React.FC<Step5CanProps> = ({ containerWidth, slideAreaHeight, onSubmit, onLayout, isActive = true }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [can, setCan] = useState('');
  const valid = isValidCan(can);
  // How much of the slide the keyboard covers (iOS; 0 on Android, where the
  // window itself shrinks). It lifts the fixed footer above the keyboard, so
  // "Continuer" is on screen while the voter types. See
  // hooks/useKeyboardInset.ts for why KeyboardAvoidingView did the opposite.
  const keyboardInset = useKeyboardInset();
  const scrollRef = useRef<ScrollView>(null);
  // The keyboard opening shrinks the scroll box: bring the end of the step
  // (the field and its hint) into view instead of leaving the voter to find
  // what they are typing.
  useEffect(() => {
    if (keyboardInset <= 0) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [keyboardInset]);

  // One submission per visit (item 5): the keyboard's "done" and the button
  // both submit, and a double tap used to advance the flow twice. The lock
  // is released when the step becomes current again: this component stays
  // mounted at step 6 and keeps its state on Back, so a lock that never
  // re-armed would leave Continue dead after Back.
  const submittedRef = useRef(false);
  useEffect(() => {
    if (isActive) submittedRef.current = false;
  }, [isActive]);

  const submit = () => {
    if (!valid || !isActive || submittedRef.current) return;
    submittedRef.current = true;
    onSubmit?.(can);
  };

  const styles = StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 24,
      paddingBottom: 24,
      gap: 24,
    },
    title: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.h1,
      lineHeight: Typography.lineHeight.h1,
      color: colors.text,
      textAlign: 'center',
    },
    // A thumbnail, not a poster: the card only has to show where the six
    // digits sit, and the field and button must stay on screen beneath it.
    // Both sides fixed in points — a percentage width did not resolve inside
    // this ScrollView on iOS and the picture came out at its pixel size.
    canPicture: {
      width: 240,
      height: 143, // 1268 × 755 px
      alignSelf: 'center',
      borderRadius: 8,
      marginBottom: 6,
    },
    canCaption: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 13,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    docTypeNotice: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 14,
      color: colors.errorText,
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
      fontSize: 24,
      letterSpacing: 6,
      textAlign: 'center',
      fontFamily: Typography.fontFamily.medium,
      color: colors.text,
    },
    hint: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
      opacity: 0.7,
    },
    button: {
      backgroundColor: colors.secondary,
      padding: 16,
      borderRadius: 8,
      alignItems: 'center' as const,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: 18,
      color: colors.buttonText,
    },
  });

  // 2026-09-25: the button sits in a fixed footer under the scroll, outside
  // it (measurement campaign: on an iPhone SE and a 360 x 640 Android at text
  // size 1.3 "Continuer" was below the fold at first rendering, reachable
  // only by scrolling). The slide is a real box on both platforms
  // (slideBoxStyle), the body scrolls inside it, the footer never moves.
  return (
    <View style={[{ width: containerWidth }, slideBoxStyle(slideAreaHeight)]} onLayout={onLayout}>
      <ScrollView
          ref={scrollRef}
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title} maxFontSizeMultiplier={CAP_SMALL}>
            {t('voting.step5CanTitle')}
          </Text>

          {/* Where the code is, before the field that asks for it (C3). */}
          <Image
            source={require('@/assets/images/card-can-location.jpg')}
            style={styles.canPicture}
            resizeMode="contain"
            accessibilityLabel={t('voting.step5CanCaption')}
          />
          <Text style={styles.canCaption}>{t('voting.step5CanCaption')}</Text>

          <Text style={styles.docTypeNotice}>{t('mrzManual.docTypeNotice_idCard')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('voting.step5CanLabel')}</Text>
            <TextInput
              style={styles.input}
              value={can}
              onChangeText={(text) => setCan(sanitizeCanInput(text))}
              placeholder={t('voting.step5CanPlaceholder')}
              placeholderTextColor={colors.text + '80'}
              keyboardType="number-pad"
              maxLength={CAN_LENGTH}
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel={t('voting.step5CanLabel')}
            />
            <Text style={styles.hint}>{t('voting.step5CanHint')}</Text>
          </View>
        </ScrollView>

      {/* iOS: the keyboard covers the bottom of the sheet; the footer's bottom
          padding grows by its height so the button stays above it. */}
      <View testID="step5-footer" style={[slideFooterStyle(colors, 24), keyboardInset > 0 ? { paddingBottom: 12 + keyboardInset } : null]}>
        <TouchableOpacity
          style={[styles.button, !valid && styles.buttonDisabled]}
          onPress={submit}
          disabled={!valid}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>{t('common.continue')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default Step5Can;
