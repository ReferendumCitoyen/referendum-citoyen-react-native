/**
 * A substitution in any tracked binary fails here rather than passing review
 * (wave 4b, M5). The prover aar alone receives DG1, the SOD and the private
 * key as its witness, and a seven megabyte binary diff is not reviewable.
 *
 * This test is not an attestation: the digests live in the same commit as the
 * files. It makes a silent change loud, which is what was missing.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { TRACKED_BINARIES } from '@/constants/native-binaries';

const ROOT = path.resolve(__dirname, '..');

describe('every tracked binary is the one we recorded', () => {
  it.each(TRACKED_BINARIES.map((b) => [b.path, b] as const))('%s', (_p, binary) => {
    const full = path.join(ROOT, binary.path);
    expect(fs.existsSync(full)).toBe(true);
    const bytes = fs.readFileSync(full);
    expect(bytes.length).toBe(binary.bytes);
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(binary.sha256);
  });
});

describe('the list itself stays honest', () => {
  it('covers every binary git tracks, so a new one cannot arrive unrecorded', () => {
    // Anything shipped as opaque bytes. Kept as a literal list of extensions
    // rather than a heuristic: adding one is a decision.
    const BINARY_EXT = /\.(aar|jar|so|a|dylib|zkey|dat)$/;
    const tracked = require('child_process')
      .execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f: string) => BINARY_EXT.test(f));
    const recorded = new Set(TRACKED_BINARIES.map((b) => b.path));
    expect(tracked.filter((f: string) => !recorded.has(f))).toEqual([]);
  });

  it('records a provenance line for each, even when it says the recipe is missing', () => {
    for (const b of TRACKED_BINARIES) {
      expect(b.provenance.length).toBeGreaterThan(20);
    }
  });

  it('names every digest as 64 lowercase hex characters', () => {
    for (const b of TRACKED_BINARIES) {
      expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
