/**
 * The NFC pod pin, locked mechanically.
 *
 * modules/native-logging.test.ts covers the native code this repository owns
 * and says so in its own header: "The CocoaPod NFCPassportReader is NOT covered
 * here". That exception is the whole of audit item C1b / A0, the one finding
 * every adversarial pass agreed on. The pod commit pinned in app.config.ts logs
 * chip material in a RELEASE build: the MRZ key and the BAC session keys
 * (BACHandler.swift:93,183-184), the PACE key, which for a French ID card is
 * derived from the CAN the voter typed (PACEHandler.swift:127-128), the
 * decrypted DO'87 contents and the raw APDU traffic. 219 Logger call sites, no
 * `#if DEBUG` anywhere in its Sources/.
 *
 * Until now nothing in the suite would have noticed. Wave 4b asked for this
 * test and it was never written, so the defect could come back at the next
 * rebase of the fork in silence. This is it.
 *
 * WHY ONE OF THE TWO CHECKS BELOW IS `it.failing`. The pin is a pending human
 * decision, written in app.config.ts as TODO(DECISION-POD-LOGGING): the fix
 * exists but is not pushed, and the product owner's decision of 23/09 is that
 * it moves the day the store build goes to Apple review, not before. Asserting
 * the truth we want today would simply take the suite red on a state the
 * project has deliberately chosen, which teaches a reader to ignore it. So:
 *
 *   - `it` (green, and the part that bites now): the pin is a full 40-hex
 *     commit, and while it is one of the commits known to log in release, the
 *     decision marker and its explanation have to be there with it. Delete the
 *     marker, or pin a new logging commit with no marker, and this fails.
 *   - `it.failing` (the lock itself, same idiom as
 *     __verify__/P6-other-key.verify.test.tsx): the pin is not a commit known
 *     to log. It is red TODAY in the sense that its assertion does not hold,
 *     which is exactly the defect. The day the fix is pushed and the pin moves,
 *     this test turns RED because it started passing, and whoever moved the pin
 *     flips it from `it.failing` to `it`. From that moment the suite refuses
 *     any return to a logging pod.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const CONFIG = fs.readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8');

/**
 * Commits of github.com/referendumcitoyenfr/NFCPassportReader that are known
 * to write chip material to the iOS unified log in a Release configuration.
 *
 * 9201876 is the one this branch pins. It is the PARENT of the fix, ed75f373
 * on branch privacy/no-release-logging of the same fork, which binds the seven
 * Logger categories to OSLog.disabled outside DEBUG and puts
 * SimpleASN1DumpParser's single print() under #if DEBUG.
 *
 * Add a line here for any other commit found to log, and never remove one.
 */
const PODS_THAT_LOG_IN_RELEASE: Record<string, string> = {
  '92018762f6103bf13a12b0bede9539f066de18a9':
    'conditional .pace polling, parent of the fix: 219 unguarded Logger sites',
};

/**
 * What has to be true before a logging pin is acceptable at all: the decision
 * has to be written next to it, in the words that say it is known.
 */
const REQUIRED_WHEN_PINNING_A_LOGGING_POD = [
  'TODO(DECISION-POD-LOGGING)',
  'privacy/no-release-logging',
  'ed75f373',
];

/** The commit pinned for the NFCPassportReader extra pod, from the source. */
export function pinnedPodCommit(source: string): string | null {
  const pod = source.indexOf("name: 'NFCPassportReader'");
  if (pod < 0) return null;
  // The `commit:` that closes that pod entry, and not a later one.
  const m = /commit:\s*'([0-9a-f]+)'/.exec(source.slice(pod));
  return m ? m[1] : null;
}

describe('the NFC pod pin (audit C1b / A0)', () => {
  it('app.config.ts still pins NFCPassportReader by commit', () => {
    // A pod that stopped being pinned by commit would make every check below
    // meaningless: a branch or a tag moves under the build.
    expect(CONFIG).toContain("name: 'NFCPassportReader'");
    const pin = pinnedPodCommit(CONFIG);
    expect(pin).toMatch(/^[0-9a-f]{40}$/);
  });

  it('a pin known to log in release comes with its decision written beside it', () => {
    const pin = pinnedPodCommit(CONFIG)!;
    if (!(pin in PODS_THAT_LOG_IN_RELEASE)) return;
    for (const required of REQUIRED_WHEN_PINNING_A_LOGGING_POD) {
      expect(CONFIG).toContain(required);
    }
  });

  // THE LOCK. Armed on 2026-09-24, the day the pin moved to ed75f373.
  it('the pinned pod does not log chip material in a release build', () => {
    const pin = pinnedPodCommit(CONFIG)!;
    const why = PODS_THAT_LOG_IN_RELEASE[pin];
    expect(
      why
        ? `app.config.ts pins NFCPassportReader at ${pin} (${why}). ` +
          'A Release build of this pod writes the MRZ key, the BAC session keys and the PACE key, ' +
          'which for a French ID card is derived from the CAN the voter typed, to the iOS unified log. ' +
          'The fix must be PUSHED first: git push origin privacy/no-release-logging on ' +
          'github.com/referendumcitoyenfr/NFCPassportReader, merged into main, then the SHA AS IT ' +
          'EXISTS AFTER THE MERGE pinned here (it will not be ed75f373 if the branch is rebased), ' +
          'then expo prebuild --platform ios and pod install. No OTA can carry it: 2.0.2 removed ' +
          'expo-updates. Until all of that is done this test stays it.failing.'
        : null,
    ).toBeNull();
  });

  it('the pin reader itself works', () => {
    expect(pinnedPodCommit("name: 'NFCPassportReader',\ncommit: 'abc123',")).toBe('abc123');
    // A commit pinned for some other pod earlier in the file is not read as
    // this one's.
    expect(
      pinnedPodCommit("name: 'Other',\ncommit: 'dead',\nname: 'NFCPassportReader',\ncommit: 'beef',"),
    ).toBe('beef');
    expect(pinnedPodCommit('no pod here')).toBeNull();
  });
});
