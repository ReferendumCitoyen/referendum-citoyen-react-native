/**
 * What these protect: the rule that turns a chip's DG11 into the one value a
 * person's passport and ID card must agree on. Get it wrong in either
 * direction and the failure is silent — too loose and two people share a key
 * (one of them is refused at the ballot); too strict and one person's two
 * documents diverge (they vote twice). Neither throws.
 *
 * The synthetic cases below pin each normalisation rule individually.
 */

import {
  canonicalPersonString,
  computePersonKey,
  normalisePersonName,
  normalisePlaceOfBirth,
  personKeyFromCanonical,
  PERSON_KEY_VERSION,
} from './universal-person-key';

// --- synthetic DG11 -----------------------------------------------------

const utf8hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
const tlv = (tag: string, value: string) => {
  const v = utf8hex(value);
  const len = v.length / 2;
  const l = len < 0x80 ? len.toString(16).padStart(2, '0') : '81' + len.toString(16).padStart(2, '0');
  return tag + l + v;
};
/** A DG11 carrying exactly the three fields the person key reads. */
function dg11(name: string, dob: string, place: string): Uint8Array {
  const body = tlv('5f0e', name) + tlv('5f2b', dob) + tlv('5f11', place);
  const len = body.length / 2;
  const l = len < 0x80 ? len.toString(16).padStart(2, '0') : '81' + len.toString(16).padStart(2, '0');
  return new Uint8Array(Buffer.from('6b' + l + body, 'hex'));
}

describe('normalisePersonName — validate_pairs.py::norm_name', () => {
  it('uppercases, folds accents, and turns filler and hyphens into spaces', () => {
    expect(normalisePersonName('DOE<<ÉMILIE<ANNE<MARIE-CLAIRE')).toBe('DOE EMILIE ANNE MARIE CLAIRE');
  });
  it('collapses runs of whitespace and trims', () => {
    expect(normalisePersonName('  de<<DOE   SMITH ')).toBe('DE DOE SMITH');
  });
  it('reconciles a particle cased and hyphenated differently on the two documents', () => {
    // 'de DOE-SMITH' on the card vs 'DE DOE SMITH' on the passport:
    // uppercase + dash→space reconcile them.
    expect(normalisePersonName('de DOE-SMITH')).toBe(normalisePersonName('DE DOE SMITH'));
  });
});

describe('normalisePlaceOfBirth — validate_pairs.py::norm_pob', () => {
  it('keeps only the text before the first <, which drops the département', () => {
    expect(normalisePlaceOfBirth('AIX-EN-PROVENCE<13')).toBe('AIX EN PROVENCE');
  });
  it('and drops the passport country suffix the same way', () => {
    expect(normalisePlaceOfBirth('AIX-EN-PROVENCE<<FRANCE')).toBe('AIX EN PROVENCE');
    expect(normalisePlaceOfBirth('AIX-EN-PROVENCE')).toBe('AIX EN PROVENCE');
  });
  it('folds accents on the place too', () => {
    expect(normalisePlaceOfBirth('SAINT-ÉMILION<33')).toBe('SAINT EMILION');
  });
});

describe('canonicalPersonString', () => {
  it('is NAME|YYYYMMDD|PLACE', () => {
    expect(
      canonicalPersonString({ nameOfHolderRaw: 'DOE<<JANE', dateOfBirthRaw: '19900102', placeOfBirthRaw: 'LYON<69' }),
    ).toBe('DOE JANE|19900102|LYON');
  });

  it('agrees across a card and a passport for the same person', () => {
    const card = canonicalPersonString({ nameOfHolderRaw: 'de DOE-SMITH<<JEANNE', dateOfBirthRaw: '19700101', placeOfBirthRaw: 'PARIS<75' });
    const pass = canonicalPersonString({ nameOfHolderRaw: 'DE DOE SMITH<<JEANNE', dateOfBirthRaw: '19700101', placeOfBirthRaw: 'PARIS<<FRANCE' });
    expect(card).toBe(pass);
  });

  it('refuses rather than guesses when a field is missing', () => {
    expect(canonicalPersonString({ nameOfHolderRaw: null, dateOfBirthRaw: '19900102', placeOfBirthRaw: 'LYON' })).toBeNull();
    expect(canonicalPersonString({ nameOfHolderRaw: 'DOE', dateOfBirthRaw: null, placeOfBirthRaw: 'LYON' })).toBeNull();
    expect(canonicalPersonString({ nameOfHolderRaw: 'DOE', dateOfBirthRaw: '19900102', placeOfBirthRaw: null })).toBeNull();
  });

  it('refuses a date that is not YYYYMMDD', () => {
    // The MRZ form. Accepting it would make a key that never matches the
    // other document's full date.
    expect(canonicalPersonString({ nameOfHolderRaw: 'DOE', dateOfBirthRaw: '900102', placeOfBirthRaw: 'LYON' })).toBeNull();
  });

  it('refuses a name that did not decode cleanly', () => {
    // U+FFFD means the UTF-8 was invalid and got substituted. A key from a
    // mangled name silently fails to match — worse than no key.
    expect(canonicalPersonString({ nameOfHolderRaw: 'DO�E', dateOfBirthRaw: '19900102', placeOfBirthRaw: 'LYON' })).toBeNull();
  });

  it('refuses a place that is entirely filler', () => {
    expect(canonicalPersonString({ nameOfHolderRaw: 'DOE', dateOfBirthRaw: '19900102', placeOfBirthRaw: '<<<' })).toBeNull();
  });
});

describe('personKeyFromCanonical', () => {
  it('is 64 lowercase hex, domain-separated by version', () => {
    const k = personKeyFromCanonical('DOE JANE|19900102|LYON');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(PERSON_KEY_VERSION).toBe('RC-PERSON-KEY-v1');
  });
  it('is deterministic and sensitive to every field', () => {
    const a = personKeyFromCanonical('DOE JANE|19900102|LYON');
    expect(personKeyFromCanonical('DOE JANE|19900102|LYON')).toBe(a);
    expect(personKeyFromCanonical('DOE JANE|19900103|LYON')).not.toBe(a);
    expect(personKeyFromCanonical('DOE JANE|19900102|PARIS')).not.toBe(a);
    expect(personKeyFromCanonical('DOE JEAN|19900102|LYON')).not.toBe(a);
  });
});

describe('computePersonKey — end to end from bytes', () => {
  it('links a card and a passport for the same person', () => {
    const card = computePersonKey(dg11('DOE<<ÉMILIE<ANNE<MARIE-CLAIRE', '19700101', 'AIX-EN-PROVENCE<13'));
    const pass = computePersonKey(dg11('DOE<<EMILIE<ANNE<MARIE CLAIRE', '19700101', 'AIX-EN-PROVENCE<<FRANCE'));
    expect(card).not.toBeNull();
    expect(card).toBe(pass);
  });

  it('separates two people who differ only in birthplace', () => {
    const a = computePersonKey(dg11('MARTIN<<JEAN', '19700101', 'LYON'));
    const b = computePersonKey(dg11('MARTIN<<JEAN', '19700101', 'PARIS'));
    expect(a).not.toBe(b);
  });

  it('returns null for no DG11 and for garbage, never throws', () => {
    expect(computePersonKey(undefined)).toBeNull();
    expect(computePersonKey(null)).toBeNull();
    expect(computePersonKey(new Uint8Array(0))).toBeNull();
    expect(computePersonKey(new Uint8Array([0x6b]))).toBeNull();
    expect(computePersonKey(new Uint8Array([0xff, 0xff, 0xff]))).toBeNull();
  });

  it('platform check: String.prototype.normalize exists and folds', () => {
    // Hermes gained normalize() in RN 0.70. If this ever fails on a device
    // build, accents stop folding and every accented name splits its key.
    expect('É'.normalize('NFKD').length).toBe(2);
    expect(normalisePersonName('É')).toBe('E');
  });
});
