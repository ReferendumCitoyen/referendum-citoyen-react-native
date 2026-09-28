/**
 * Materialise an expo-asset to disk and GUARANTEE the file actually exists.
 *
 * Why this exists
 * ---------------
 * Expo Asset unpacks bundled binaries (query_identity.dat, the Groth16
 * zkey, …) into the app's `cacheDirectory` as `ExponentAsset-<hash>.<ext>`.
 * Android may purge that directory at any time under storage pressure —
 * observed in production (error report 2026-06-12T11-05): the .dat vanished
 * BETWEEN two vote attempts, `readAsStringAsync` failed with ENOENT, and it
 * never self-healed because expo-asset's in-memory `downloaded` flag still
 * said true, so `downloadAsync()` no-opped. Only an app restart recovered.
 *
 * This helper existence-checks the materialised file and, when it has been
 * evicted, clears the memoised state and re-extracts once.
 */
import * as FileSystem from 'expo-file-system/legacy';

/** Structural subset of expo-asset's Asset used here — also what tests fake. */
export interface AssetLike {
  localUri: string | null;
  downloaded: boolean;
  downloadAsync(): Promise<unknown>;
}

interface FsLike {
  getInfoAsync(uri: string): Promise<{ exists: boolean }>;
}

export async function ensureAssetOnDisk(
  asset: AssetLike,
  label: string,
  fs: FsLike = FileSystem,
): Promise<string> {
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  if (asset.localUri) {
    const info = await fs.getInfoAsync(asset.localUri);
    if (info.exists) return asset.localUri;

    // The OS evicted the extracted file (Android cache purge). Clear the
    // memoised state so downloadAsync() actually re-extracts instead of
    // short-circuiting on `downloaded === true`.
    console.warn(`[asset-on-disk] ${label}: cached file evicted by the OS — re-extracting`);
    asset.downloaded = false;
    asset.localUri = null;
    await asset.downloadAsync();

    if (asset.localUri) {
      const again = await fs.getInfoAsync(asset.localUri);
      if (again.exists) return asset.localUri;
    }
  }
  throw new Error(
    `[asset-on-disk] failed to materialise ${label} on disk (cache evicted and re-extract failed)`,
  );
}
