import { formatCommitLabel } from './app-version';

// The label exists so a tester can read the exact source revision off the
// Settings screen and put it in a report — "build 5" alone doesn't say which
// of the day's commits it was cut from. Formatting is separated from the
// Constants read for the same reason contact-info.ts splits them: the pure
// half is the half worth testing.
describe('formatCommitLabel', () => {
  it('shortens a full hash to the conventional 7 characters', () => {
    expect(formatCommitLabel('64c639aabcdef0123456789abcdef0123456789a')).toBe('64c639a');
  });

  it('leaves an already-short hash alone', () => {
    expect(formatCommitLabel('64c639a')).toBe('64c639a');
  });

  // app.config resolves the hash from git or an EAS env var, either of which
  // can come back empty. Nothing to show is not an error — Settings just omits
  // the segment rather than rendering "undefined".
  it('returns null when no hash was baked in', () => {
    expect(formatCommitLabel(undefined)).toBeNull();
    expect(formatCommitLabel(null)).toBeNull();
    expect(formatCommitLabel('')).toBeNull();
  });

  // Guard against whatever else might end up in `extra` — a label that renders
  // a git error message would be worse than no label.
  it('returns null for a value that is not a hash', () => {
    expect(formatCommitLabel('fatal: not a git repository')).toBeNull();
    expect(formatCommitLabel('zzzzzzz')).toBeNull();
  });

  // EAS uploads uncommitted working-tree changes, so a build cut from a dirty
  // tree is NOT the commit it claims to be. The marker keeps the label honest.
  it('marks a build cut from a dirty working tree', () => {
    expect(formatCommitLabel('64c639aabcdef', true)).toBe('64c639a+');
  });
});
