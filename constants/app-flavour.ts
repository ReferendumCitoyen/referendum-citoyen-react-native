/**
 * Which app this binary is.
 *
 * The same code ships as two apps: the beta testers install
 * (`app.referendumcitoyen.fr.beta`) and the store app June's voters already
 * have (`app.referendumcitoyen.fr`). app.config.ts picks identity, icons,
 * EAS project and network exceptions from `APP_FLAVOUR` at build time; at
 * runtime the bundle id is the one fact that cannot drift from the binary,
 * so everything that must behave differently on the store app keys off it
 * here: what the list shows, what a report may carry, what a tester may do.
 *
 * Required lazily so the module stays importable where there is no Expo
 * runtime (jest, scripts); the answer is only ever needed on a device.
 */
export function isBetaBuild(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Application = require('expo-application');
    return String(Application.applicationId ?? '').endsWith('.beta');
  } catch {
    return false;
  }
}
