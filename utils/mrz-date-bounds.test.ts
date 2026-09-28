import { readFileSync } from 'fs';
import {
  assertBirthDateEligible,
  birthDateBoundsIssue,
  frenchForSdkVerifyMessage,
  isMrzDateLess,
  normalizeMrzDate,
  packedMrzDate,
  todayMrz,
} from './mrz-date-bounds';

const packed = (s: string) => BigInt('0x' + Buffer.from(s, 'ascii').toString('hex'));
const UNUSED = 52983525027888n; // "000000", the SDK's MRZ_ZERO_DATE
const TODAY = '260913';

describe('packedMrzDate / todayMrz', () => {
  it('unpacks the ASCII bigint the contract stores', () => {
    expect(packedMrzDate(UNUSED)).toBe('000000');
    expect(packedMrzDate(0x303830363131n)).toBe('080611');
  });
  it('formats today as YYMMDD in UTC, the day the contract reads', () => {
    expect(todayMrz(new Date(Date.UTC(2026, 8, 13, 10)))).toBe('260913');
    expect(todayMrz(new Date(Date.UTC(2031, 0, 5)))).toBe('310105');
    // 23:30 UTC is still the 4th, whatever the phone's zone says.
    expect(todayMrz(new Date(Date.UTC(2031, 0, 4, 23, 30)))).toBe('310104');
  });
});

describe('normalizeMrzDate — the circuit century rule', () => {
  it('reads a date before today as 20xx and at/after today as 19xx', () => {
    expect(normalizeMrzDate('010315', TODAY)).toBe(1_010_315); // 2001
    expect(normalizeMrzDate('850315', TODAY)).toBe(850_315); // 1985
    expect(normalizeMrzDate('270910', TODAY)).toBe(270_910); // 1927, #67's lower bound
    expect(normalizeMrzDate('260912', TODAY)).toBe(1_260_912); // yesterday → 2026
    expect(normalizeMrzDate('260913', TODAY)).toBe(260_913); // today itself → 1926
  });
  it('orders across the century', () => {
    expect(isMrzDateLess('850315', '080611', TODAY)).toBe(true); // 1985 < 2008
    expect(isMrzDateLess('100101', '080611', TODAY)).toBe(false); // 2010 > 2008
    expect(isMrzDateLess('270910', '010315', TODAY)).toBe(true); // 1927 < 2001
  });
});

describe('birthDateBoundsIssue', () => {
  const eighteenPlus = { lowerbound: UNUSED, upperbound: packed('080611') };

  it('accepts an adult born last century against an 18+ bound (the June scrutins)', () => {
    expect(birthDateBoundsIssue({ birthDate: '850315', ...eighteenPlus, current: TODAY })).toBeNull();
  });
  it('refuses a minor', () => {
    expect(birthDateBoundsIssue({ birthDate: '100101', ...eighteenPlus, current: TODAY })).toBe('above-upperbound');
  });
  it('is strict at the bound, like the circuit', () => {
    expect(birthDateBoundsIssue({ birthDate: '080610', ...eighteenPlus, current: TODAY })).toBeNull();
    expect(birthDateBoundsIssue({ birthDate: '080611', ...eighteenPlus, current: TODAY })).toBe('above-upperbound');
  });
  it('accepts a 2001 birth date against #67 max-age lower bound of 1927 — what the SDK refused', () => {
    const sixtySeven = { lowerbound: packed('270910'), upperbound: packed('080910') };
    expect(birthDateBoundsIssue({ birthDate: '010315', ...sixtySeven, current: TODAY })).toBeNull();
    // "270909" reads as 1927-09-09 (at/after today's YYMMDD → 19xx): one day
    // under the bound, and the bound itself is excluded.
    expect(birthDateBoundsIssue({ birthDate: '270909', ...sixtySeven, current: TODAY })).toBe('below-lowerbound');
    expect(birthDateBoundsIssue({ birthDate: '270910', ...sixtySeven, current: TODAY })).toBe('below-lowerbound');
    expect(birthDateBoundsIssue({ birthDate: '270911', ...sixtySeven, current: TODAY })).toBeNull();
  });
  it('skips unused bounds', () => {
    expect(birthDateBoundsIssue({ birthDate: '100101', lowerbound: UNUSED, upperbound: UNUSED, current: TODAY })).toBeNull();
  });
});

describe('assertBirthDateEligible / frenchForSdkVerifyMessage', () => {
  it('throws the French [VOTE_INELIGIBLE] message for a minor', () => {
    expect(() =>
      assertBirthDateEligible('200101', { birthDateLowerbound: UNUSED, birthDateUpperbound: packed('080611') }),
    ).toThrow(/^\[VOTE_INELIGIBLE\] .*majeures/);
  });
  it('maps the SDK wording and leaves the rest alone', () => {
    expect(frenchForSdkVerifyMessage('Birth date is higher than upperbound')).toMatch(/majeures/);
    expect(frenchForSdkVerifyMessage('Birth date is lower than lowerbound')).toMatch(/limite d'âge/);
    expect(frenchForSdkVerifyMessage('Citizen is not in whitelist')).toMatch(/citoyens français/);
    expect(frenchForSdkVerifyMessage('User has already voted')).toBeNull();
  });
});

describe('the SDK patch carries the same rule', () => {
  // The runtime executes build/RarimePassport.js; the patch must keep the
  // century normalisation there and the old decimal compare gone.
  const built = readFileSync(require.resolve('@rarimo/rarime-rn-sdk/build/RarimePassport.js'), 'utf8');
  it('no longer compares a packed bound with the decimal MRZ number', () => {
    expect(built).not.toContain('birthDateLowerbound > BigInt(mrz.birthDate)');
    expect(built).not.toContain('birthDateUpperbound < BigInt(mrz.birthDate)');
  });
  it('normalises the century the way the circuit does', () => {
    expect(built).toContain('raw < current ? 1000000 : 0');
  });
});
