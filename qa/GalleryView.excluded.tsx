/**
 * What `@/qa/GalleryView` resolves to in a store (production, non-dev) bundle.
 *
 * The QA gallery is already inert on the store app: both routes call
 * qaAllowed() and redirect to the home before rendering anything
 * (qa/production-guard.test.tsx pins that). But the run-time guard cannot stop
 * the gallery and its ~1 MB of fixtures being INSIDE the binary, and "the QA
 * screen ships in the store app" is a true sentence a reviewer can say. Metro
 * has no code splitting for native, so React.lazy would only defer evaluation,
 * not remove the code; swapping the module at resolution time does remove it.
 *
 * metro.config.js points at this file when APP_FLAVOUR=production and
 * NODE_ENV=production, i.e. exactly the release bundle of the store app. Any
 * other bundle (the beta app, a dev client, Metro in development, the QA web
 * preview, a jest run) gets the real gallery, so the beta gallery and the
 * Maestro deep links are untouched.
 *
 * It renders nothing rather than throwing: the routes redirect first, so this
 * is only ever mounted if that guard were ever removed, and an empty screen is
 * a better failure than a crash.
 */
import React from 'react';

export const FLOW_ROUTE = '/qa-gallery-flow';
export const LIST_ROUTE = '/qa-gallery';

export function GalleryView(_props: { presentation: 'card' | 'flow' }): React.ReactElement | null {
  return null;
}
