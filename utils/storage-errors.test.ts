import { isStorageFullError } from './storage-errors';

describe('isStorageFullError', () => {
  it('matches the real iOS ENOSPC during trusted-setup download (reports 2026-06-11)', () => {
    expect(
      isStorageFullError(
        new Error(
          'Unable to download file: Error Domain=NSPOSIXErrorDomain Code=28 "No space left on device" UserInfo={NSErrorFailingURLStringKey=https://storage.googleapis.com/rarimo-store/trusted-setups/ultraPlonkTrustedSetup.dat}',
        ),
      ),
    ).toBe(true);
  });

  it('matches Android ENOSPC / SQLite disk-full variants', () => {
    expect(isStorageFullError(new Error('write failed: ENOSPC (No space left on device)'))).toBe(true);
    expect(isStorageFullError(new Error('database or disk is full (code 13 SQLITE_FULL)'))).toBe(true);
  });

  it('matches out-of-memory variants (Android witnesscalc OOM)', () => {
    expect(isStorageFullError(new Error('java.lang.OutOfMemoryError: Failed to allocate'))).toBe(true);
    expect(isStorageFullError(new Error('out of memory'))).toBe(true);
  });

  it('does NOT match network / server / logic errors', () => {
    expect(isStorageFullError(new Error('Network request failed'))).toBe(false);
    expect(isStorageFullError(new Error('[submitVote] relayer 500 : {"errors":[…]}'))).toBe(false);
    expect(isStorageFullError(new Error('Software caused connection abort'))).toBe(false);
    expect(isStorageFullError(null)).toBe(false);
    expect(isStorageFullError(undefined)).toBe(false);
  });
});
