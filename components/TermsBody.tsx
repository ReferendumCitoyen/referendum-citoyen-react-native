/**
 * Renders the CGU title + body. Shared between the launch-time gate
 * (app/terms-gate.tsx) and the in-Settings read-only view
 * (app/terms-view.tsx) so they cannot diverge.
 *
 * Optionally calls `onReachedEnd` when the user scrolls within ~40px of the
 * bottom of the text — the gate uses this to enable the "J'accepte" button
 * only after the user has actually seen the end. The view passes nothing
 * (no acceptance, no gate to lift).
 */

import React from 'react';
import { ScrollView, View, Text, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { TERMS_TITLE_FR, TERMS_TEXT_FR, TERMS_VERSION } from '@/constants/terms';

interface TermsBodyProps {
  onReachedEnd?: () => void;
}

export default function TermsBody({ onReachedEnd }: TermsBodyProps) {
  const colors = useColors();
  const styles = createStyles(colors);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!onReachedEnd) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    // ~40 px tolerance so users with momentum-scroll inertia / slightly
    // imprecise stop near the bottom still trigger the gate-lift.
    if (distanceFromBottom < 40) onReachedEnd();
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      onScroll={handleScroll}
      scrollEventThrottle={64}
    >
      <Text style={styles.title}>{TERMS_TITLE_FR}</Text>
      <Text style={styles.version}>{`Version : ${TERMS_VERSION}`}</Text>
      <View style={styles.divider} />
      <Text style={styles.body} selectable>{TERMS_TEXT_FR}</Text>
    </ScrollView>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingHorizontal: Spacing.screen.horizontal,
      paddingVertical: Spacing.l,
    },
    title: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: Typography.fontSize.h1,
      color: colors.text,
      marginBottom: 4,
    },
    version: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: Typography.fontSize.small,
      color: colors.text,
      opacity: 0.6,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: Spacing.m,
    },
    body: {
      fontFamily: Typography.fontFamily.regular,
      fontSize: Typography.fontSize.body,
      color: colors.text,
      lineHeight: 22,
    },
  });
