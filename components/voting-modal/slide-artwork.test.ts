/**
 * The step 1 and step 2 photographs were being cropped on iOS: the step 1
 * composite shows an ID card *and* a passport side by side, and only the card
 * plus a sliver of the passport survived on screen.
 *
 * The cause was a box that didn't match the picture. A fixed 393×175 container
 * with the artwork at 100%/100% works only for as long as resizeMode="contain"
 * survives every wrapper between the caller and the native view — and inside
 * FadeInImage it didn't, so the image fell back to its intrinsic size (a
 * single-resolution 700×230 asset is 700×230 *points*), anchored top-left,
 * clipped by overflow:hidden.
 *
 * These tests pin the property that makes that class of bug impossible: the box
 * has the picture's own ratio, so contain, cover and stretch all render the
 * same whole, undistorted image. They deliberately assert the ratio rather than
 * specific pixel values, so retouching the artwork doesn't break them —
 * SLIDE_ART_ASPECT just has to be updated alongside it.
 */

// styles.ts reaches constants/theme → ThemeContext, which pulls in the two
// native stores. Same stubs as Step8.test.tsx.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    set() {}
    delete() {}
  },
}));

import { SLIDE_ART_ASPECT, slideArtBox } from './styles';

// Intrinsic sizes of the bundled JPEGs, kept here so a swapped asset with a
// different shape trips a test rather than silently re-cropping on a device.
const INTRINSIC = {
  step1: { w: 700, h: 230 },
  step1Card: { w: 1268, h: 755 },
  step2: { w: 562, h: 302 },
};

describe('slide artwork sizing', () => {
  it('declares the aspect ratio the bundled artwork actually has', () => {
    expect(SLIDE_ART_ASPECT.step1).toBeCloseTo(INTRINSIC.step1.w / INTRINSIC.step1.h, 5);
    expect(SLIDE_ART_ASPECT.step1Card).toBeCloseTo(INTRINSIC.step1Card.w / INTRINSIC.step1Card.h, 5);
    expect(SLIDE_ART_ASPECT.step2).toBeCloseTo(INTRINSIC.step2.w / INTRINSIC.step2.h, 5);
  });

  describe.each([
    ['step1', SLIDE_ART_ASPECT.step1],
    ['step1Card', SLIDE_ART_ASPECT.step1Card],
    ['step2', SLIDE_ART_ASPECT.step2],
  ])('%s', (_name, aspect) => {
    // Narrow phone through to a tablet-width modal.
    it.each([320, 375, 393, 430, 768])('keeps the picture ratio at %ipt wide', (width) => {
      const box = slideArtBox(width, aspect);
      expect(box.width / box.height).toBeCloseTo(aspect, 5);
    });

    it('never exceeds the width it is given', () => {
      expect(slideArtBox(320, aspect).width).toBeLessThanOrEqual(320);
      expect(slideArtBox(393, aspect).width).toBeLessThanOrEqual(393);
    });

    it('falls back to a visible box before the slide has been measured', () => {
      // containerWidth is 0 on the first paint. Math.min would collapse the
      // image to nothing, so the helper has to ignore the zero.
      const box = slideArtBox(0, aspect);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.width / box.height).toBeCloseTo(aspect, 5);
    });

    it('grows with the slide rather than staying pinned to one phone size', () => {
      const narrow = slideArtBox(320, aspect);
      const wide = slideArtBox(430, aspect);
      if (narrow.width < 320) {
        // Height-bound already on the narrowest phone (the card picture): the
        // box is the strip's height at its own ratio, on every phone alike.
        expect(wide.width).toBeCloseTo(narrow.width, 5);
      } else {
        expect(wide.width).toBeGreaterThan(narrow.width);
      }
    });
  });

  it('shows the whole step 1 composite, not just the ID-card half', () => {
    // The regression: the card occupies the left ~47% of the composite. If the
    // box is wider than the picture's ratio the passport half gets cropped, so
    // assert the height that ratio implies is actually granted.
    const width = 393;
    const box = slideArtBox(width, SLIDE_ART_ASPECT.step1);
    expect(box.width).toBe(width);
    expect(box.height).toBeCloseTo(width / (700 / 230), 5);
  });
});
