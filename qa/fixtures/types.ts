/**
 * The QA gallery catalogue: one entry per user-visible UI state of 2.0.2.
 *
 * Each entry is data (what the inventory, the functional tests and the Maestro
 * flows read) plus, when the state can be shown without a chip, a chain or a
 * network, a `render` function the gallery route calls.
 */
import type { ReactElement } from 'react';

/** Where the state sits in 2.0.2 compared with 52cbab4 (the 2.0.1 base). */
export type ChangeStatus = 'NEW' | 'CHANGED' | 'unchanged';

/**
 * How the gallery shows it.
 *  - `flow`: inside a copy of the voting flow's chrome (iOS modal sheet with
 *    the native "Fermer" header, Android card with the top inset), because
 *    that chrome is what decides whether a button fits on screen.
 *  - `screen`: a full screen of its own (home banner, Settings, Vérifier).
 *  - `alert`: a button that opens the real native alert.
 */
export type Frame = 'flow' | 'screen' | 'alert';

/**
 * Where the state can be exercised.
 *  - `gallery`: rendered by the gallery route and by the jest suite;
 *  - `jest`: needs a mocked module the app cannot mock at runtime (network
 *    answer, SecureStore content), so only the jest suite renders it;
 *  - `manual`: reproducible by hand on a phone (NFC off, iPad, camera), not
 *    rendered in the gallery;
 *  - `dormant`: code present but unreachable in 2.0.2 (passport flow behind
 *    CARD_ONLY_LAUNCH): listed for completeness only.
 */
export type Runtime = 'gallery' | 'jest' | 'manual' | 'dormant';

export interface ExpectedButton {
  /** Translation key of the visible label (or `text` for a literal label). */
  key?: string;
  text?: string;
  /** Interpolation values for the label key. */
  params?: Record<string, unknown>;
  /** For a button with no text and no label (icon only): its testID. */
  testID?: string;
  /**
   * What pressing it does in the app, e.g. `onRetry → step 11 (vote only)` or
   * `router.replace('/verifier')`. In the gallery the prop is a recorder that
   * shows this text; the jest suite asserts the recorder received `action`.
   */
  action: string;
  /** Recorder id the jest suite expects (defaults to the first word of action). */
  recorder?: string;
  /** The button is shown disabled in this state (e.g. Continue before 6 digits). */
  disabled?: boolean;
  /** Pressing it opens a real side effect we do not follow in automation
   *  (mail composer, store page, share sheet). Maestro only checks it. */
  noTapInAutomation?: boolean;
  /** Shown on one platform only. */
  platform?: 'ios' | 'android';
  /** Shown in the beta app only. */
  betaOnly?: boolean;
  /** For a real navigation (not a recorder): a text key the destination
   *  screen shows, for the automation to assert. */
  destinationKey?: string;
}

/** A step the automation performs before the screenshot (type, tap). */
export type PreludeStep =
  | { tap: { key?: string; text?: string; testID?: string } }
  | { type: string; into?: { key?: string } }
  | { wait: number };

export interface TextExpectation {
  key: string;
  /** Interpolation values; `defaultValue` when the component passes one. */
  params?: Record<string, unknown>;
  /** Shown on one platform only (e.g. the title Android draws itself and
   *  iOS puts in the native header). */
  platform?: 'ios' | 'android';
}

export interface GalleryState {
  id: string;
  group: string;
  /** Component or screen file the state belongs to. */
  component: string;
  frame: Frame;
  runtime: Runtime;
  /** The error code / condition that produces the state in the app. */
  trigger: string;
  /** Texts the voter reads (translation keys), in screen order. */
  texts: TextExpectation[];
  buttons: ExpectedButton[];
  /** false when `buttons` lists only the buttons that matter for 2.0.2 (a
   *  whole Settings screen): the suite then does not flag the others. */
  buttonsComplete?: boolean;
  /** NEW / CHANGED / unchanged; computed by the generator from the diff
   *  52cbab4..7e5c760 unless forced here. */
  status?: ChangeStatus;
  /** Free notes for the inventory (priority rules, platform differences). */
  notes?: string;
  /** Steps before the screenshot (Maestro and jest). */
  prelude?: PreludeStep[];
  /** Milliseconds the state needs to settle after the prelude. */
  settleMs?: number;
  /** Which document the texts name. */
  doc?: 'idCard' | 'passport';
  /** Jest only: globals the suite sets before rendering (what the app would
   *  read from disk, e.g. a previous session log). */
  jestGlobals?: Record<string, unknown>;
  render?: (ctx: GalleryCtx) => ReactElement;
}

export interface GalleryCtx {
  /** A callback that records `id` (and shows `label` in the overlay). */
  act: (id: string, label?: string) => (...args: unknown[]) => void;
  /** Width of the gallery viewport. */
  width: number;
}
