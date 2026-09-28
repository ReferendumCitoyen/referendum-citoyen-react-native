import { ConsecutiveReads, mrzReadKey, REQUIRED_CONSECUTIVE_READS } from './mrz-agreement';

const A = mrzReadKey({ documentNumber: '12AB34567', dateOfBirth: '900101', dateOfExpiry: '300101' });
// One digit off — the shape of the read that slipped through on build 16.
const B = mrzReadKey({ documentNumber: '12AB34561', dateOfBirth: '900101', dateOfExpiry: '300101' });

describe('ConsecutiveReads', () => {
  it('requires two identical reads', () => {
    expect(REQUIRED_CONSECUTIVE_READS).toBe(2);
    const reads = new ConsecutiveReads();
    expect(reads.record(A)).toBe(false);
    expect(reads.record(A)).toBe(true);
  });

  it('a different read in between starts the count over', () => {
    const reads = new ConsecutiveReads();
    expect(reads.record(A)).toBe(false);
    expect(reads.record(B)).toBe(false);
    expect(reads.record(A)).toBe(false);
    expect(reads.record(A)).toBe(true);
  });

  it('a lone wrong read never gets through on its own', () => {
    const reads = new ConsecutiveReads();
    reads.record(A);
    expect(reads.record(B)).toBe(false);
  });

  it('reset() forgets the previous read', () => {
    const reads = new ConsecutiveReads();
    reads.record(A);
    reads.reset();
    expect(reads.record(A)).toBe(false);
  });

  it('keeps reporting true while the same read keeps coming', () => {
    const reads = new ConsecutiveReads();
    reads.record(A);
    reads.record(A);
    expect(reads.record(A)).toBe(true);
  });

  it('honours a higher requirement', () => {
    const reads = new ConsecutiveReads(3);
    expect(reads.record(A)).toBe(false);
    expect(reads.record(A)).toBe(false);
    expect(reads.record(A)).toBe(true);
  });
});

describe('mrzReadKey', () => {
  it('differs when any of the three fields differs', () => {
    expect(A).not.toBe(B);
    expect(mrzReadKey({ documentNumber: '12AB34567', dateOfBirth: '900102', dateOfExpiry: '300101' })).not.toBe(A);
    expect(mrzReadKey({ documentNumber: '12AB34567', dateOfBirth: '900101', dateOfExpiry: '300102' })).not.toBe(A);
  });
});
