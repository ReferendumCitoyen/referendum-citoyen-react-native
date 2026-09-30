import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_CIRCUITS, describeBundledCircuit } from './bundled-circuits';

const CIRCUITS_DIR = path.resolve(__dirname, '..', 'assets', 'circuits');

// The `hash` in a compiled Noir artifact exceeds 2^53: read it as text.
function noirHashOnDisk(name: string): string | null {
  const file = path.join(CIRCUITS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  const m = /"hash":(\d+)/.exec(fs.readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}

// The manifest is what a report says about the circuit that ran. It is only
// worth reading if it describes the artifact actually on disk, so each entry
// is pinned to the file's own hash — swapping a circuit without updating the
// manifest fails here, and so does updating the manifest without the file.
describe('bundled circuit manifest', () => {
  it.each(Object.keys(BUNDLED_CIRCUITS))('%s matches the artifact on disk', (name) => {
    expect(noirHashOnDisk(name)).toBe(BUNDLED_CIRCUITS[name].noirHash);
  });

  it('covers every circuit artifact in assets/circuits', () => {
    const onDisk = fs
      .readdirSync(CIRCUITS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect(onDisk).toEqual(Object.keys(BUNDLED_CIRCUITS).sort());
  });

  it('records the passport register circuit as the v0.2.7 build', () => {
    const info = BUNDLED_CIRCUITS.registerIdentity_1_256_3_5_576_248_NA;
    expect(info.source).toContain('v0.2.7');
    expect(info.leaf).toBe('sha256-high-248');
  });

  it('describes a known circuit and admits an unknown one', () => {
    expect(describeBundledCircuit('registerIdentity_1_256_3_5_576_248_NA')).toContain('v0.2.7');
    expect(describeBundledCircuit('nope')).toContain('not in constants/bundled-circuits.ts');
  });
});
