import {
  diagnoseKeyMismatch,
  formatKeyDiagnosis,
  identityMatches,
  verifyKeyAgainstChain,
} from './key-diagnosis';
import type { PassportKeyEntry } from './passport-key-db';

const entry = (
  hash: string,
  key: string,
  docType?: PassportKeyEntry['docType'],
): PassportKeyEntry => ({ passportHash: hash, privateKey: key, docType } as PassportKeyEntry);

// Stand-in for RarimeUtils.getProfileKey: native, so it can't run here. The
// mapping only has to be deterministic and injective.
const fakeProfileKey = (sk: string) => 'p' + sk;

describe('diagnoseKeyMismatch', () => {
  it('reports the matching document when a stored key is the bonded one', () => {
    const d = diagnoseKeyMismatch(
      'paaa',
      [entry('h1', 'zzz', 'passport'), entry('h2', 'aaa', 'idCard')],
      fakeProfileKey,
    );
    expect(d.matchesStoredKey).toBe(true);
    expect(d.matchingDocType).toBe('idCard');
    expect(d.storedKeyCount).toBe(2);
    expect(d.storedDocTypes).toEqual(['passport', 'idCard']);
  });

  it('reports no match when the key is genuinely absent', () => {
    const d = diagnoseKeyMismatch('pmissing', [entry('h1', 'zzz', 'passport')], fakeProfileKey);
    expect(d.matchesStoredKey).toBe(false);
    expect(d.matchingDocType).toBeNull();
  });

  it('handles an empty key DB', () => {
    const d = diagnoseKeyMismatch('panything', [], fakeProfileKey);
    expect(d).toMatchObject({ storedKeyCount: 0, matchesStoredKey: false, matchingDocType: null });
    expect(formatKeyDiagnosis(d)).toContain('none');
  });

  // The contract returns a 0x-prefixed, mixed-case hash; getProfileKey returns
  // bare lowercase hex. Comparing them raw reports "no match" for a key that
  // matches — which would send a recoverable user hunting for a backup they
  // don't need.
  it('matches across the 0x-prefix and case difference between the two sources', () => {
    const d = diagnoseKeyMismatch('0xABCDEF', [entry('h1', 'x', 'idCard')], () => 'abcdef');
    expect(d.matchesStoredKey).toBe(true);
  });

  // One unusable row must not hide a match in another.
  it('skips a row whose key cannot be derived and keeps checking the rest', () => {
    const d = diagnoseKeyMismatch(
      'pgood',
      [entry('h1', 'bad', 'passport'), entry('h2', 'good', 'idCard')],
      (sk) => {
        if (sk === 'bad') throw new Error('unusable');
        return fakeProfileKey(sk);
      },
    );
    expect(d.matchesStoredKey).toBe(true);
    expect(d.matchingDocType).toBe('idCard');
  });

  it('labels rows written before docType was recorded', () => {
    const d = diagnoseKeyMismatch('pnope', [entry('h1', 'zzz')], fakeProfileKey);
    expect(d.storedDocTypes).toEqual(['unknown']);
  });
});

describe('legacy single-key slot', () => {
  it('finds a match in the legacy slot when no DB row matches', () => {
    const d = diagnoseKeyMismatch('plegacy', [entry('h1', 'other', 'passport')], fakeProfileKey, 'legacy');
    expect(d.matchesStoredKey).toBe(true);
    expect(d.matchingDocType).toBe('legacy');
    expect(formatKeyDiagnosis(d)).toContain('LEGACY');
  });

  // A document that owns its key must be reported as itself, not as the legacy
  // slot — the two imply different follow-up actions.
  it('prefers a matching DB row over the legacy slot', () => {
    const d = diagnoseKeyMismatch('psame', [entry('h1', 'same', 'idCard')], fakeProfileKey, 'same');
    expect(d.matchingDocType).toBe('idCard');
  });

  it('is unaffected when no legacy key is passed', () => {
    const d = diagnoseKeyMismatch('pmissing', [entry('h1', 'other', 'idCard')], fakeProfileKey);
    expect(d.matchesStoredKey).toBe(false);
  });
});

describe('formatKeyDiagnosis', () => {
  it('says RECOVERABLE when a stored key matches', () => {
    const line = formatKeyDiagnosis({
      storedKeyCount: 2,
      storedDocTypes: ['passport', 'idCard'],
      matchesStoredKey: true,
      matchingDocType: 'idCard',
    });
    expect(line).toContain('RECOVERABLE');
    expect(line).toContain('idCard');
  });

  it('says NOT RECOVERABLE when nothing matches', () => {
    const line = formatKeyDiagnosis({
      storedKeyCount: 1,
      storedDocTypes: ['passport'],
      matchesStoredKey: false,
      matchingDocType: null,
    });
    expect(line).toContain('NOT RECOVERABLE');
  });

  // Dossier 2.0.2, item 14 (c): a key we could not derive may be the right
  // one, so "no match" is not "lost" then.
  it('says UNKNOWN, never NOT RECOVERABLE, when a derivation failed and nothing matched', () => {
    const d = diagnoseKeyMismatch(
      'pother',
      [entry('h1', 'bad', 'passport'), entry('h2', 'good', 'idCard')],
      (sk) => {
        if (sk === 'bad') throw new Error('unusable');
        return fakeProfileKey(sk);
      },
    );
    expect(d.matchesStoredKey).toBe(false);
    expect(d.underivableKeyCount).toBe(1);
    const line = formatKeyDiagnosis(d);
    expect(line).toContain('UNKNOWN');
    expect(line).not.toContain('NOT RECOVERABLE');
  });

  it('a failed derivation of the legacy slot also makes it UNKNOWN', () => {
    const d = diagnoseKeyMismatch('pother', [entry('h1', 'good', 'idCard')], (sk) => {
      if (sk === 'legacy') throw new Error('unusable');
      return fakeProfileKey(sk);
    }, 'legacy');
    expect(formatKeyDiagnosis(d)).toContain('UNKNOWN');
  });

  it('still says NOT RECOVERABLE when every key was checked and none matched', () => {
    const d = diagnoseKeyMismatch('pother', [entry('h1', 'good', 'idCard')], fakeProfileKey);
    expect(d.underivableKeyCount).toBe(0);
    expect(formatKeyDiagnosis(d)).toContain('NOT RECOVERABLE');
  });

  // The whole point is that this survives utils/logger.ts's redaction, which
  // rewrites bare 64-hex to <hex64>. If a key ever leaks into this line it
  // would both be a privacy problem and arrive unreadable.
  it('never emits anything key-shaped', () => {
    const line = formatKeyDiagnosis({
      storedKeyCount: 1,
      storedDocTypes: ['idCard'],
      matchesStoredKey: true,
      matchingDocType: 'idCard',
    });
    expect(line).not.toMatch(/[0-9a-f]{32,}/i);
  });
});

// The 0x/case mismatch between the contract's return and getProfileKey's
// output is the trap this helper exists to stop each call site re-implementing
// — Settings uses it to gate a destructive, irreversible key replacement.
describe('identityMatches', () => {
  it('ignores the 0x prefix and case', () => {
    expect(identityMatches('0xABCDEF', 'abcdef')).toBe(true);
    expect(identityMatches('abcdef', '0xABCDEF')).toBe(true);
  });

  it('ignores surrounding whitespace (pasted values carry it)', () => {
    expect(identityMatches('  0xabcdef\n', 'abcdef')).toBe(true);
  });

  it('is false for genuinely different keys', () => {
    expect(identityMatches('0xaaaa', '0xbbbb')).toBe(false);
  });
});

// Gates the two destructive, irreversible routes into replaceKeyForPassport.
// The file-import route had no check at all: a backup carrying the wrong key
// overwrote a good one silently, and on a French document there is no revoke
// to undo it with.
describe('verifyKeyAgainstChain', () => {
  it('confirms a key that derives the recorded on-chain identity', () => {
    expect(verifyKeyAgainstChain('aaa', 'paaa', fakeProfileKey)).toBe('match');
  });

  // The bug this exists to stop: without it, this key is written over a good
  // one and the document is unrecoverable.
  it('rejects a key that derives a different identity', () => {
    expect(verifyKeyAgainstChain('zzz', 'paaa', fakeProfileKey)).toBe('mismatch');
  });

  // onChainIdentity is only recorded once Step 7 has failed on that document,
  // so plenty of rows legitimately have none. Treating that as a mismatch
  // would block the very recovery this is meant to enable.
  it('reports unknown when no on-chain identity has been recorded', () => {
    expect(verifyKeyAgainstChain('aaa', undefined, fakeProfileKey)).toBe('unknown');
    expect(verifyKeyAgainstChain('aaa', '', fakeProfileKey)).toBe('unknown');
  });

  // getProfileKey is a native call. If it is unavailable we must not take the
  // import down with it — fall through to the caller's own confirmation.
  it('reports unknown when the profile key cannot be derived', () => {
    expect(
      verifyKeyAgainstChain('aaa', 'paaa', () => {
        throw new Error('native module unavailable');
      }),
    ).toBe('unknown');
  });

  // Same 0x/case trap as identityMatches: comparing raw would reject a key
  // that is in fact the right one.
  it('matches across the 0x-prefix and case difference between the two sources', () => {
    expect(verifyKeyAgainstChain('aaa', '0xPAAA'.toUpperCase(), () => 'paaa')).toBe('match');
  });
});
