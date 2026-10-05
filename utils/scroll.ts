/**
 * True when a vertical scroll position is within `tolerance` px of the bottom
 * — OR the content already fits the viewport (nothing to scroll). Used by the
 * CGU gate (components/TermsBody.tsx) to enable "J'accepte" once the user has
 * actually reached the end of the terms.
 *
 * Returns false for not-yet-measured dimensions (0) so it never fires on the
 * initial layout pass before the ScrollView has a real size.
 */
export function isNearBottom(
  layoutHeight: number,
  contentHeight: number,
  offsetY: number,
  tolerance = 40,
): boolean {
  if (layoutHeight <= 0 || contentHeight <= 0) return false;
  // contentHeight - (layoutHeight + offsetY) is the distance still below the
  // viewport. <= 0 means we're at/past the bottom; short content (content <
  // viewport, offsetY 0) yields a negative distance → also "at bottom".
  return contentHeight - (layoutHeight + offsetY) < tolerance;
}
