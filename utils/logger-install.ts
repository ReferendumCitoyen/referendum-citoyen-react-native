// Side-effect import: installs the console interceptor and starts the periodic
// sweep timer. Imported as the first line of app/_layout.tsx so the rest of
// the app's module init is captured. Kept as a separate module so the imports
// in _layout.tsx stay ESLint-clean (no statements between import lines).
import { install, startSweep } from './logger';
install();
startSweep();
