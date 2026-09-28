import { isNearBottom } from './scroll';

describe('isNearBottom', () => {
  // Typical tall terms text: 3000px content in an 800px viewport.
  it('is false at the top of long content', () => {
    expect(isNearBottom(800, 3000, 0)).toBe(false);
  });

  it('is false mid-scroll, still far from the bottom', () => {
    expect(isNearBottom(800, 3000, 1000)).toBe(false);
  });

  // The reported bug: at rest exactly at the bottom the predicate must fire.
  it('is true when scrolled to the exact bottom', () => {
    expect(isNearBottom(800, 3000, 2200)).toBe(true);
  });

  it('is true within the 40px tolerance of the bottom', () => {
    expect(isNearBottom(800, 3000, 2170)).toBe(true); // distance 30
  });

  it('is false just outside the 40px tolerance', () => {
    expect(isNearBottom(800, 3000, 2150)).toBe(false); // distance 50
  });

  // Short terms that fit the viewport: nothing to scroll, so the gate must
  // unlock immediately (offsetY 0, content < viewport).
  it('is true when content fits the viewport without scrolling', () => {
    expect(isNearBottom(800, 500, 0)).toBe(true);
  });

  // Initial layout pass before the ScrollView has been measured.
  it('is false for unmeasured (zero) dimensions', () => {
    expect(isNearBottom(0, 0, 0)).toBe(false);
    expect(isNearBottom(800, 0, 0)).toBe(false);
    expect(isNearBottom(0, 3000, 0)).toBe(false);
  });

  it('honours a custom tolerance', () => {
    expect(isNearBottom(800, 3000, 2100, 200)).toBe(true); // distance 100 < 200
    expect(isNearBottom(800, 3000, 2100, 50)).toBe(false); // distance 100 > 50
  });
});
