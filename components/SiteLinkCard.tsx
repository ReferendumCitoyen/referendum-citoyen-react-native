import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useColors, Typography } from '@/constants/theme';

interface SiteLinkCardProps {
  title?: string;
  text: string;
  buttonLabel: string;
  /** Opened in the system browser. */
  url?: string;
  /** Alternative to `url`, for a button that navigates inside the app. */
  onPress?: () => void;
  /** 'filled' is the one action we want tapped on a screen; 'outlined' for a
   * secondary entry alongside other content. */
  variant?: 'filled' | 'outlined';
}

/**
 * A short text and one button that leaves the app for the website: the
 * Contribuer tab, the after-vote card, "Pétitions en cours", "Rester
 * informé". One component so every one of these reads the same way and
 * opens the same way (system browser, `?src=app` on the URL, nothing else).
 */
export default function SiteLinkCard({ title, text, buttonLabel, url, onPress, variant = 'filled' }: SiteLinkCardProps) {
  const colors = useColors();
  const styles = createStyles(colors);
  const open = () => {
    if (onPress) return onPress();
    if (url) {
      Linking.openURL(url).catch((e) => console.warn('[SiteLinkCard] could not open', url, e?.message ?? e));
    }
  };
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.text}>{text}</Text>
      <TouchableOpacity
        style={variant === 'filled' ? styles.buttonFilled : styles.buttonOutlined}
        activeOpacity={0.8}
        onPress={open}
        accessibilityRole={url ? 'link' : 'button'}
      >
        <Text style={variant === 'filled' ? styles.buttonFilledText : styles.buttonOutlinedText}>{buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    card: {
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardBackground,
      gap: 8,
    },
    title: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.m,
      lineHeight: Typography.lineHeight.m,
      color: colors.text,
    },
    text: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.body,
      lineHeight: Typography.lineHeight.body,
      color: colors.textSecondary ?? colors.text,
    },
    // Side padding and centred text: at large font sizes the label wraps,
    // and without these it sat flush against the left edge.
    buttonFilled: {
      marginTop: 4,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonFilledText: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.button,
      color: colors.buttonText,
      textAlign: 'center',
    },
    buttonOutlined: {
      marginTop: 4,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonOutlinedText: {
      fontFamily: Typography.fontFamily.bold,
      fontSize: Typography.fontSize.button,
      color: colors.secondary,
      textAlign: 'center',
    },
  });
