/**
 * Launch-time CGU gate. Rendered as a full-screen overlay (not a route)
 * from app/_layout.tsx whenever `acceptedVersion !== TERMS_VERSION`.
 *
 * The "J'accepte" button stays disabled until the user has scrolled to
 * within ~40 px of the bottom of the terms text — guarding against
 * speedrunning the gate.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, Typography, Spacing, BorderRadius } from '@/constants/theme';
import TermsBody from '@/components/TermsBody';
import { useTerms } from '@/contexts/TermsContext';

export default function TermsGate() {
  const colors = useColors();
  const styles = createStyles(colors);
  const { accept } = useTerms();
  const [reachedEnd, setReachedEnd] = useState(false);
  // react-native's own SafeAreaView is a no-op on Android, and with
  // `edgeToEdgeEnabled` the gate was drawn under the status bar: "Faites
  // défiler jusqu'en bas pour accepter" sat behind the clock and the icons
  // (QA Android 2.0.2, item 4.4). The rest of the app reads the insets from
  // react-native-safe-area-context (app/voting-flow.tsx,
  // components/CustomTabBar.tsx); so does the gate now. Both platforms:
  // on iOS the insets are the same numbers SafeAreaView used.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerHint}>
        <Text style={styles.headerHintText}>
          Faites défiler jusqu&apos;en bas pour accepter
        </Text>
      </View>

      <View style={styles.bodyWrap}>
        <TermsBody onReachedEnd={() => setReachedEnd(true)} />
      </View>

      <View style={[styles.footer, { paddingBottom: Spacing.l + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          style={[styles.acceptButton, !reachedEnd && styles.acceptButtonDisabled]}
          disabled={!reachedEnd}
          onPress={() => { void accept(); }}
        >
          <Text style={[styles.acceptButtonText, !reachedEnd && styles.acceptButtonTextDisabled]}>
            J&apos;accepte
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerHint: {
      paddingHorizontal: Spacing.screen.horizontal,
      paddingVertical: Spacing.s,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerHintText: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      opacity: 0.65,
      textAlign: 'center',
    },
    bodyWrap: {
      flex: 1,
    },
    footer: {
      paddingHorizontal: Spacing.screen.horizontal,
      paddingTop: Spacing.m,
      paddingBottom: Spacing.l,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    acceptButton: {
      backgroundColor: colors.secondary,
      borderRadius: BorderRadius.m,
      paddingVertical: Spacing.l,
      alignItems: 'center',
    },
    acceptButtonDisabled: {
      backgroundColor: colors.border,
      opacity: 0.6,
    },
    acceptButtonText: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.body,
      color: colors.buttonText,
    },
    acceptButtonTextDisabled: {
      color: colors.text,
      opacity: 0.7,
    },
  });
