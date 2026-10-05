/**
 * Can this phone run the Noir prover at all? (items 4 and 4b of the 2.0.2
 * dossier). A 32-bit install cannot load libnoir_java.so, and every vote then
 * fails at the proof with "provePlonk has been rejected", after the 300 MB
 * circuit download and the whole card scan.
 *
 * WitnesscalculatorModule.kt's probeNoirLibrary() (Android) answers "ok" or
 * the loader's error text. Four outcomes:
 *   - absent: no probe (iOS, or a binary without the function). Today's
 *     behaviour is kept everywhere.
 *   - ok: nothing to do.
 *   - missing ("… not found" / "couldn't find …"): the library is not in the
 *     install. The home screen shows the unsupported-phone banner and skips
 *     the download; step 7 stops before any proof or registration request.
 *   - failed (any other loader error): step 7 stops the same way (the proof
 *     cannot run), but the home banner is kept for "missing" only, as 4b asks.
 *
 * The probe text is never logged or shown: Android install paths in it carry
 * a per-install random string. Only the status word leaves this file.
 *
 * One module, one state: the home's app banner (utils/update-notice.ts,
 * resolveAppBanner) reads this probe through useUnsupportedPhone() /
 * useDeviceUnsupported(), and the unsupported-phone banner wins over the green
 * and red update banners (R10, item 4b): a phone that can never prove must not
 * be told to update forever.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type NoirProbeStatus = 'ok' | 'missing' | 'failed' | 'absent';

/** Sentinel prefix for the step 7 error (step7-error-message.ts shows its body). */
export const DEVICE_UNSUPPORTED = '[DEVICE_UNSUPPORTED]';

export function classifyNoirProbe(result: unknown): NoirProbeStatus {
  if (typeof result !== 'string') return 'absent';
  if (result === 'ok') return 'ok';
  if (/not found|couldn'?t find|could not find/i.test(result)) return 'missing';
  return 'failed';
}

type ProbeFn = () => unknown;

async function loadProbe(): Promise<ProbeFn | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const { default: Witnesscalculator } = await import(
      '@modules/witnesscalculator/src/WitnesscalculatorModule'
    );
    const fn = (Witnesscalculator as { probeNoirLibrary?: ProbeFn } | undefined)?.probeNoirLibrary;
    return typeof fn === 'function' ? () => fn.call(Witnesscalculator) : null;
  } catch {
    return null;
  }
}

/** Runs the native probe. Never throws: an unavailable probe is 'absent'. */
export async function probeNoirLibrary(): Promise<NoirProbeStatus> {
  const probe = await loadProbe();
  if (!probe) return 'absent';
  try {
    return classifyNoirProbe(probe());
  } catch {
    return 'absent';
  }
}

/** True when the prover certainly cannot run on this phone. */
export function noirCannotRun(status: NoirProbeStatus): boolean {
  return status === 'missing' || status === 'failed';
}

/**
 * Step 7, right before the heavy proof: stops with the unsupported-phone
 * message on an explicit negative probe, so nothing is proved or sent. An
 * absent probe continues exactly as before.
 */
export async function assertProverCanRun(
  message: string,
  probe: () => Promise<NoirProbeStatus> = runNoirProbeOnce,
): Promise<NoirProbeStatus> {
  const status = await probe();
  console.log(`[noir-probe] status=${status}`);
  if (noirCannotRun(status)) throw new Error(`${DEVICE_UNSUPPORTED} ${message}`);
  return status;
}

// --- shared state for the home screen (4b) ---------------------------------
// One probe per process. Exposed so any banner code reads the same answer.

let probeStatus: NoirProbeStatus | null = null;
let probeInflight: Promise<NoirProbeStatus> | null = null;
const listeners = new Set<(unsupported: boolean) => void>();

export function runNoirProbeOnce(): Promise<NoirProbeStatus> {
  if (probeStatus) return Promise.resolve(probeStatus);
  if (!probeInflight) {
    probeInflight = probeNoirLibrary().then((status) => {
      probeStatus = status;
      const unsupported = isUnsupportedPhone();
      listeners.forEach((l) => { try { l(unsupported); } catch {} });
      return status;
    });
  }
  return probeInflight;
}

/** The home banner's condition: the prover library is missing from the install. */
export function isUnsupportedPhone(): boolean {
  return probeStatus === 'missing';
}

export function subscribeUnsupportedPhone(listener: (unsupported: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** React view of isUnsupportedPhone(); banners use it to take precedence. */
export function useUnsupportedPhone(): boolean {
  const [unsupported, setUnsupported] = useState(isUnsupportedPhone());
  useEffect(() => {
    setUnsupported(isUnsupportedPhone());
    return subscribeUnsupportedPhone(setUnsupported);
  }, []);
  return unsupported;
}

/** Names used by the app-version banner code (item 9): same state as above. */
export const isDeviceUnsupported = isUnsupportedPhone;
export const useDeviceUnsupported = useUnsupportedPhone;

/** Tests only: installs a probe answer as if the native probe had given it. */
export function __setProbeStatusForTests(status: NoirProbeStatus): void {
  probeStatus = status;
  probeInflight = Promise.resolve(status);
  const unsupported = isUnsupportedPhone();
  listeners.forEach((l) => { try { l(unsupported); } catch {} });
}

/** Tests only. */
export function __resetDeviceSupportForTests(): void {
  probeStatus = null;
  probeInflight = null;
  listeners.clear();
}
