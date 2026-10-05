import { compareVersions, shouldShowUpdateNotice } from './update-notice';

describe('compareVersions', () => {
  it('orders dotted numeric versions', () => {
    expect(compareVersions('1.2.2', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.2.4', '1.2.2')).toBeGreaterThan(0);
    expect(compareVersions('1.2.4', '1.2.4')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0); // numeric, not lexicographic
  });

  it('treats missing segments as 0 (1.2.4 == 1.2.4.0; error reports show 4-segment versions)', () => {
    expect(compareVersions('1.2.4', '1.2.4.0')).toBe(0);
    expect(compareVersions('1.2.4.1', '1.2.4')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0.0')).toBe(0);
  });

  it('is lenient with junk segments (treated as 0, never throws)', () => {
    expect(compareVersions('1.2.x', '1.2.0')).toBe(0);
    expect(compareVersions('', '1.0')).toBeLessThan(0);
  });
});

describe('shouldShowUpdateNotice', () => {
  it('shows when current version is below the minimum', () => {
    expect(shouldShowUpdateNotice({ current: '1.2.2', min: '1.2.4', dismissedMin: null })).toBe(true);
  });

  it('hides when current version meets or exceeds the minimum', () => {
    expect(shouldShowUpdateNotice({ current: '1.2.4', min: '1.2.4', dismissedMin: null })).toBe(false);
    expect(shouldShowUpdateNotice({ current: '1.3.0', min: '1.2.4', dismissedMin: null })).toBe(false);
  });

  it('hides after the user dismissed THIS minimum version', () => {
    expect(shouldShowUpdateNotice({ current: '1.2.2', min: '1.2.4', dismissedMin: '1.2.4' })).toBe(false);
  });

  it('re-shows when the published minimum moves past the dismissed one', () => {
    expect(shouldShowUpdateNotice({ current: '1.2.2', min: '1.2.5', dismissedMin: '1.2.4' })).toBe(true);
  });

  it('hides when no minimum is published (field absent from the index)', () => {
    expect(shouldShowUpdateNotice({ current: '1.2.2', min: undefined, dismissedMin: null })).toBe(false);
    expect(shouldShowUpdateNotice({ current: '1.2.2', min: '', dismissedMin: null })).toBe(false);
  });
});
