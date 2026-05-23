import { isExpectedError } from './error-reporter';

describe('isExpectedError', () => {
  it.each([
    ['Passeport expiré'],
    ['passport expired'],
    ['CAN ou MRZ incorrect'],
    ['BAC failed'],
    ['Aucun document détecté'],
    ['Lecture annulée par l\'utilisateur'],
    ['already voted'],
    ['Proposal closed'],
    ['proposal not active'],
    ['Nullifier already used'],
    ['Network request failed'],
    ['offline'],
    ['AbortError: aborted'],
    ['User cancelled'],
  ])('classifies %p as expected', (msg) => {
    expect(isExpectedError(new Error(msg))).toBe(true);
  });

  it.each([
    ['UnsatisfiedLinkError: dlopen failed'],
    ['Cannot read properties of undefined'],
    ['TypeError: not iterable'],
    ['proof generation failed: array length mismatch'],
    [''],
  ])('classifies %p as unexpected', (msg) => {
    expect(isExpectedError(new Error(msg))).toBe(false);
  });

  it('accepts plain strings', () => {
    expect(isExpectedError('already voted')).toBe(true);
    expect(isExpectedError('boom')).toBe(false);
  });

  it('accepts unknown shape and returns false', () => {
    expect(isExpectedError(undefined)).toBe(false);
    expect(isExpectedError(null)).toBe(false);
    expect(isExpectedError(42)).toBe(false);
  });
});
