/**
 * The QA gallery must not exist for store-app users:
 *   - its routes redirect to the home in a store build (not dev, not beta);
 *   - its test seam (utils/qa-overrides.ts) cannot be armed there;
 *   - no screen of the app links to it.
 */
import './test-setup';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';
import { allActions, resetActions } from './fixtures/recorder';
import { Providers } from './harness';

type G = { __DEV__?: boolean; __QA_APP_ID__?: string };
const g = global as unknown as G;
const realDev = g.__DEV__;

afterEach(() => {
  g.__DEV__ = realDev;
  g.__QA_APP_ID__ = undefined;
});

function asStoreBuild() {
  g.__DEV__ = false;
  g.__QA_APP_ID__ = 'app.referendumcitoyen.fr';
}

describe('QA gallery in a production (store) build', () => {
  it.each([
    ['qa-gallery', () => require('@/app/qa-gallery').default],
    ['qa-gallery-flow', () => require('@/app/qa-gallery-flow').default],
  ])('%s redirects to the home and renders no fixture', (_name, load) => {
    asStoreBuild();
    resetActions();
    const Screen = load() as React.ComponentType;
    const r = render(
      <Providers>
        <Screen />
      </Providers>,
    );
    expect(allActions().map((a) => a.id)).toEqual(['redirect:/']);
    expect(r.queryByText(/QA 2\.0\.2/)).toBeNull();
    r.unmount();
  });

  it('the scan stand-in cannot be installed', () => {
    asStoreBuild();
    const { setQaNativeScanOverride, qaNativeScanOverride, qaAllowed } = require('@/utils/qa-overrides');
    expect(qaAllowed()).toBe(false);
    expect(setQaNativeScanOverride(async () => '{}')).toBe(false);
    expect(qaNativeScanOverride()).toBeNull();
  });

  it('a stand-in installed in a beta build is ignored if read as a store build', () => {
    g.__DEV__ = false;
    g.__QA_APP_ID__ = 'app.referendumcitoyen.fr.beta';
    const { setQaNativeScanOverride, qaNativeScanOverride } = require('@/utils/qa-overrides');
    expect(setQaNativeScanOverride(async () => '{}')).toBe(true);
    asStoreBuild();
    expect(qaNativeScanOverride()).toBeNull();
    setQaNativeScanOverride(null);
  });

  it('the beta app shows the list', () => {
    g.__DEV__ = false;
    g.__QA_APP_ID__ = 'app.referendumcitoyen.fr.beta';
    resetActions();
    const Screen = require('@/app/qa-gallery').default as React.ComponentType;
    const r = render(
      <Providers>
        <Screen />
      </Providers>,
    );
    expect(allActions().some((a) => a.id.startsWith('redirect'))).toBe(false);
    expect(r.getByText(/QA 2\.0\.2/)).toBeTruthy();
    r.unmount();
  });

  it('no screen or component links to the gallery (no menu entry)', () => {
    const root = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) {
          // A route path in a string: router.push('/qa-gallery'), href="/qa-gallery…".
          if (/['"`]\/qa-gallery/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
        }
      }
    };
    for (const d of ['app', 'components', 'contexts', 'hooks', 'utils', 'constants']) walk(path.join(root, d));
    // The app's own code never navigates there; only qa/ (the gallery itself) does.
    expect(offenders).toEqual([]);
  });
});
