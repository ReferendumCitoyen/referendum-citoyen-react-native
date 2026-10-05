// Side-effect import: installs the console interceptor and starts the periodic
// sweep timer. Imported as the first line of app/_layout.tsx so the rest of
// the app's module init is captured. Kept as a separate module so the imports
// in _layout.tsx stay ESLint-clean (no statements between import lines).
import { AppState } from 'react-native';
import {
  install,
  noteAppStateForCrashTail,
  rotateCrashTailAtLaunch,
  startCrashTail,
  startSweep,
} from './logger';
install();
startSweep();
// The tail the last session left becomes the "previous" tail BEFORE this
// session writes its own (queued in utils/logger.ts, so the first periodic
// write cannot overtake it). Settings offers only that previous file.
void rotateCrashTailAtLaunch();
// Mirrors the tail to disk every few seconds so a shutdown leaves something
// behind. Without it the buffer is memory-only, and the one time that mattered
// — an app that vanished seconds after a vote on 2026-09-10 — there was
// nothing left to read.
startCrashTail();
// Background state and pending operations jointly determine a clean exit.
// Guard native event subscription so storage tracking cannot block launch.
try {
  AppState.addEventListener('change', (state) => {
    void noteAppStateForCrashTail(state);
  });
} catch {
  // Pending operations remain tracked without lifecycle events.
}
