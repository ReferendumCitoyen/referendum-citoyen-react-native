import { formatCount } from './format-count';

describe('formatCount', () => {
  it('French groups thousands with a narrow no-break space', () => {
    expect(formatCount(1201, 'fr')).toBe('1 201');
    expect(formatCount(1234567, 'fr-FR')).toBe('1 234 567');
    expect(formatCount(999, 'fr')).toBe('999');
    expect(formatCount(0, 'fr')).toBe('0');
  });

  it('English uses a comma', () => {
    expect(formatCount(1201, 'en')).toBe('1,201');
    expect(formatCount(12345678n, 'en-GB')).toBe('12,345,678');
  });

  it('never prints "1,201" in French', () => {
    expect(formatCount(1201, 'fr')).not.toContain(',');
  });
});
