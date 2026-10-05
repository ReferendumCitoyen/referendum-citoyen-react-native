import { parseDg11 } from '@/utils/e-document/dg11';

const hex = (s: string) => new Uint8Array(Buffer.from(s.replace(/\s/g, ''), 'hex'));

describe('parseDg11', () => {
  it('extracts personal number (5F10) and place of birth (5F11)', () => {
    // 6B = DG11 tag (constructed). 5C = tag list. 5F10 = personal number,
    // 5F11 = place of birth (ICAO 9303 part 10). Lengths are the real BER
    // lengths — the parser honours them, so they must be exact.
    const dg11 = hex(
      '6B' + '1F' +
      '5C04' + '5F105F11' +
      '5F10' + '06' + '313233343536' +          // "123456"
      '5F11' + '0D' + '5041524953' + '3C3C4652414E4345' // "PARIS<<FRANCE"
    );
    expect(parseDg11(dg11)).toMatchObject({ personalNumber: '123456', placeOfBirth: 'PARIS FRANCE' });
  });

  it('returns nulls when fields absent', () => {
    expect(parseDg11(hex('6B025C00'))).toEqual({
      personalNumber: null,
      placeOfBirth: null,
      nameOfHolderRaw: null,
      dateOfBirthRaw: null,
      placeOfBirthRaw: null,
    });
  });

  it('exposes name (5F0E), full DOB (5F2B) and place (5F11) untouched for the person key', () => {
    // The raw fields must keep the `<` — the person key truncates place of
    // birth at the first one, and would lose that boundary if handed the
    // cleaned value. Name keeps its accent: 'É' is C3 89 in UTF-8.
    // Lengths are exact BER lengths, counted in BYTES: "DOE<<SÉRAPHINE" is 15
    // (É is two bytes, C3 89), so 0x0F, not its 14 characters. The parser
    // honours the length, so an over-count reads the next tag into the name.
    const dg11 = hex(
      '6B' + '28' +
      '5F0E' + '0F' + '444F45' + '3C3C' + '53C38952' + '41504849' + '4E45' +   // "DOE<<SÉRAPHINE" (15 B)
      '5F2B' + '08' + '3139373030313031' +                                     // "19700101"
      '5F11' + '08' + '5041524953' + '3C3735',                                 // "PARIS<75"
    );
    const f = parseDg11(dg11);
    expect(f.nameOfHolderRaw).toBe('DOE<<SÉRAPHINE');
    expect(f.dateOfBirthRaw).toBe('19700101');
    expect(f.placeOfBirthRaw).toBe('PARIS<75');
    // and the display value still applies the old rule
    expect(f.placeOfBirth).toBe('PARIS 75');
  });

  it('does not hang or throw on truncated / garbage input', () => {
    expect(() => parseDg11(hex('6B'))).not.toThrow();
    expect(() => parseDg11(hex('5F10'))).not.toThrow();
    expect(() => parseDg11(hex('6B7F5F108F'))).not.toThrow();
    expect(() => parseDg11(new Uint8Array(0))).not.toThrow();
    expect(() => parseDg11(hex('FFFFFFFF'))).not.toThrow();
  });

  it('handles long-form length encoding', () => {
    // 5F10 with 0x81 long-form length = 6 bytes
    expect(parseDg11(hex('6B0B' + '5F10' + '8106' + '414243444546')).personalNumber).toBe('ABCDEF');
  });
});
