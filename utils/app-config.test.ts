/**
 * What the build configuration promises, pinned (audit items C4 and C12).
 *
 *   - the Android app's private storage stays out of the phone's backups, in
 *     the cloud and in a device-to-device transfer;
 *   - the package's own name and version match the app that is published,
 *     so the first file a reviewer opens does not name a different project;
 *   - no decision marker left in the code names a person.
 *
 * app.config.ts is evaluated here for real, in both flavours.
 */
import * as fs from 'fs';
import * as path from 'path';

// app.config.ts resolves the flavour from APP_FLAVOUR and from the checkout's
// git origin, and refuses when the two disagree. Standing in for a checkout
// with no origin (an EAS server) makes APP_FLAVOUR the only source here, so
// this file tests both flavours whichever checkout it runs in.
jest.mock('node:child_process', () => ({
  execSync: (cmd: string) => {
    if (cmd.includes('remote get-url origin')) throw new Error('no origin');
    if (cmd.includes('rev-parse')) return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
    return '';
  },
}));

const ROOT = path.resolve(__dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as { name: string; version: string; repository: { url: string } };

type Cfg = {
  version?: string;
  android?: { allowBackup?: boolean; package?: string };
  plugins?: (string | [string, unknown])[];
};

function loadConfig(flavour: 'production' | 'beta'): Cfg {
  const previous = process.env.APP_FLAVOUR;
  process.env.APP_FLAVOUR = flavour;
  jest.resetModules();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../app.config') as { default: (c: { config: object }) => Cfg };
    return mod.default({ config: {} });
  } finally {
    if (previous === undefined) delete process.env.APP_FLAVOUR;
    else process.env.APP_FLAVOUR = previous;
  }
}

describe('Android backups (C4)', () => {
  it.each(['production', 'beta'] as const)('%s disables allowBackup', (flavour) => {
    expect(loadConfig(flavour).android?.allowBackup).toBe(false);
  });

  it.each(['production', 'beta'] as const)('%s registers the no-backup plugin', (flavour) => {
    const names = (loadConfig(flavour).plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('./plugins/withNoBackup.js');
  });

  it('the plugin writes both manifest attributes on <application/>', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { applyNoBackup, RULES_RESOURCE } = require('../plugins/withNoBackup.js');
    const application: { $?: Record<string, string> } = { $: { 'android:label': 'x' } };
    applyNoBackup(application);
    expect(application.$?.['android:allowBackup']).toBe('false');
    expect(application.$?.['android:dataExtractionRules']).toBe(`@xml/${RULES_RESOURCE}`);
    // and it refuses a manifest with no <application/> rather than passing.
    expect(() => applyNoBackup(undefined)).toThrow(/application/);
  });

  it('the rules exclude every domain from cloud backup AND device transfer', () => {
    // allowBackup=false alone stops cloud backups; from Android 12 it leaves
    // device-to-device transfer on, and this app targets API 36.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DATA_EXTRACTION_RULES } = require('../plugins/withNoBackup.js');
    for (const section of ['cloud-backup', 'device-transfer']) {
      const body = DATA_EXTRACTION_RULES.split(`<${section}>`)[1].split(`</${section}>`)[0];
      for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
        expect(body).toContain(`<exclude domain="${domain}" path="." />`);
      }
    }
  });
});

/**
 * Audit item 4b-M15: the same exclusion, on the other platform.
 *
 * The plugin's header used to open with "keep this app's data out of the
 * phone's backups", which names no platform and is false on iOS: nothing in
 * this tree excludes anything from an iOS backup. The header now says so. This
 * test holds the two together, in both directions, so neither can drift:
 * implement the exclusion and the header has to stop saying it is missing;
 * reword the header back to a platform-neutral promise and this fails.
 */
describe('iOS backups (4b-M15)', () => {
  const IOS_EXCLUSION = /NSURLIsExcludedFromBackupKey|isExcludedFromBackup/;
  const SEARCHED = ['app', 'components', 'constants', 'contexts', 'hooks', 'modules', 'plugins', 'scripts', 'utils'];

  function treeExcludesFromIosBackup(): boolean {
    let found = false;
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (['node_modules', 'build', '.gradle', '__snapshots__'].includes(e.name)) continue;
          walk(p);
        } else if (/\.(ts|tsx|js|swift|m|mm|h|plist)$/.test(e.name)) {
          // This file names the key to say it is absent: it is not an
          // implementation, and neither is the plugin header that quotes it.
          if (p.endsWith('utils/app-config.test.ts')) continue;
          if (p.endsWith('plugins/withNoBackup.js')) continue;
          if (IOS_EXCLUSION.test(fs.readFileSync(p, 'utf8'))) found = true;
        }
      }
    };
    for (const d of SEARCHED) walk(path.join(ROOT, d));
    return found;
  }

  const header = fs.readFileSync(path.join(ROOT, 'plugins/withNoBackup.js'), 'utf8').split('*/')[0];

  it('the plugin header scopes its promise to Android', () => {
    expect(header).toContain("keep this app's data out of the phone's backups,\n * ON ANDROID ONLY");
  });

  it('the header states whichever of the two is true about iOS', () => {
    if (treeExcludesFromIosBackup()) {
      // Somebody implemented it: the header must stop saying it is missing.
      expect(header).not.toContain('NOTHING IN THIS REPOSITORY EXCLUDES ANYTHING FROM AN iOS BACKUP');
    } else {
      expect(header).toContain('NOTHING IN THIS REPOSITORY EXCLUDES ANYTHING FROM AN iOS BACKUP');
      // and it has to say what is in the backup instead, not just that
      // something is missing.
      expect(header).toContain('AsyncStorage');
      expect(header).toContain('keychainAccessible');
    }
  });
});

describe('package identity (C12)', () => {
  it('names the repository it is published from, not the beta checkout', () => {
    expect(pkg.name).toBe('referendum-citoyen');
    expect(pkg.repository.url).toContain(`${pkg.name}-react-native`);
  });

  it('carries the version the store app announces', () => {
    expect(pkg.version).toBe('2.0.2');
    expect(loadConfig('production').version).toBe(pkg.version);
  });

  it('leaves the beta on its own store version line', () => {
    // Two store records, two strictly increasing version lines: the beta must
    // NOT be dragged onto the store app's number.
    expect(loadConfig('beta').version).not.toBe(pkg.version);
  });
});

describe('decision markers name roles, not people (C13)', () => {
  const SOURCE_DIRS = ['app', 'components', 'constants', 'contexts', 'hooks', 'utils'];
  // The names this guard watches for are real people's, so they are not written
  // into this tree: point RC_PRIVATE_NAMES at them (comma separated) in a
  // private checkout and the second test below arms itself. Same convention as
  // RC_PASSPORT_FIXTURE_DIR in utils/e-document/smt-key.test.ts.
  const PRIVATE_NAMES: string[] = String(process.env.RC_PRIVATE_NAMES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  /**
   * Every line of every source file, with the marker sentences folded in.
   *
   * `pick` decides what a line has to look like to be collected. Markers were
   * the first shape watched; a plain comment is the second, and it is the one
   * CRIT-6 escaped through: `constants/native-binaries.ts:34` said "FOR <name>" in
   * an ordinary block comment, so a guard that only read `TODO(ROLE)` lines
   * could not see it (traceability 23/09, category 2 item 4).
   */
  function collect(pick: (line: string) => boolean): { file: string; line: string }[] {
    const out: { file: string; line: string }[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const lines = fs.readFileSync(p, 'utf8').split('\n');
          lines.forEach((line, i) => {
            if (!pick(line)) return;
            // A sentence can wrap: take the line and the two after it.
            out.push({ file: path.relative(ROOT, p), line: lines.slice(i, i + 3).join(' ') });
          });
        }
      }
    };
    for (const d of SOURCE_DIRS) walk(path.join(ROOT, d));
    return out;
  }

  /** `//`, `*` inside a block, and the `/*` that opens one. */
  const COMMENT = /^\s*(\/\/|\*|\/\*)/;

  function markerLines() {
    // Any uppercase marker tag, whatever role word it names: a marker renamed
    // to a new prefix must not fall out of the guard.
    return collect((line) => /TODO\([A-Z][A-Z0-9-]*\)/.test(line));
  }

  function commentLines() {
    return collect((line) => COMMENT.test(line));
  }

  // A line either names no one, or hands its job to a role or to the protocol
  // partner. This runs everywhere, including where RC_PRIVATE_NAMES is unset,
  // and it catches a name the list below would not have known about.
  const ROLE =
    /(product owner|protocol lead|operations lead|legal counsel|circuit author|content owner|the maintainer|the team|the association|Rarimo)/i;

  it('finds the markers, and each one hands its decision to a role', () => {
    const found = markerLines();
    expect(found.length).toBeGreaterThanOrEqual(8);
    // Anything shaped like a person — "ask X", "with X", "from X" followed by
    // a capitalised word that is neither a role nor the partner — fails here.
    const ATTRIBUTION = /\b(?:ask|asks|with|from|per|confirm with|decision of)\s+([A-ZÉÈ][a-zéèêàçï'’-]{2,})/;
    const offenders = found.filter((m) => {
      const hit = ATTRIBUTION.exec(m.line);
      return hit !== null && !ROLE.test(m.line);
    });
    expect(offenders.map((m) => m.file)).toEqual([]);
  });

  // The same rule, one layer wider: an ordinary comment that hands a job to
  // somebody. "FOR <name>, the part that cannot be settled from here" carried a
  // real first name into a production file that would be published as is, and
  // it wore none of the marker syntax the test above reads. This one runs on
  // every comment line, everywhere, and it needs no name list to work: it
  // reads the SHAPE of an addressed instruction and demands that the
  // addressee be a role.
  it('no plain comment addresses an individual rather than a role', () => {
    // "FOR X", "NOTE FOR X", "HANDOVER TO X", "OVER TO X", "ASK X", "@X" at
    // the start of a comment line. Deliberately not a bare "TO X": "TO UPDATE
    // a line" and friends are instructions to the reader, not to a person.
    const ADDRESSED = /^\s*(?:\/\/|\*|\/\*)\s*(?:FOR|NOTE FOR|HANDOVER TO|OVER TO|ASK|@)\s*([A-Z][A-Za-zÉÈ'’-]*)\b/;
    const offenders = commentLines()
      .filter((m) => {
        const hit = ADDRESSED.exec(m.line);
        return hit !== null && !ROLE.test(m.line);
      })
      .map((m) => `${m.file}: ${m.line.split('\n')[0].trim()}`);
    expect(offenders).toEqual([]);
  });

  const withNames = PRIVATE_NAMES.length > 0 ? it : it.skip;
  withNames('no marker carries a first name (needs RC_PRIVATE_NAMES)', () => {
    const rx = new RegExp(
      `\\b(${PRIVATE_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    );
    const offenders = markerLines()
      .filter((m) => rx.test(m.line))
      .map((m) => m.file);
    expect(offenders).toEqual([]);
  });

  // And the name list, applied to every comment and not only to the markers:
  // that is the widening CRIT-5 asked for. A private checkout with
  // RC_PRIVATE_NAMES set would have failed on native-binaries.ts:34.
  withNames('no comment carries a first name (needs RC_PRIVATE_NAMES)', () => {
    const rx = new RegExp(
      `\\b(${PRIVATE_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    );
    const offenders = commentLines()
      .filter((m) => rx.test(m.line))
      .map((m) => m.file);
    expect(offenders).toEqual([]);
  });
});
