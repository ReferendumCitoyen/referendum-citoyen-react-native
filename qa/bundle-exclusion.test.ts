/**
 * The QA gallery is kept out of the store app's release bundle (audit item
 * C6), and out of that one only.
 *
 * qa/production-guard.test.tsx pins the run-time half: the routes redirect and
 * the scan seam cannot be armed. This file pins the build half — the Metro
 * resolution that swaps qa/GalleryView.tsx for a stub — and above all pins its
 * scope: the beta app, a dev client, Metro in development and the QA web
 * preview must still get the real gallery, or the beta gallery and the Maestro
 * deep links break.
 */
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require('./bundle-exclusion.js') as {
  ROOT: string;
  QA_GALLERY_MODULE: string;
  QA_GALLERY_STUB: string;
  excludesQaGallery: (env: Record<string, string | undefined>) => boolean;
  applyQaGalleryExclusion: (
    resolved: { filePath: string; type: string } | null,
    platform: string | null,
    env: Record<string, string | undefined>,
  ) => { filePath: string; type: string } | null;
};

const REAL = { filePath: rule.QA_GALLERY_MODULE, type: 'sourceFile' };
const STORE_RELEASE = { APP_FLAVOUR: 'production', NODE_ENV: 'production' };

describe('the store app release bundle', () => {
  it.each(['android', 'ios'])('resolves the gallery to the stub on %s', (platform) => {
    expect(rule.applyQaGalleryExclusion(REAL, platform, STORE_RELEASE)?.filePath).toBe(
      rule.QA_GALLERY_STUB,
    );
  });

  it('leaves every other module alone', () => {
    const other = { filePath: path.join(rule.ROOT, 'app', 'qa-gallery.tsx'), type: 'sourceFile' };
    expect(rule.applyQaGalleryExclusion(other, 'android', STORE_RELEASE)).toBe(other);
    expect(rule.applyQaGalleryExclusion(null, 'android', STORE_RELEASE)).toBeNull();
  });

  it('both files it names exist', () => {
    expect(fs.existsSync(rule.QA_GALLERY_MODULE)).toBe(true);
    expect(fs.existsSync(rule.QA_GALLERY_STUB)).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * One source of truth for the flavour (audit of 23/09/2026).
 *
 * app.config.ts resolves APP_FLAVOUR, then the checkout's git origin. This
 * rule used to read the variable alone, so a CI build that sets no variable
 * got two different answers from the two files. These tests pin the agreement
 * without depending on which repository they run in.
 * ---------------------------------------------------------------------------*/
describe('the flavour is resolved like app.config.ts', () => {
  it('an explicit variable always wins', () => {
    expect(rule.excludesQaGallery({ APP_FLAVOUR: 'production', NODE_ENV: 'production' })).toBe(true);
    expect(rule.excludesQaGallery({ APP_FLAVOUR: 'beta', NODE_ENV: 'production' })).toBe(false);
  });

  it('NODE_ENV alone can never exclude, whatever the checkout says', () => {
    expect(rule.excludesQaGallery({ NODE_ENV: 'development' })).toBe(false);
    expect(rule.excludesQaGallery({ NODE_ENV: 'test' })).toBe(false);
    expect(rule.excludesQaGallery({})).toBe(false);
  });

  it('with no variable, it answers the same as this checkout', () => {
    const { execSync } = require('node:child_process');
    let origin = '';
    try {
      origin = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      origin = '';
    }
    const expected = origin.includes('referendum-citoyen-react-native');
    expect(rule.excludesQaGallery({ NODE_ENV: 'production' })).toBe(expected);
  });
});

describe('every other bundle keeps the real gallery', () => {
  it.each([
    ['the beta app', { APP_FLAVOUR: 'beta', NODE_ENV: 'production' }],
    ['a dev client', { APP_FLAVOUR: 'production', NODE_ENV: 'development' }],
    ['a bundle with neither set', {}],
    ['jest', { APP_FLAVOUR: 'production', NODE_ENV: 'test' }],
  ])('%s', (_name, env) => {
    expect(rule.excludesQaGallery(env)).toBe(false);
    expect(rule.applyQaGalleryExclusion(REAL, 'android', env)).toBe(REAL);
  });

  it('the QA web preview, even under the store release variables', () => {
    expect(rule.applyQaGalleryExclusion(REAL, 'web', STORE_RELEASE)).toBe(REAL);
  });
});

describe('the stub', () => {
  it('renders nothing and cannot throw', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stub = require('./GalleryView.excluded') as {
      GalleryView: (p: { presentation: 'card' | 'flow' }) => unknown;
    };
    expect(stub.GalleryView({ presentation: 'card' })).toBeNull();
    expect(stub.GalleryView({ presentation: 'flow' })).toBeNull();
  });

  it('carries no fixture: that is the whole point', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stub = require('./GalleryView.excluded') as Record<string, unknown>;
    expect(Object.keys(stub).sort()).toEqual(['FLOW_ROUTE', 'GalleryView', 'LIST_ROUTE']);
  });

  it('the routes import the module the rule swaps, and nothing else from qa/', () => {
    for (const route of ['app/qa-gallery.tsx', 'app/qa-gallery-flow.tsx']) {
      const src = fs.readFileSync(path.join(rule.ROOT, route), 'utf8');
      const qaImports = [...src.matchAll(/from '(@\/qa\/[^']+)'/g)].map((m) => m[1]);
      expect(qaImports).toEqual(['@/qa/GalleryView']);
    }
  });
});

describe('metro.config.js applies the rule', () => {
  it('requires it and runs it on the resolution it returns', () => {
    const src = fs.readFileSync(path.join(rule.ROOT, 'metro.config.js'), 'utf8');
    expect(src).toContain("require('./qa/bundle-exclusion.js')");
    expect(src).toContain('applyQaGalleryExclusion(');
  });
});
