import fr from '@/locales/fr.json';
import en from '@/locales/en.json';

describe.each([fr, en])('NFC guidance translations', (locale) => {
  const v = locale.voting;

  it.each([
    'step6FindAntenna', 'step6Search_idCard', 'step6Search_passport',
    'step6SearchHelp', 'step6ContactDetected', 'step6ReadTimedOut',
    'step6PassportPlacementAndroid',
  ] as const)('provides %s', (key) => {
    expect(v[key].trim().length).toBeGreaterThan(0);
    expect(v[key]).not.toMatch(/https?:|\{\{/);
  });

  it('names the actual correction button in the authentication hint', () => {
    expect(v.step6CanRejected).toContain(v.step6EditAccess_idCard);
  });
});

it('does not prescribe a single antenna location for all phones', () => {
  expect(fr.voting.step6AntennaAndroid).toContain('du haut vers le bas');
  expect(en.voting.step6AntennaAndroid).toContain('from top to bottom');
});
