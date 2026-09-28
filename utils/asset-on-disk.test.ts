import { ensureAssetOnDisk, type AssetLike } from './asset-on-disk';

const makeFakes = (opts: {
  initialLocalUri?: string | null;
  /** Sequence of existence answers for successive getInfoAsync calls. */
  exists: boolean[];
  /** What downloadAsync sets localUri to (null = stays unset). */
  downloadSets?: string | null;
}) => {
  let existsCalls = 0;
  const asset: AssetLike & { downloads: number } = {
    localUri: opts.initialLocalUri ?? null,
    downloaded: opts.initialLocalUri != null,
    downloads: 0,
    async downloadAsync() {
      this.downloads++;
      if (opts.downloadSets !== null) {
        this.localUri = opts.downloadSets ?? 'file:///cache/asset.dat';
        this.downloaded = true;
      }
    },
  };
  const fs = {
    async getInfoAsync(_uri: string) {
      return { exists: opts.exists[Math.min(existsCalls++, opts.exists.length - 1)] };
    },
  };
  return { asset, fs };
};

describe('ensureAssetOnDisk', () => {
  it('returns the localUri when the file is already materialised and on disk', async () => {
    const { asset, fs } = makeFakes({ initialLocalUri: 'file:///cache/a.dat', exists: [true] });
    await expect(ensureAssetOnDisk(asset, 'a.dat', fs)).resolves.toBe('file:///cache/a.dat');
    expect(asset.downloads).toBe(0);
  });

  it('materialises the asset when localUri is not yet set', async () => {
    const { asset, fs } = makeFakes({ initialLocalUri: null, exists: [true] });
    await expect(ensureAssetOnDisk(asset, 'a.dat', fs)).resolves.toBe('file:///cache/asset.dat');
    expect(asset.downloads).toBe(1);
  });

  it('EVICTION (report 2026-06-12T11-05): localUri set but file gone → resets state and re-extracts', async () => {
    // Android purged cacheDirectory between two vote attempts; expo-asset's
    // in-memory `downloaded` flag still says true so a plain downloadAsync()
    // would no-op. The helper must clear the memoised state first.
    const { asset, fs } = makeFakes({
      initialLocalUri: 'file:///cache/ExponentAsset-babcdc.dat',
      exists: [false, true],
    });
    await expect(ensureAssetOnDisk(asset, 'query_identity.dat', fs)).resolves.toBe(
      'file:///cache/asset.dat',
    );
    expect(asset.downloads).toBe(1);
  });

  it('throws a labelled error when the re-extract also fails to land on disk', async () => {
    const { asset, fs } = makeFakes({
      initialLocalUri: 'file:///cache/a.dat',
      exists: [false, false],
    });
    await expect(ensureAssetOnDisk(asset, 'query_identity.dat', fs)).rejects.toThrow(
      /query_identity\.dat/,
    );
  });

  it('throws when downloadAsync never produces a localUri', async () => {
    const { asset, fs } = makeFakes({ initialLocalUri: null, exists: [true], downloadSets: null });
    await expect(ensureAssetOnDisk(asset, 'a.dat', fs)).rejects.toThrow(/a\.dat/);
  });
});
