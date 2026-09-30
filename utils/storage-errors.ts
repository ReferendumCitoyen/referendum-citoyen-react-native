/**
 * Detect device-resource exhaustion: disk full (the common case — the Noir
 * trusted setup is ~300 MB and the Groth16 zkey ~757 MB) or out-of-memory.
 *
 * Why this matters
 * ----------------
 * iOS surfaces a full disk as `NSPOSIXErrorDomain Code=28 "No space left on
 * device"` buried inside an NSError dump; Android as `ENOSPC` or
 * `SQLITE_FULL`; witnesscalc as `java.lang.OutOfMemoryError`. Users were shown
 * that raw soup (error reports 2026-06-11). These failures are NOT retryable
 * — the circuit-preload backoff loop must abort instead of re-downloading
 * 300 MB onto a full disk, and the UI must say "free up space" rather than
 * "try again later".
 */
export function isStorageFullError(err: unknown): boolean {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return false;
  const msg = raw.toLowerCase();

  // Disk full: iOS POSIX code 28, Android/Linux ENOSPC, SQLite.
  if (
    msg.includes('no space left on device') ||
    msg.includes('enospc') ||
    msg.includes('sqlite_full') ||
    msg.includes('disk is full')
  ) {
    return true;
  }

  // RAM exhaustion (e.g. witnesscalc on low-memory devices).
  if (msg.includes('outofmemoryerror') || msg.includes('out of memory')) {
    return true;
  }

  return false;
}
