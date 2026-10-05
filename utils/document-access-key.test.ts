import {
  CAN_LENGTH,
  describeAccessKey,
  isValidCan,
  sanitizeCanInput,
  toScanParameters,
} from './document-access-key';

describe('isValidCan', () => {
  it('accepts exactly six digits', () => {
    expect(CAN_LENGTH).toBe(6);
    expect(isValidCan('123456')).toBe(true);
    expect(isValidCan('000000')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidCan('')).toBe(false);
    expect(isValidCan('12345')).toBe(false);
    expect(isValidCan('1234567')).toBe(false);
    expect(isValidCan('12345a')).toBe(false);
    expect(isValidCan(' 123456')).toBe(false);
  });
});

describe('sanitizeCanInput', () => {
  it('keeps digits only and clamps to six', () => {
    expect(sanitizeCanInput('12 34 56')).toBe('123456');
    expect(sanitizeCanInput('1234567')).toBe('123456');
    expect(sanitizeCanInput('ab')).toBe('');
  });
});

describe('toScanParameters', () => {
  it('passes only the CAN for an ID card, so the module runs PACE with it', () => {
    expect(toScanParameters({ kind: 'can', can: '123456' })).toEqual({ can: '123456' });
  });

  it('passes the three MRZ fields for a passport', () => {
    expect(
      toScanParameters({ kind: 'mrz', documentNumber: '12AB34567', birthDate: '900715', expiryDate: '291225' }),
    ).toEqual({ documentNumber: '12AB34567', dateOfBirth: '900715', dateOfExpiry: '291225' });
  });
});

describe('describeAccessKey', () => {
  it('names the kind and never the value', () => {
    expect(describeAccessKey({ kind: 'can', can: '123456' })).toBe('can');
    expect(describeAccessKey({ kind: 'mrz', documentNumber: 'X', birthDate: 'Y', expiryDate: 'Z' })).toBe('mrz');
    expect(describeAccessKey(null)).toBe('none');
    expect(describeAccessKey(undefined)).toBe('none');
  });
});
