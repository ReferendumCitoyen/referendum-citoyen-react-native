/**
 * Renders the CGU title + body. Shared between the launch-time gate
 * (app/terms-gate.tsx) and the in-Settings read-only view
 * (app/terms-view.tsx) so they cannot diverge.
 *
 * Optionally calls `onReachedEnd` when the user scrolls within ~40px of the
 * bottom of the text — the gate uses this to enable the "J'accepte" button
 * only after the user has actually seen the end. The view passes nothing
 * (no acceptance, no gate to lift).
 *
 * The body is markdown (see TERMS_TEXT_FR in constants/terms.ts), rendered
 * by react-native-markdown-display. The renderer is wrapped in our own
 * ScrollView so the scroll-to-end detection keeps working — the library's
 * built-in ScrollView would swallow the events.
 */

import React from 'react';
import { ScrollView, View, Text, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { TERMS_TITLE_FR, TERMS_TEXT_FR, TERMS_VERSION } from '@/constants/terms';

interface TermsBodyProps {
  onReachedEnd?: () => void;
  /** Extra paddingBottom on the scroll content. The read-only Settings view
   * uses this for breathing room past the home indicator. The launch gate
   * leaves this at 0 so its `onReachedEnd` distance-from-bottom threshold
   * still fires right at the end of the text — adding bottom padding here
   * would force the user to scroll past empty space before "J'accepte"
   * activates. */
  bottomPadding?: number;
}

export default function TermsBody({ onReachedEnd, bottomPadding = 0 }: TermsBodyProps) {
  const colors = useColors();
  const styles = createStyles(colors);
  const mdStyles = createMarkdownStyles(colors);

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
      contentContainerStyle={[styles.scrollContent, bottomPadding > 0 && { paddingBottom: bottomPadding }]}
      onScroll={handleScroll}
      scrollEventThrottle={64}
    >
      <Text style={styles.title}>{TERMS_TITLE_FR}</Text>
      <Text style={styles.version}>{`Version : ${TERMS_VERSION}`}</Text>
      <View style={styles.divider} />
      {/* react-native-markdown-display normally wraps in its own ScrollView;
          we pass `mergeStyle` and rely on the outer ScrollView above. */}
      <Markdown style={mdStyles}>{TERMS_TEXT_FR}</Markdown>
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
  });

// Style overrides for react-native-markdown-display. Each key maps to a
// markdown AST node; the renderer falls back to its built-in defaults for
// anything we don't override. See:
// https://github.com/iamacup/react-native-markdown-display/blob/master/src/lib/styles.js
const createMarkdownStyles = (colors: any) => ({
  body: {
    fontFamily: Typography.fontFamily.regular,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    lineHeight: 22,
  },
  heading1: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.h1,
    color: colors.text,
    marginTop: 20,
    marginBottom: 8,
  },
  heading2: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.h1,
    color: colors.text,
    marginTop: 20,
    marginBottom: 8,
  },
  heading3: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body + 2,
    color: colors.text,
    marginTop: 12,
    marginBottom: 4,
  },
  strong: {
    fontFamily: Typography.fontFamily.semibold,
  },
  em: {
    fontStyle: 'italic' as const,
  },
  // Bullet lists — keep the marker in the theme color, add a touch of
  // vertical breathing room between items.
  bullet_list: {
    marginVertical: 4,
  },
  list_item: {
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: colors.text,
    fontSize: Typography.fontSize.body,
    lineHeight: 22,
    marginRight: 6,
  },
  // Paragraph spacing — default is fine for body text. Override only if
  // the spec asks for tighter / looser typography.
  paragraph: {
    marginTop: 0,
    marginBottom: 10,
  },
  // Hyperlinks (currently unused in the CGU text but worth styling for
  // future edits).
  link: {
    color: colors.secondary,
    textDecorationLine: 'underline' as const,
  },
});
