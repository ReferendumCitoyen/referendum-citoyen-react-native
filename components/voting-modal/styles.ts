import { useCallback, useRef, useState } from 'react';
import { Spacing, Typography, useColors } from '@/constants/theme';
import { Dimensions, Platform, StyleSheet, type ViewStyle } from 'react-native';

/**
 * The box of a slide from step 7 on (QA 2.0.2, items 1 to 3 and 12).
 *
 * `slideAreaHeight` is the measured height the flow leaves for the slides
 * (voting-flow passes it without the Android status-bar spacer). On iOS
 * nothing above the slide bounds its height, so the slide takes exactly that
 * height and its ScrollView (flex: 1) scrolls whatever does not fit. On
 * Android the row stretches the slide to the slide area; the floor below
 * never exceeds the area, so it can no longer push the bottom of a slide
 * (and its buttons) out of view as 75 % of the WINDOW height did.
 *
 * Before the first layout there is no measure: 75 % of the window is the
 * fallback, for that one frame only. The flow's container already pads the
 * bottom safe-area inset, so slides do not add it again.
 */
export function slideFrameStyle(slideAreaHeight: number | undefined): ViewStyle {
  const measured = slideAreaHeight && slideAreaHeight > 0 ? Math.round(slideAreaHeight) : undefined;
  const preMeasure = Math.round(Dimensions.get('window').height * 0.75);
  if (Platform.OS === 'ios') return { height: measured ?? preMeasure };
  return { minHeight: measured !== undefined ? Math.min(measured, preMeasure) : preMeasure };
}

/**
 * Scrollable content of such a slide, from the step's container style: fills
 * the slide when short (so the buttons, placed last, sit at the bottom) and
 * scrolls when long. A `flex: 1` on a ScrollView's content container would cap
 * it at the viewport and make the overflow unreachable, so it is dropped.
 */
export function slideScrollContent(
  container?: ViewStyle | object,
  opts?: { overflowing?: boolean },
): ViewStyle {
  const { flex: _flex, ...rest } = (StyleSheet.flatten(container as ViewStyle) ?? {}) as ViewStyle;
  const out: ViewStyle = { ...rest, flexGrow: 1 };
  // `justifyContent: 'center'` centres the content in the scroll box. When the
  // content is TALLER than the box it spills out on both sides, and a scroll
  // view cannot scroll above its content origin: the top, which is where the
  // title is, is simply gone (QA iPhone 2.0.2, item 6: step 13 at font scale
  // 1.353 on an iPhone SE opened already scrolled, with "Une erreur est
  // survenue." off screen). Once the content overflows, stack from the top.
  if (opts?.overflowing && out.justifyContent === 'center') out.justifyContent = 'flex-start';
  return out;
}

/**
 * Tells a bounded slide whether its scroll content is taller than the box, so
 * `slideScrollContent` can stop centring it. Wire both handlers to the
 * ScrollView: `onLayout` gives the box, `onContentSizeChange` the content.
 */
/**
 * A slide that is a real box on both platforms: the height it is given, so a
 * `flex: 1` ScrollView inside it shrinks and a footer placed after the
 * ScrollView stays on screen. slideFrameStyle only gives Android a minHeight,
 * and a minHeight is not a box: the ScrollView grows to its content and
 * carries the footer past the bottom (the 360 x 640 step 6 findings, then the
 * ballot, confirm and error footers on 2026-09-24). The value is the one the
 * row stretches the slide to anyway, so it changes no pixel elsewhere.
 */
export function slideBoxStyle(slideAreaHeight: number | undefined): ViewStyle {
  if (Platform.OS === 'ios') return slideFrameStyle(slideAreaHeight);
  const measured = slideAreaHeight && slideAreaHeight > 0 ? Math.round(slideAreaHeight) : undefined;
  return measured !== undefined ? { height: measured } : slideFrameStyle(slideAreaHeight);
}

/**
 * Fixed footer under a slide's ScrollView, for the actions a step must never
 * hide (2026-09-24, iPhone SE and 360 x 640 at text size 1.3): the body above
 * scrolls, the footer stays. Same box as the Step6 footer.
 */
export function slideFooterStyle(colors: { cardBackground: string }, paddingHorizontal: number): ViewStyle {
  return {
    width: '100%',
    paddingHorizontal,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.cardBackground,
  };
}

export function useScrollOverflow(): {
  overflowing: boolean;
  onLayout: (e: { nativeEvent: { layout: { height: number } } }) => void;
  onContentSizeChange: (width: number, height: number) => void;
} {
  const [overflowing, setOverflowing] = useState(false);
  const box = useRef(0);
  const content = useRef(0);
  const settle = useCallback(() => {
    if (box.current <= 0 || content.current <= 0) return;
    setOverflowing(content.current > box.current + 1);
  }, []);
  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      box.current = e.nativeEvent.layout.height;
      settle();
    },
    [settle],
  );
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      content.current = h;
      settle();
    },
    [settle],
  );
  return { overflowing, onLayout, onContentSizeChange };
}

export const createModalStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
  },
  titleSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.modal.titlePadding,
    paddingHorizontal: Spacing.modal.titlePaddingHorizontal,
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  title: {
    flex: 1,
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
  },
  slidingWrapper: {
    overflow: 'hidden',
    alignSelf: 'stretch',
    // On Android, fill the available vertical space above the nav bar so the
    // white slide background extends consistently across steps 1–3 (otherwise
    // the row shrinks to the tallest mounted slide, which differs per step
    // because of the ±1 mount window — Step 4 is taller than Steps 1–3).
    flex: Platform.OS === 'android' ? 1 : undefined,
  },
  slidingContainer: {
    flexDirection: 'row',
    // Fill slidingWrapper's height on Android so row-children (slides) stretch
    // vertically to the full available space. Without this, the row shrinks to
    // max(slide intrinsic heights) and the white slide backgrounds end at
    // different Y positions between steps.
    flex: Platform.OS === 'android' ? 1 : undefined,
  },
  stepSlide: {
    alignItems: 'center',
    backgroundColor: Platform.OS === 'android' ? colors.cardBackground : undefined,
  },
  mediaContainer: {
    height: Platform.OS === 'android' ? 120 : Spacing.modal.mediaContainerHeight,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    width: '100%',
    paddingBottom: Platform.OS === 'android' ? 20 : 0,
  },
  contentSection: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingTop: Platform.OS === 'android' ? Spacing.l : Spacing.l,
    paddingBottom: Platform.OS === 'android' ? 0 : Spacing.l,
    paddingHorizontal: Spacing.modal.contentPaddingHorizontal,
    gap: Platform.OS === 'android' ? 0 : Spacing.modal.contentGap,
    backgroundColor: colors.cardBackground,
    width: '100%',
    height: Platform.OS === 'android' ? 'auto' : 'auto',
  },
  stepContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: Platform.OS === 'android' ? Spacing.s : Spacing.modal.stepTitleGap,
    width: '100%',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.modal.stepTitleGap,
    width: '100%',
  },
  numberCircle: {
    width: Spacing.modal.numberCircleSize,
    height: Spacing.modal.numberCircleSize,
    borderRadius: Spacing.modal.numberCircleSize / 2,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.buttonText,
  },
  stepTitle: {
    flex: 1,
    fontFamily: Typography.fontFamily.bold,
    fontSize: Platform.OS === 'android' ? 19 : Typography.fontSize.h1,
    lineHeight: Platform.OS === 'android' ? 26 : Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
  },
  stepDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Platform.OS === 'android' ? 15 : Typography.fontSize.body,
    lineHeight: Platform.OS === 'android' ? 22 : Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? 0 : Spacing.modal.footerPadding,
    paddingBottom: Spacing.modal.footerPadding,
    paddingHorizontal: Spacing.modal.footerPaddingHorizontal,
    gap: Spacing.modal.footerGap,
    backgroundColor: colors.cardBackground,
    width: '100%',
  },
  progressContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.modal.progressBarGap,
  },
  progressBar: {
    flex: 1,
    height: Spacing.modal.progressBarHeight,
    borderRadius: Spacing.modal.progressBarRadius,
  },
  progressBarActive: {
    backgroundColor: colors.progressActive,
  },
  progressBarInactive: {
    backgroundColor: colors.progressInactive,
  },
  arrowButton: {
    width: Spacing.modal.arrowButtonSize,
    height: Spacing.modal.arrowButtonSize,
    borderRadius: Spacing.modal.arrowButtonRadius,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Android-only escape hatch on the post-vote screen: the "Fermer" header is
  // iOS-only and the bottom nav stops after step 3, so without this the system
  // back gesture is the only way out of the final screen.
  step12AndroidClose: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  step12AndroidCloseText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.button,
    color: colors.text,
  },
});

// Android's mediaContainer is 120h with paddingBottom: 20, giving ~100px of
// inner space. The iOS-sized assets (167–175h) overflow that container; with
// `resizeMode: contain` the overflow shifts the visible image content and makes
// the three slides look misaligned (ballot sits visibly lower than card/phone).
// Clamp all three to the same footprint on Android so they line up identically.
const ANDROID_SLIDE_IMAGE = 100;
const ANDROID_CARD_WIDTH = Math.round(ANDROID_SLIDE_IMAGE * (199 / 167)); // keep card aspect

// Steps 1 and 2 use wide photographic composites rather than the square
// video/poster the fixed boxes above were sized for. Size the *box to the
// picture* instead of the other way round.
//
// The previous approach — a fixed 393×175 container with the artwork set to
// 100%/100% and resizeMode="contain" — depends entirely on `contain` surviving
// every wrapper between here and the native view. It didn't: on iOS the step 1
// composite rendered anchored top-left at its intrinsic 700×230 *points*, so
// roughly the left 56% showed and the passport half of the picture was simply
// gone. Matching the box to the image's own ratio makes contain, cover and
// stretch all produce the same, whole, undistorted picture, so no layer in the
// stack can crop it again.
//
// It also stops wasting space: step 1 is 3.04:1, so in a 175pt-tall box it only
// ever occupied 129pt. Those 46pt now go to the text below, which was being cut
// off mid-sentence.
const SLIDE_ART_MAX_HEIGHT =
  Platform.OS === 'android' ? ANDROID_SLIDE_IMAGE : Spacing.modal.mediaContainerHeight;

/** Intrinsic pixel ratios of the bundled step 1 and step 2 photographs. */
export const SLIDE_ART_ASPECT = {
  /** Passport flow: ID card and passport side by side, MRZ picked out. */
  step1: 700 / 230,
  /** Card flow: the front of the card with the CAN picked out. */
  step1Card: 1268 / 755,
  step2: 562 / 302,
} as const;

/** Largest box of the picture's own shape that fits the slide. */
export const slideArtBox = (containerWidth: number, aspect: number) => {
  const widest = SLIDE_ART_MAX_HEIGHT * aspect;
  // containerWidth is 0 until the slide has been measured; fall back to the
  // full-height box rather than collapsing the image to nothing on first paint.
  const width = containerWidth > 0 ? Math.min(containerWidth, widest) : widest;
  return { width, height: width / aspect };
};

/** Height the media strip needs to hold `art`, including Android's padding. */
export const slideArtContainerHeight = (artHeight: number) =>
  artHeight + (Platform.OS === 'android' ? 20 : 0);

export const createStepSpecificStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  cardVideo: {
    width: Platform.OS === 'android' ? ANDROID_CARD_WIDTH : Spacing.modal.cardImageWidth,
    height: Platform.OS === 'android' ? ANDROID_SLIDE_IMAGE : Spacing.modal.cardImageHeight,
  },
  phoneImage: {
    width: Platform.OS === 'android' ? ANDROID_SLIDE_IMAGE : Spacing.modal.phoneImageSize,
    height: Platform.OS === 'android' ? ANDROID_SLIDE_IMAGE : Spacing.modal.phoneImageSize,
  },
  ballotImage: {
    width: Platform.OS === 'android' ? ANDROID_SLIDE_IMAGE : Spacing.modal.ballotImageSize,
    height: Platform.OS === 'android' ? ANDROID_SLIDE_IMAGE : Spacing.modal.ballotImageSize,
  },
  // iOS-only "intro video" phase rendered on top of Step 4 before the
  // user reaches the existing "Démarrer l'analyse" content. The video
  // fills the available vertical space; the skip button sits below it,
  // hugging the bottom of the modal sheet.
  stepIntroContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.cardBackground,
    justifyContent: 'space-between',
  },
  stepIntroVideo: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  stepIntroSkipButton: {
    paddingVertical: 16,
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  stepIntroSkipButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step4Container: {
    padding: Spacing.modal.step4Padding,
    paddingBottom: 40,
    gap: Spacing.modal.step4Gap,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step4Content: {
    gap: Spacing.modal.step4ContentGap,
    alignItems: 'flex-start',
    width: '100%',
  },
  step4Title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step4Video: {
    width: Spacing.modal.cardImageWidth,
    height: Spacing.modal.cardImageHeight,
  },
  step4Button: {
    paddingVertical: Spacing.modal.step4ButtonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    width: '100%',
  },
  step4ButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step5Container: {
    paddingTop: Spacing.modal.step5Padding,
    paddingBottom: 32,
    paddingHorizontal: 0,
    gap: 16,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step5Title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step5Camera: {
    width: '100%',
    height: Spacing.modal.step5CameraHeight,
    overflow: 'visible',
  },
  step5CameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  step5ScanArea: {
    width: '80%',
    height: 80,
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  step5InstructionContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  step5CornerTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  step5CornerTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  step5CornerBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
  },
  step5CornerBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  step5MrzContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 2,
  },
  step5MrzText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: colors.buttonText,
    letterSpacing: 0.5,
    opacity: 1,
  },
  step5InstructionText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step5Button: {
    paddingVertical: 16,
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: colors.cardBackground,
    borderRadius: 8,
    alignItems: 'center',
    width: 'auto',
  },
  step5ButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.text,
    textAlign: 'center',
  },
  step6Container: {
    paddingVertical: Spacing.modal.step6Padding,
    paddingHorizontal: 0,
    gap: Spacing.modal.step6Gap,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step6Title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step6ImageContainer: {
    width: '100%',
    alignItems: 'center',
  },
  step6Image: {
    width: Spacing.modal.step6ImageWidth,
    height: Spacing.modal.step6ImageHeight,
    backgroundColor: colors.cardBackground,
  },
  // Landscape variant for the passport positioning guide: three panels with
  // captions, so it needs the full modal width to stay readable. Same height
  // as step6Image, so swapping between them shifts nothing below.
  step6ImageWide: {
    width: '100%',
    height: Spacing.modal.step6ImageHeight,
    backgroundColor: colors.cardBackground,
  },
  step6ButtonContainer: {
    paddingHorizontal: Spacing.modal.step6ButtonPaddingHorizontal,
    width: '100%',
  },
  step6Button: {
    paddingVertical: Spacing.modal.step6ButtonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    width: '100%',
  },
  step6ButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step7Container: {
    padding: Spacing.modal.step7Padding,
    gap: Spacing.modal.step7Gap,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step7Title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step7Image: {
    width: Spacing.modal.step7ImageSize,
    height: Spacing.modal.step7ImageSize,
  },
  step7Description: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step8Container: {
    padding: Spacing.modal.step8Padding,
    gap: Spacing.modal.step8Gap,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step8Content: {
    gap: Spacing.modal.step8ContentGap,
    alignItems: 'center',
    width: '100%',
  },
  step8Title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step8Description: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step8SuccessAnimation: {
    width: Spacing.modal.step8SuccessSize,
    height: Spacing.modal.step8SuccessSize,
  },
  step8Button: {
    paddingVertical: Spacing.modal.step8ButtonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    width: '100%',
  },
  step8ButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step9VoteContainer: {
    padding: 24,
    gap: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step9VoteConfirmationCard: {
    padding: 32,
    gap: 24,
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: 24,
  },
  step9VoteTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 24,
    lineHeight: 31,
    letterSpacing: 0.24,
    color: colors.secondary,
    textAlign: 'center',
    width: '100%',
  },
  step9VoteImage: {
    width: 175,
    height: 175,
  },
  step9VoteButtonRow: {
    flexDirection: 'row',
    gap: 24,
    width: '100%',
  },
  step9VoteCancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step9VoteCancelButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0.4,
    color: colors.secondary,
    textAlign: 'center',
  },
  step9VoteConfirmButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step9VoteConfirmButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0.4,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step9VoteOptionsContainer: {
    flexDirection: 'column',
    gap: 16,
    width: '100%',
  },
  step9VoteOptionButton: {
    paddingVertical: 16,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  step9VoteOptionButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0.4,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step9VoteCancelButtonFullWidth: {
    paddingVertical: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  step10Container: {
    padding: Spacing.modal.step10Padding,
    gap: Spacing.modal.step10Gap,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step10Content: {
    gap: Spacing.modal.step10ContentGap,
    alignItems: 'center',
    width: '100%',
  },
  step10Title: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  // The referendum question, above the confirm line. Deliberately lighter than
  // step10Title so the question reads as context and the "are you sure" stays
  // the headline.
  step10Question: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.textSecondary,
    textAlign: 'center',
    width: '100%',
    marginBottom: 4,
  },
  step10BallotVideo: {
    width: Spacing.modal.step10BallotSize,
    height: Spacing.modal.step10BallotSize,
  },
  step10ButtonContainer: {
    flexDirection: 'row',
    gap: Spacing.modal.step10ButtonGap,
    width: '100%',
  },
  step10CancelButton: {
    flex: 1,
    paddingVertical: Spacing.modal.step10ButtonPaddingVertical,
    backgroundColor: colors.cardBackground,
    alignItems: 'center',
  },
  step10CancelButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.text,
    textAlign: 'center',
  },
  step10ConfirmButton: {
    flex: 1,
    paddingVertical: Spacing.modal.step10ButtonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  step10ConfirmButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step11Container: {
    flex: 1,
    padding: Spacing.modal.step11Padding,
    gap: Spacing.modal.step11Gap,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step11Loading: {
    width: Spacing.modal.step11LoadingWidth,
    height: Spacing.modal.step11LoadingHeight,
  },
  // --- Post-vote confirmation (Step12Success) ---
  step6RemoveHint: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.small,
    color: colors.warningText,
    backgroundColor: colors.warningBackground,
    textAlign: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  step12Scroll: {
    paddingHorizontal: Spacing.modal.contentPaddingHorizontal,
    paddingTop: Spacing.l,
    paddingBottom: Spacing.xl,
    gap: Spacing.l,
  },
  step12Thanks: {
    gap: 6,
  },
  step12ThanksTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    color: colors.text,
  },
  step12ThanksBody: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  // Outlined rather than filled: the filled treatment belongs to "Voter" on the
  // next-referendum card below, which is the action we actually want tapped.
  step12ContactButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  step12ContactButtonText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    color: colors.secondary,
  },
  // Sits between the thank-you and the confirmation banner so it is seen
  // before the results push it out of view.
  step12Contribute: {
    marginTop: 12,
  },
  step12Banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.successBackground,
  },
  step12BannerPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.warningBackground,
  },
  step12BannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.successText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step12BannerCheck: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 18,
    lineHeight: 22,
    color: colors.successText,
  },
  step12BannerBody: {
    flex: 1,
    gap: 2,
  },
  step12BannerTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.text,
  },
  step12SerialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  step12Serial: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  step12SerialDot: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.textSecondary,
  },
  step12SerialCopy: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.small,
    color: colors.secondary,
  },
  step12Section: {
    width: '100%',
    gap: 8,
  },
  step12SectionTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    color: colors.text,
  },
  step12Question: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    marginBottom: 8,
  },
  step12Bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    gap: 10,
  },
  step12BarColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  step12BarPercent: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    color: colors.text,
  },
  step12Bar: {
    width: '100%',
    borderRadius: 2,
  },
  step12BarLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  step12BarLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    textAlign: 'center',
  },
  step12BarChosen: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.successText,
  },
  step12BarCount: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.small,
    color: colors.text,
  },
  step12Meta: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.textSecondary,
    marginTop: 4,
  },
  step12Divider: {
    height: 1,
    backgroundColor: colors.border,
    width: '100%',
    marginBottom: 8,
  },
  step12NextLabel: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.small,
    color: colors.textSecondary,
  },
  step12Card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  step12CardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  step12CardBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  step12CardBadgeText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.text,
  },
  step12CardVotes: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.textSecondary,
  },
  step12CardTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body + 2,
    color: colors.text,
  },
  step12CardButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  step12CardButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    color: colors.buttonText,
  },
  // Post-registration key-backup notice. Warning palette rather than the
  // success one: this is the only thing on a success screen the user still has
  // to act on, and it needs to read as such without looking like the vote
  // failed. Same 12px radius / 14px padding as step12Banner and step12Card so
  // it sits in the same rhythm as everything else on the slide.
  step12Backup: {
    width: '100%',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.warningBackground,
  },
  step12BackupTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body + 2,
    color: colors.warningText,
  },
  step12BackupBody: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    lineHeight: Typography.lineHeight.small,
    color: colors.warningText,
  },
  step12BackupButton: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  step12BackupButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    color: colors.buttonText,
  },
  step12VerifyLink: {
    paddingVertical: 4,
  },
  step12VerifyText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    color: colors.secondary,
    textDecorationLine: 'underline',
  },
  step12SuccessContainer: {
    // Fills the height-bounded slide so the ScrollView inside can take the
    // free space and leave the button pinned below it. No justifyContent:
    // the ScrollView (flex: 1) absorbs all of it, and its contentContainer
    // does the centring instead — that way short content still sits in the
    // middle while tall content scrolls rather than overflowing the box.
    flex: 1,
    padding: Spacing.modal.step12SuccessPadding,
    gap: Spacing.modal.step12SuccessGap,
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step12SuccessContent: {
    gap: Spacing.modal.step12SuccessContentGap,
    alignItems: 'center',
    width: '100%',
  },
  step12SuccessTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step12SuccessDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step12SuccessAnimation: {
    width: Spacing.modal.step12SuccessAnimationSize,
    height: Spacing.modal.step12SuccessAnimationSize,
  },
  step12SuccessButton: {
    paddingVertical: Spacing.modal.step12SuccessButtonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    width: '100%',
  },
  step12SuccessButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  step12ErrorContainer: {
    flex: 1,
    padding: Spacing.modal.step12ErrorPadding,
    gap: Spacing.modal.step12ErrorGap,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardBackground,
  },
  step12ErrorContent: {
    gap: Spacing.modal.step12ErrorContentGap,
    alignItems: 'center',
    width: '100%',
  },
  step12ErrorTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step12ErrorDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  step12ErrorAnimation: {
    width: Spacing.modal.step12ErrorAnimationSize,
    height: Spacing.modal.step12ErrorAnimationSize,
  },
  step12ErrorButton: {
    paddingVertical: Spacing.modal.step12ErrorButtonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    width: '100%',
  },
  step12ErrorButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
});