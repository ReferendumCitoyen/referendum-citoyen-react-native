/**
 * What this protects: the two heavy register artifacts in assets/circuits/ are
 * the prover. They ship inside the binary, they are 3 MB each, and nobody can
 * recompile them here. So when their build metadata had to be cleaned of two
 * third-party developers' account names and of an internal project name, the
 * only acceptable edit was one that leaves every byte the prover reads alone.
 *
 * What the prover actually reads, checked against the SDK rather than assumed:
 *   - iOS: Swoir's `CircuitManifest` (node_modules/@rarimo/rarime-rn-sdk/ios/
 *     Swoir/Swoir.swift) decodes exactly three keys, `bytecode`, `abi` and
 *     `hash`. JSONDecoder ignores everything else in the document.
 *   - Android: `com.noirandroid.lib.CircuitManifest` is a Gson data class over
 *     noir_version, hash, abi, bytecode, debug_symbols, file_map, names — but
 *     `Circuit` only ever calls getBytecode() and getAbi(). The keys must stay
 *     present, with their types; their values are never read.
 *   - The SDK's own cache validator only requires a non-empty top-level
 *     "bytecode" string (build/helpers/circuitValidation.js).
 *
 * The cleanup therefore rewrote nothing but the 15 `file_map[*].path` strings
 * in each file, dropping the absolute build prefix. 826 bytes left one file and
 * 513 the other; no other byte moved. The digests below pin that: they are the
 * values measured on the artifacts BEFORE the cleanup. If any of them changes,
 * somebody touched the prover, not the metadata.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.resolve(__dirname, '../assets/circuits');

/**
 * sha256 of JSON.stringify(field), measured on the artifacts as they were
 * BEFORE the cleanup. `hash` is pinned as the literal decimal it is written
 * with in the file instead: it exceeds 2^53, so reading it through JSON.parse
 * loses digits and would pin the wrong number.
 */
const PINNED: Record<string, { bytecode: string; abi: string; hash: string; debugSymbols: string }> = {
  'registerIdentity_1_256_1_6_960_248_NA': {
    bytecode: '2677f286cf0f4849f18c98de7f7da8fc4b58fa4212365036a6c61e3ebd1f4e2e',
    abi: 'b88bec697422dd333b23edec187f7e3c58ca96a9a5ada888b278a6ea0e404d21',
    hash: '15047853520347881651',
    debugSymbols: 'f707dcd9cb2c783ff5a426c420e0ec560edd580b9330d264ed24195aed4f3004',
  },
  'registerIdentity_1_256_3_5_576_248_NA': {
    bytecode: '2a63a0aaa86f53452d087cf0cb47e2a889ba01ca6968579d2cc861e752d18d42',
    abi: '0ea77d383368e09e9885956824496701189886d62bdb7341fe40029230917f9b',
    hash: '9768353999766654159',
    debugSymbols: 'ff9563bbc3ab1ef3445e46679cdf3b9ebd428e02d9fcd1d7f3f45e214630dd6b',
  },
};

/** Canonical JSON, the same shape the digests above were taken over. */
const digest = (value: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const NAMES = Object.keys(PINNED);

describe.each(NAMES)('bundled circuit artifact %s', (name) => {
  const file = path.join(DIR, `${name}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  const artifact = JSON.parse(raw) as Record<string, unknown>;

  it('still carries every key the Android manifest class declares', () => {
    // A missing key becomes a null field on a non-null Kotlin property. Nothing
    // reads them today, so it would fail late and obscurely rather than here.
    expect(Object.keys(artifact).sort()).toEqual([
      'abi',
      'brillig_names',
      'bytecode',
      'debug_symbols',
      'file_map',
      'hash',
      'names',
      'noir_version',
    ]);
  });

  it('has the bytecode, abi and hash it had before the metadata cleanup', () => {
    expect(digest(artifact.bytecode)).toBe(PINNED[name].bytecode);
    expect(digest(artifact.abi)).toBe(PINNED[name].abi);
    expect(raw.match(/"hash"\s*:\s*(\d+)/)?.[1]).toBe(PINNED[name].hash);
    // Not read by either prover, but it is the other big blob: pinned so an
    // edit meant for the paths cannot quietly land in it.
    expect(digest(artifact.debug_symbols)).toBe(PINNED[name].debugSymbols);
  });

  it('names no build machine anywhere in the file', () => {
    // These artifacts go into the binary, so an account name here is shipped to
    // every voter. Checked over the raw text, not over file_map alone: the
    // point is that nothing anywhere in the document carries a home path.
    expect(raw).not.toMatch(/\/(Users|home)\//);
  });

  it('keeps file_map complete, typed, and relative', () => {
    const fileMap = artifact.file_map as Record<string, { path: string; source: string }>;
    expect(Object.keys(fileMap).length).toBe(23);
    for (const [id, entry] of Object.entries(fileMap)) {
      expect(Object.keys(entry).sort()).toEqual(['path', 'source']);
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.path).toBe('string');
      expect(entry.path.startsWith('/')).toBe(false);
      expect(entry.path.endsWith('.nr')).toBe(true);
      expect(id).toMatch(/^\d+$/);
    }
  });
});
