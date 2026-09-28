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

import React, { useRef } from 'react';
import { ScrollView, View, Text, StyleSheet, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { TERMS_TITLE_FR, TERMS_TEXT_FR, TERMS_UPDATED_FR } from '@/constants/terms';
import { isNearBottom } from '@/utils/scroll';

// The CGU is a long, dense legal document, and testers found the app-wide
// Typography sizes too large for it specifically. These are local overrides
// scoped to this file only — the shared Typography.fontSize tokens (used by
// every other screen) are untouched. Body drops 2pt; headers drop a smaller
// 1pt since they're already comfortably large and don't need as much cut.
const CGU_BODY_SIZE = Typography.fontSize.body - 2; // 16 -> 14
const CGU_H1_SIZE = Typography.fontSize.h1 - 1; // 24 -> 23

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

  // Latest measured ScrollView viewport / content heights. We need both to
  // decide "reached the end" outside of a scroll event (e.g. content shorter
  // than the viewport, or the resting position after a momentum fling).
  const viewportH = useRef(0);
  const contentH = useRef(0);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!onReachedEnd) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    viewportH.current = layoutMeasurement.height;
    contentH.current = contentSize.height;
    if (isNearBottom(layoutMeasurement.height, contentSize.height, contentOffset.y)) {
      onReachedEnd();
    }
  };

  // Re-evaluate when either dimension is (re)measured, with offsetY 0. This
  // covers the case where the terms fit the viewport without scrolling — no
  // scroll event ever fires, so onScroll alone would never unlock the gate.
  const checkFitsWithoutScroll = () => {
    if (!onReachedEnd) return;
    if (isNearBottom(viewportH.current, contentH.current, 0)) onReachedEnd();
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    viewportH.current = e.nativeEvent.layout.height;
    checkFitsWithoutScroll();
  };

  const handleContentSizeChange = (_w: number, h: number) => {
    contentH.current = h;
    checkFitsWithoutScroll();
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, bottomPadding > 0 && { paddingBottom: bottomPadding }]}
      onScroll={handleScroll}
      // Also evaluate at the *resting* position: with coarse onScroll sampling
      // a momentum fling can come to rest at the bottom between samples, so the
      // last onScroll fired while still >40px away and the true bottom was
      // never reported. These rest events capture it on first reach.
      onScrollEndDrag={handleScroll}
      onMomentumScrollEnd={handleScroll}
      onLayout={handleLayout}
      onContentSizeChange={handleContentSizeChange}
      scrollEventThrottle={16}
    >
      <Text style={styles.title}>{TERMS_TITLE_FR}</Text>
      <Text style={styles.version}>{TERMS_UPDATED_FR}</Text>
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
      fontSize: CGU_H1_SIZE,
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
    fontSize: CGU_BODY_SIZE,
    color: colors.text,
    lineHeight: 22,
  },
  heading1: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: CGU_H1_SIZE,
    // Explicit lineHeight: without it react-native-markdown-display sizes the
    // heading line box too short for RethinkSans-SemiBold and clips the tops
    // of the glyphs (e.g. "Article 4. Anonymat").
    lineHeight: Typography.lineHeight.h1,
    color: colors.text,
    marginTop: 20,
    marginBottom: 8,
  },
  heading2: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: CGU_H1_SIZE,
    lineHeight: Typography.lineHeight.h1,
    color: colors.text,
    marginTop: 20,
    marginBottom: 8,
  },
  heading3: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: CGU_BODY_SIZE + 2,
    lineHeight: 26,
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
    fontSize: CGU_BODY_SIZE,
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
