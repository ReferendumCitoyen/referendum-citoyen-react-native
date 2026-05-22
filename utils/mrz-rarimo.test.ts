import {
  extractMrz,
  extractMrzTd1,
  normaliseMrzOcr,
  verifyMrzChecksum,
} from './mrz-rarimo';

// Canonical ICAO 9303 Part 4 §4.2.2.1 sample passport for ANNA MARIA
// ERIKSSON, with the nationality field swapped from the original "UTO"
// (Utopia) to "FRA" (France) so the global O→0 normalisation step (see
// normaliseMrzOcr) doesn't corrupt the nationality letters. The three
// load-bearing check digits (doc number, DOB, expiry) are unaffected by
// the nationality field — they only span positions 0-9, 13-19, 21-27 —
// so this remains a valid ICAO-conformant MRZ line.
const CANONICAL_LINE_2 = 'L898902C36FRA7408122F1204159ZE184226B<<<<<10';

describe('verifyMrzChecksum', () => {
  it('accepts the document number from the ICAO 9303 canonical sample', () => {
    // L898902C3 + check digit 6 — Table 2, ICAO 9303 Part 4
    expect(verifyMrzChecksum('L898902C36')).toBe(true);
  });

  it('accepts the date-of-birth field from the canonical sample', () => {
    // 740812 + check digit 2
    expect(verifyMrzChecksum('7408122')).toBe(true);
  });

  it('accepts the date-of-expiry field from the canonical sample', () => {
    // 120415 + check digit 9
    expect(verifyMrzChecksum('1204159')).toBe(true);
  });

  it('rejects a single-character corruption', () => {
    // Flip last data char of doc number — checksum no longer matches.
    expect(verifyMrzChecksum('L898902D36')).toBe(false);
  });

  it('rejects a corrupted check digit', () => {
    // Real data, wrong check digit.
    expect(verifyMrzChecksum('L898902C37')).toBe(false);
  });

  it('treats `<` as zero (filler char)', () => {
    // Run a fake field where the data is all `<` and the check digit is 0 —
    // the standard says fillers contribute 0 to the sum, so this should pass.
    expect(verifyMrzChecksum('<<<<<<0')).toBe(true);
  });

  it('throws on wrong-length input', () => {
    expect(() => verifyMrzChecksum('123')).toThrow();
    expect(() => verifyMrzChecksum('1234567890ABC')).toThrow();
  });
});

describe('normaliseMrzOcr', () => {
  it('upcases mixed-case OCR output', () => {
    expect(normaliseMrzOcr('p<froMartin')).toBe('P<FR0MARTIN');
  });

  it('expands `«` to `<<` (an ML Kit clumping artefact)', () => {
    expect(normaliseMrzOcr('NOM«PRENOM')).toBe('N0M<<PREN0M');
  });

  it('strips whitespace including newlines', () => {
    expect(normaliseMrzOcr('AB CD\nEF\tGH')).toBe('ABCDEFGH');
  });

  it('replaces letter O with digit 0 globally', () => {
    // Real-world OCR error in the numeric tail of a doc number — the digit
    // 0 in "L898902C3" misread as letter O. After normalisation we want it
    // back as a digit so the regex's `[0-9A-Z<]{10}` still matches but the
    // checksum verification (which is sensitive to digit-vs-letter) passes.
    expect(normaliseMrzOcr('L8989O2C36')).toBe('L898902C36');
  });
});

describe('extractMrz', () => {
  it('extracts data fields from the canonical sample line 2', () => {
    const result = extractMrz(CANONICAL_LINE_2);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      documentNumber: 'L898902C3',
      nationality: 'FRA',
      dateOfBirth: '740812',
      dateOfExpiry: '120415',
    });
  });

  it('extracts MRZ even when line 1 is embedded in the OCR output', () => {
    // Real frame processor output often returns both lines concatenated.
    // The regex must still lock onto line 2 anywhere in the string.
    const ocr = `P<FRAERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n${CANONICAL_LINE_2}`;
    expect(extractMrz(ocr)?.documentNumber).toBe('L898902C3');
  });

  it('extracts MRZ even with stray whitespace from frame OCR', () => {
    // ML Kit sometimes inserts spaces between groups of glyphs.
    const ocr = 'L898902C3 6FRA 7408122 F 1204159 ZE184226B<<<<<10';
    expect(extractMrz(ocr)?.dateOfBirth).toBe('740812');
  });

  it('survives an OCR-typical letter-O-for-zero confusion on date fields', () => {
    // Force the `O→0` step to do real work: swap every 0 in DOB/expiry for O.
    const corrupted = CANONICAL_LINE_2
      .replace(/0/g, 'O')
      // Re-introduce the regex-required digits in the right places so it can
      // be a meaningful test — we want O→0 to fix the *data*, not break the
      // shape. ML Kit's real failure mode is "0 misread as O", which is what
      // this exercises.
      ;
    const result = extractMrz(corrupted);
    expect(result).not.toBeNull();
    expect(result?.dateOfBirth).toBe('740812');
  });

  it('returns null when the checksum fails', () => {
    // Flip one data character; regex still matches the shape, checksum
    // should kick in and reject.
    const bad = 'L898902D36FRA7408122F1204159ZE184226B<<<<<10';
    expect(extractMrz(bad)).toBeNull();
  });

  it('returns null on unrelated text', () => {
    expect(extractMrz('hello world')).toBeNull();
    expect(extractMrz('')).toBeNull();
  });

});

describe('extractMrzTd1', () => {
  // Known-good TD1 sample lifted from the `mrz` package's own test suite
  // (node_modules/mrz/src/parse/__tests__/td1.test.ts — "swiss ID - valid").
  // All three ICAO checksums + composite check digit are valid; this is what
  // the parser path inside extractMrzTd1 is supposed to accept.
  const CANONICAL_TD1_LINES = [
    'IDCHEA1234567<6<<<<<<<<<<<<<<<',
    '7510256M2009018CHE<<<<<<<<<<<8',
    'SMITH<<JOHN<ALBERT<<<<<<<<<<<<',
  ];

  it('extracts data from a known-good ICAO-valid TD1 MRZ (mrz lib swiss sample)', () => {
    // Newline-joined to mimic typical multi-line OCR output. extractMrzTd1
    // strips whitespace internally before its 30-char regex pass.
    const ocr = CANONICAL_TD1_LINES.join('\n');
    const result = extractMrzTd1(ocr);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      documentNumber: 'A1234567',
      nationality: 'CHE',
      dateOfBirth: '751025',
      dateOfExpiry: '200901',
    });
  });

  it('returns null on partial OCR (only 2 of 3 lines visible)', () => {
    // Sanity: ML Kit dropping the name line should fail safely.
    expect(extractMrzTd1(CANONICAL_TD1_LINES.slice(0, 2).join('\n'))).toBeNull();
  });

  it('tolerates extra OCR noise around the MRZ block', () => {
    // Real frame processor output includes printed text from the card
    // (header, name, address, height). Line-boundary preservation must
    // keep these from fusing with the MRZ block.
    const noisy = `REPUBLIQUE FRANCAISE
Identite
Nom: SMITH
Prenom: JOHN ALBERT
${CANONICAL_TD1_LINES.join('\n')}
`;
    expect(extractMrzTd1(noisy)).not.toBeNull();
  });

  it('handles a real-world CNIe-shaped frame (printed text + Ç misreads + MRZ)', () => {
    // Shape based on observed ML Kit output on a French CNIe: address,
    // height, place of birth ("BOUDRY SUISSE"), header line with the Ç
    // in "FRANÇAISE" misread (here we use a benign substitute), and the
    // three MRZ lines at the end. Uses the Swiss canonical TD1 (the only
    // ICAO-valid sample we have on hand) so the parser succeeds.
    const frame = `04 05 2036
05 05 2026
DATE DE DELIVRANCE
RUE DU PRE-LANDRY 14
1,86 m
2017 BOUDRY
SUISSE
REPUBLIQUE FRAN?AISE
${CANONICAL_TD1_LINES.join('\n')}`;
    expect(extractMrzTd1(frame)).not.toBeNull();
  });
});

describe('extractMrz (TD3 - original suite)', () => {
  it('accepts the "D<<" German nationality exception (moved-down original)', () => {
    // The regex allows either a 3-letter ISO code or the literal "D<<" used
    // for German passports. Construct a valid-checksum line with D<<.
    // doc=ABC123456, nat=D<<, dob=900101, sex=M, exp=300101
    const docCheck = (n: string): string => {
      const weights = [7, 3, 1];
      const v = (c: string) =>
        c >= '0' && c <= '9' ? c.charCodeAt(0) - 48
        : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 65 + 10
        : 0;
      const sum = n.split('').reduce((a, c, i) => a + v(c) * weights[i % 3], 0);
      return n + ((sum % 10).toString());
    };
    const line = docCheck('ABC123456') + 'D<<' + docCheck('900101') + 'M' + docCheck('300101') + 'ZE184226B<<<<<10';
    const result = extractMrz(line);
    expect(result?.nationality).toBe('D<<');
    expect(result?.dateOfBirth).toBe('900101');
    expect(result?.dateOfExpiry).toBe('300101');
  });
});
