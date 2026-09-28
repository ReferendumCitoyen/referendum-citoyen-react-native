import { Buffer } from 'buffer';

// Minimal BER-TLV walker for DG11 (additional personal details — personal
// number, place of birth). No crypto deps: DG11 is plaintext, unlike DG1/SOD
// which need the full ASN.1/CMS parsing in e-document.ts.

const parseTlvMap = (bytes: Uint8Array): Map<string, Uint8Array> => {
  const map = new Map<string, Uint8Array>();

  const walk = (start: number, end: number) => {
    let i = start;
    while (i < end) {
      const tagStart = i;
      const first = bytes[i++];
      // Multi-byte tag: low 5 bits all set -> continuation while high bit set.
      if ((first & 0x1f) === 0x1f) {
        while (i < end && bytes[i] & 0x80) i++;
        i++;
      }
      const tag = Array.from(bytes.subarray(tagStart, i))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const constructed = (first & 0x20) === 0x20;

      if (i >= end) break;
      let len = bytes[i++];
      if (len & 0x80) {
        const n = len & 0x7f;
        len = 0;
        for (let k = 0; k < n && i < end; k++) len = (len << 8) | bytes[i++];
      }
      const valStart = i;
      const valEnd = Math.min(valStart + len, end);
      if (constructed) walk(valStart, valEnd);
      else if (!map.has(tag)) map.set(tag, bytes.subarray(valStart, valEnd));
      i = valEnd;
    }
  };

  walk(0, bytes.length);
  return map;
};

const tlvText = (map: Map<string, Uint8Array>, tag: string): string | null => {
  const val = map.get(tag);
  if (!val) return null;
  return Buffer.from(val).toString('utf8');
};

// Strip MRZ filler (<), collapse whitespace.
const cleanText = (value: string | null): string | null => {
  if (value == null) return null;
  const cleaned = value.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length ? cleaned : null;
};

export interface Dg11Fields {
  personalNumber: string | null;
  /** 5F11 with `<` replaced by spaces — a display value. */
  placeOfBirth: string | null;

  // --- Raw fields, exactly as stored on the chip ---------------------------
  // The universal person key (utils/universal-person-key.ts) applies its own
  // normalisation and it is NOT the `cleanText` rule above: place of birth
  // must be truncated at the first `<`, not have the `<` replaced. Handing it
  // the cleaned value would erase the boundary it needs. These carry the
  // bytes decoded and nothing else.

  /** 5F0E, name of holder. Full name with accents — the one field the MRZ
   *  truncates and this does not. */
  nameOfHolderRaw: string | null;
  /** 5F2B, full date of birth, YYYYMMDD. The MRZ carries only YYMMDD. */
  dateOfBirthRaw: string | null;
  /** 5F11 untouched. On a French ID card this is `CITY<DÉPARTEMENT`; on a
   *  passport `CITY` or `CITY<<COUNTRY`. The text before the first `<` is what
   *  the two documents agree on. */
  placeOfBirthRaw: string | null;
}

export function parseDg11(bytes: Uint8Array): Dg11Fields {
  const map = parseTlvMap(bytes);
  return {
    personalNumber: cleanText(tlvText(map, '5f10')),
    placeOfBirth: cleanText(tlvText(map, '5f11')),
    nameOfHolderRaw: tlvText(map, '5f0e'),
    dateOfBirthRaw: tlvText(map, '5f2b'),
    placeOfBirthRaw: tlvText(map, '5f11'),
  };
}
