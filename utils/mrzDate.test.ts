import {
  formatDateDisplay,
  sanitizeDateInput,
  parseFrenchDate,
  parseMRZDate,
  expandMrzBirthYear,
  ageInYears,
  isExpired,
  checkBirthDate,
  checkExpiryDate,
  MIN_VOTING_AGE,
} from './mrzDate';

describe('formatDateDisplay', () => {
  it('returns digits unchanged below 3', () => {
    expect(formatDateDisplay('')).toBe('');
    expect(formatDateDisplay('1')).toBe('1');
    expect(formatDateDisplay('15')).toBe('15');
  });

  it('inserts the first slash after JJ', () => {
    expect(formatDateDisplay('150')).toBe('15/0');
    expect(formatDateDisplay('1507')).toBe('15/07');
  });

  it('inserts the second slash after MM', () => {
    expect(formatDateDisplay('15079')).toBe('15/07/9');
    expect(formatDateDisplay('150790')).toBe('15/07/90');
  });

  it('strips non-digits before formatting', () => {
    expect(formatDateDisplay('15/07/90')).toBe('15/07/90');
    expect(formatDateDisplay('15-07-90')).toBe('15/07/90');
    expect(formatDateDisplay('15 07 90')).toBe('15/07/90');
  });

  it('clamps to 6 digits', () => {
    expect(formatDateDisplay('15079012345')).toBe('15/07/90');
  });
});

describe('sanitizeDateInput', () => {
  it('keeps only digits and clamps to 6', () => {
    expect(sanitizeDateInput('15/07/90')).toBe('150790');
    expect(sanitizeDateInput('15.07.90.99')).toBe('150790');
    expect(sanitizeDateInput('abc')).toBe('');
  });
});

describe('parseFrenchDate', () => {
  it('rejects strings that are not 6 digits', () => {
    expect(parseFrenchDate('')).toBeNull();
    expect(parseFrenchDate('15079')).toBeNull();
    expect(parseFrenchDate('15/07/90')).toBeNull();
    expect(parseFrenchDate('1a0790')).toBeNull();
  });

  it('rejects impossible months and days', () => {
    expect(parseFrenchDate('150090')).toBeNull(); // month 00
    expect(parseFrenchDate('151390')).toBeNull(); // month 13
    expect(parseFrenchDate('000790')).toBeNull(); // day 00
    expect(parseFrenchDate('320790')).toBeNull(); // day 32
  });

  it('rejects calendar-invalid dates (Feb 31, etc.) via round-trip check', () => {
    expect(parseFrenchDate('310295')).toBeNull(); // 31 Feb 1995
    expect(parseFrenchDate('290223')).toBeNull(); // 29 Feb 2023 (not a leap year)
    expect(parseFrenchDate('310494')).toBeNull(); // 31 Apr 1994
  });

  it('accepts a real birth date and applies the < 50 → 20YY century rule', () => {
    const d = parseFrenchDate('150794');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(1994);
    expect(d!.getMonth()).toBe(6); // July (0-indexed)
    expect(d!.getDate()).toBe(15);
  });

  it('treats AA < 50 as 20YY for EXPIRY dates (25/12/29 → 2029)', () => {
    // Was calling birth mode — which (correctly, post-sliding-window) reads
    // a future year as the previous century. An expiry example must use
    // expiry mode, exactly as Step5/ManualMRZInput do.
    const d = parseFrenchDate('251229', 'expiry');
    expect(d!.getFullYear()).toBe(2029);
  });

  it('treats AA >= 50 as 19YY (e.g. birth 01/01/55 → 1955)', () => {
    const d = parseFrenchDate('010155');
    expect(d!.getFullYear()).toBe(1955);
  });

  it('accepts the user-reported test card birth date 31/12/94', () => {
    const d = parseFrenchDate('311294');
    expect(d!.getFullYear()).toBe(1994);
    expect(d!.getMonth()).toBe(11);
    expect(d!.getDate()).toBe(31);
  });

  it('accepts a Feb 29 leap year', () => {
    const d = parseFrenchDate('290224'); // 29 Feb 2024 — leap year
    expect(d).not.toBeNull();
  });
});

describe('ageInYears', () => {
  const fixedNow = new Date(2026, 3, 25); // 25 April 2026

  it('returns the difference in whole years when the birthday has passed this year', () => {
    expect(ageInYears(new Date(2000, 0, 1), fixedNow)).toBe(26);
  });

  it('subtracts a year when the birthday has not yet occurred this year', () => {
    expect(ageInYears(new Date(2000, 11, 31), fixedNow)).toBe(25);
  });

  it('returns exact age on the birthday itself', () => {
    expect(ageInYears(new Date(2000, 3, 25), fixedNow)).toBe(26);
  });

  it('returns one less the day before the birthday', () => {
    expect(ageInYears(new Date(2000, 3, 26), fixedNow)).toBe(25);
  });
});

describe('isExpired', () => {
  const today = new Date(2026, 3, 25);

  it('returns false for a future expiry', () => {
    expect(isExpired(new Date(2030, 0, 1), today)).toBe(false);
  });

  it('returns true for a past expiry', () => {
    expect(isExpired(new Date(2024, 0, 1), today)).toBe(true);
  });

  it('returns false on the exact expiry day (still valid)', () => {
    expect(isExpired(new Date(2026, 3, 25), today)).toBe(false);
  });

  it('returns true the day after expiry', () => {
    expect(isExpired(new Date(2026, 3, 24), today)).toBe(true);
  });
});

describe('parseMRZDate', () => {
  it('rejects strings that are not 6 digits', () => {
    expect(parseMRZDate('')).toBeNull();
    expect(parseMRZDate('94123')).toBeNull();
    expect(parseMRZDate('94-12-31')).toBeNull();
    expect(parseMRZDate('9a1231')).toBeNull();
  });

  it('rejects impossible months and days', () => {
    expect(parseMRZDate('940013')).toBeNull(); // month 00
    expect(parseMRZDate('941313')).toBeNull(); // month 13
    expect(parseMRZDate('941200')).toBeNull(); // day 00
    expect(parseMRZDate('941232')).toBeNull(); // day 32
  });

  it('rejects calendar-invalid dates via round-trip check', () => {
    expect(parseMRZDate('950231')).toBeNull(); // 31 Feb 1995
    expect(parseMRZDate('230229')).toBeNull(); // 29 Feb 2023 (not a leap year)
    expect(parseMRZDate('940431')).toBeNull(); // 31 Apr 1994
  });

  it("accepts the test card's birth date 941231 → 31 Dec 1994", () => {
    const d = parseMRZDate('941231', 'birth');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(1994);
    expect(d!.getMonth()).toBe(11);
    expect(d!.getDate()).toBe(31);
  });

  it("accepts the test card's expiry 330209 → 9 Feb 2033", () => {
    const d = parseMRZDate('330209', 'expiry');
    expect(d!.getFullYear()).toBe(2033);
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(9);
  });

  describe('century expansion rules', () => {
    it("expiry: 49 → 2049, 50 → 1950 (fixed `>=50` cutoff)", () => {
      expect(parseMRZDate('490101', 'expiry')!.getFullYear()).toBe(2049);
      expect(parseMRZDate('500101', 'expiry')!.getFullYear()).toBe(1950);
    });

    it('birth: sliding century window (future years roll back 100)', () => {
      const now = new Date(2026, 5, 12);
      // The 91-year-old case that bit us (YY=35 used to read 2035):
      expect(parseMRZDate('350101', 'birth', now)!.getFullYear()).toBe(1935);
      expect(parseMRZDate('360101', 'birth', now)!.getFullYear()).toBe(1936);
      // The 80-year-old voter case that bit us earlier (YY=44):
      expect(parseMRZDate('441231', 'birth', now)!.getFullYear()).toBe(1944);
      // Modern voters
      expect(parseMRZDate('070101', 'birth', now)!.getFullYear()).toBe(2007);
      expect(parseMRZDate('990101', 'birth', now)!.getFullYear()).toBe(1999);
    });

    it('birth mode is the default when no mode is passed', () => {
      expect(parseMRZDate('441231')!.getFullYear()).toBe(1944);
    });
  });

  it('accepts a Feb 29 leap year (240229 = 2024)', () => {
    const d = parseMRZDate('240229');
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(29);
  });
});

describe('checkBirthDate', () => {
  const fixedNow = new Date(2026, 3, 25); // 25 April 2026

  it('returns "invalid" for a null date', () => {
    expect(checkBirthDate(null, fixedNow)).toBe('invalid');
  });

  it('returns null for an adult (well over 18)', () => {
    expect(checkBirthDate(new Date(1994, 11, 31), fixedNow)).toBeNull();
  });

  it('returns "underage" for a 17-year-old', () => {
    expect(checkBirthDate(new Date(2008, 11, 31), fixedNow)).toBe('underage');
  });

  it('returns null on the exact 18th birthday', () => {
    expect(checkBirthDate(new Date(2008, 3, 25), fixedNow)).toBeNull();
  });

  it('returns "underage" the day before turning 18', () => {
    expect(checkBirthDate(new Date(2008, 3, 26), fixedNow)).toBe('underage');
  });

  it('returns null for a very old voter (born 1955)', () => {
    expect(checkBirthDate(new Date(1955, 0, 1), fixedNow)).toBeNull();
  });

  it('respects MIN_VOTING_AGE', () => {
    expect(MIN_VOTING_AGE).toBe(18);
  });
});

describe('checkExpiryDate', () => {
  const today = new Date(2026, 3, 25);

  it('returns "invalid" for a null date', () => {
    expect(checkExpiryDate(null, today)).toBe('invalid');
  });

  it('returns null for a future expiry', () => {
    expect(checkExpiryDate(new Date(2033, 1, 9), today)).toBeNull();
  });

  it('returns "expired" for a past expiry', () => {
    expect(checkExpiryDate(new Date(2024, 11, 25), today)).toBe('expired');
  });

  it('returns null on the exact expiry day (still valid)', () => {
    expect(checkExpiryDate(new Date(2026, 3, 25), today)).toBeNull();
  });

  it('returns "expired" the day after expiry', () => {
    expect(checkExpiryDate(new Date(2026, 3, 24), today)).toBe('expired');
  });
});

describe('end-to-end policy: scan-path simulation', () => {
  // Simulates Step5's pipeline: result.fields.birthDate (YYMMDD) → parseMRZDate
  // → checkBirthDate / checkExpiryDate. This is the exact code path that gates
  // advancing to Step 6.
  const today = new Date(2026, 3, 25);

  it('lets a valid French ID card through (Robinson 1994 / 2033)', () => {
    expect(checkBirthDate(parseMRZDate('941231'), today)).toBeNull();
    expect(checkExpiryDate(parseMRZDate('330209', 'expiry'), today)).toBeNull();
  });

  it('flags a 16-year-old card as underage', () => {
    // born 31 Dec 2009 → 16 years old on 25 Apr 2026
    expect(checkBirthDate(parseMRZDate('091231'), today)).toBe('underage');
  });

  it('flags an expired card', () => {
    // expiry 31 Dec 2024
    expect(checkExpiryDate(parseMRZDate('241231'), today)).toBe('expired');
  });
});

describe('birth-date sliding century window (born-1935 bug, reported 2026-06-12)', () => {
  // Fixed reference date for determinism.
  const now = new Date(2026, 5, 12); // 2026-06-12

  it('REGRESSION: born 12/04/1935 (MRZ "350412") is an eligible 91-year-old, not underage', () => {
    expect(expandMrzBirthYear(35, now)).toBe(1935);
    const d = parseMRZDate('350412', 'birth', now);
    expect(d!.getFullYear()).toBe(1935);
    expect(checkBirthDate(d, now)).toBeNull();
  });

  it('the 1927-1935 cohort (ages 91-99) resolves to 19xx and is eligible', () => {
    for (let yy = 27; yy <= 35; yy++) {
      const d = parseMRZDate(`${String(yy).padStart(2, '0')}0701`, 'birth', now);
      expect(d!.getFullYear()).toBe(1900 + yy);
      expect(checkBirthDate(d, now)).toBeNull();
    }
  });

  it('YY ≤ current year resolves to 20YY — the ambiguity is settled in favour of the (vastly more numerous) children', () => {
    // A 2-digit year cannot distinguish a 1910-born (age 116) from a
    // 2010-born (age 16). The sliding window picks the modern reading;
    // the only real-world loss is voters aged exactly 100+ — irreducible
    // without a 4-digit source (DG11 would have it when present).
    for (let yy = 9; yy <= 26; yy++) {
      const d = parseMRZDate(`${String(yy).padStart(2, '0')}0101`, 'birth', now);
      expect(d!.getFullYear()).toBe(2000 + yy);
    }
  });

  it('still correctly rejects actual minors (born 2010 stays 2010)', () => {
    const d = parseMRZDate('100612', 'birth', now);
    expect(d!.getFullYear()).toBe(2010);
    expect(checkBirthDate(d, now)).toBe('underage');
  });

  it('18th birthday today is eligible; tomorrow-18 is not', () => {
    expect(checkBirthDate(parseMRZDate('080612', 'birth', now), now)).toBeNull();
    expect(checkBirthDate(parseMRZDate('080613', 'birth', now), now)).toBe('underage');
  });

  it('date-level window: YY equal to current year but month/day in the future → previous century (centenarian, not future baby)', () => {
    // Born 1 Dec 1926 — "261201" would naively parse as 2026-12-01 (future).
    const d = parseMRZDate('261201', 'birth', now);
    expect(d!.getFullYear()).toBe(1926);
    expect(checkBirthDate(d, now)).toBeNull(); // 99 years old, eligible
  });

  it('irreducible 2-digit ambiguity: born earlier this year parses as a baby (collides with a 100th birthday)', () => {
    const d = parseMRZDate('260101', 'birth', now);
    expect(d!.getFullYear()).toBe(2026); // baby reading wins; a 1926-01-01 centenarian is the one unavoidable loss
    expect(checkBirthDate(d, now)).toBe('underage');
  });

  it("CIRCUIT PARITY: born exactly today flips to the previous century, like Rarimo's EncodedDateIsLessNormalized", () => {
    // The circuit's comparator is STRICT (`date < currentDate` → current
    // century), so a YYMMDD equal to today is normalized to 19xx — i.e. a
    // voter celebrating their 100th birthday today, not a newborn. Mirror
    // that exactly so Step 5's pre-filter predicts the circuit's verdict.
    const d = parseMRZDate('260612', 'birth', now); // == now (2026-06-12)
    expect(d!.getFullYear()).toBe(1926);
    expect(checkBirthDate(d, now)).toBeNull(); // 100 today → eligible
  });

  it('CIRCUIT PARITY holds regardless of the scan time of day', () => {
    const lateInTheDay = new Date(2026, 5, 12, 23, 45);
    expect(parseMRZDate('260612', 'birth', lateInTheDay)!.getFullYear()).toBe(1926);
    expect(parseMRZDate('260611', 'birth', lateInTheDay)!.getFullYear()).toBe(2026); // yesterday → baby
  });

  it('century shift preserves Feb-29 validity (2028→1928, both leap)', () => {
    const d = parseMRZDate('280229', 'birth', now);
    expect(d!.getFullYear()).toBe(1928);
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(29);
  });

  it('window slides with the clock: in 2030, YY=31 means 1931 and YY=29 a recent child', () => {
    const later = new Date(2030, 5, 1);
    expect(parseMRZDate('310101', 'birth', later)!.getFullYear()).toBe(1931); // 99yo, eligible
    expect(parseMRZDate('290101', 'birth', later)!.getFullYear()).toBe(2029); // 1-year-old
  });

  it('expiry mode is untouched by the sliding window (fixed >=50 rule)', () => {
    expect(parseMRZDate('291225', 'expiry', now)!.getFullYear()).toBe(2029);
    expect(parseMRZDate('550101', 'expiry', now)!.getFullYear()).toBe(1955);
  });
});
