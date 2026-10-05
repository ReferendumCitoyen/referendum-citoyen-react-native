/**
 * Hand the bundled Noir circuits to the Rarime SDK.
 *
 * Why this is its own module
 * --------------------------
 * `generateHeavyNoirProof` looks the bytecode up by name via
 * `Rarime.getBundledCircuit(name)` and throws if nothing was registered. That
 * registration used to live inline in `app/voting-flow.tsx`'s init effect,
 * which meant any entry point that reaches the prover *without* mounting the
 * voting flow — notably the `app/french-id-test.tsx` dev screen — failed with
 * "bundled bytecode missing" after having already done the slow work (NFC
 * scan, CSCA bootstrap, SMT read). One idempotent call all of them can make.
 *
 * Deliberately NOT in `utils/heavy-circuits.ts`: that module is imported by
 * `utils/register-via-noir.ts` and transitively by much of the app, and the
 * `require()`s below inline ~11.6 MB of ACIR into whatever bundle reaches
 * them. `.json` is not in metro's `assetExts` (see metro.config.js), so these
 * resolve through `sourceExts` and are parsed into the JS bundle rather than
 * shipped as file assets. Keeping them behind a module only the call sites
 * import — all dynamically — keeps that weight off every other path.
 *
 * Bundle size vs runtime memory — they are not the same thing
 * ----------------------------------------------------------
 * Metro does not tree-shake, so all four artifacts are inlined into the JS
 * bundle no matter which ones get registered: ~11.6 MB of ACIR, and the iOS
 * Hermes bundle measures 16.3 MB with two circuits and 21.7 MB with four.
 * Nothing here can change that.
 *
 * What it CAN change is what gets *parsed and retained*. Each `require()` is
 * deferred inside `LOADERS` below, so a circuit nobody asks for is never
 * parsed. That matters more than it looks, because the SDK's
 * `registerBundledCircuit` does `JSON.stringify` on what it is handed — so a
 * registered circuit is retained TWICE, once as the parsed module object Metro
 * caches and once as the SDK's string copy. Registering all four costs roughly
 * 24 MB of retained heap where two cost 12 MB, which is real on the low-end
 * Android hardware this gets tested on.
 *
 * Hence: callers say what they need. The voting flow passes the two register
 * circuits explicitly, so a circuit added to this table later never costs the
 * ordinary voter path anything.
 */

import { HEAVY_CIRCUIT_NAMES } from '@/utils/heavy-circuits';

/**
 * Deferred loaders, keyed by the name the circuit is registered under. The
 * `require()` must stay inside the arrow: calling it is what parses ~3 MB of
 * JSON, and the whole point is that an unasked-for circuit never gets parsed.
 */
const LOADERS: Record<string, () => object> = {
  [HEAVY_CIRCUIT_NAMES.passport]: () =>
    require('@/assets/circuits/registerIdentity_1_256_3_5_576_248_NA.json'),
  [HEAVY_CIRCUIT_NAMES.idCard]: () =>
    require('@/assets/circuits/registerIdentity_1_256_1_6_960_248_NA.json'),
};

/**
 * The two heavy *register* circuits — everything the voting flow can ever
 * need. Exported so that call site names its requirement instead of spelling
 * out strings.
 */
export const REGISTER_CIRCUIT_NAMES: string[] = [
  HEAVY_CIRCUIT_NAMES.passport,
  HEAVY_CIRCUIT_NAMES.idCard,
];

/** Names already handed to the SDK, so repeat calls are cheap. */
const registered = new Set<string>();

/**
 * Register the named bundled circuits with the SDK. Safe to call repeatedly
 * and safe to call with overlapping sets — anything already registered is
 * skipped, so callers don't have to coordinate.
 *
 * `only` defaults to every bundled circuit. Prefer passing the specific names
 * you need: see the memory note in this file's header for why that is not
 * merely cosmetic.
 */
export async function registerHeavyBundledCircuits(only?: string[]): Promise<void> {
  const wanted = only ?? Object.keys(LOADERS);
  const todo = wanted.filter((name) => !registered.has(name));
  if (todo.length === 0) return;

  // Fail loudly on a name with no artifact behind it. The alternative is a
  // silent no-op here and a "bundled bytecode missing" throw thousands of
  // lines away, after the NFC scan and SMT read have already been paid for.
  const unknown = todo.filter((name) => !LOADERS[name]);
  if (unknown.length > 0) {
    throw new Error(
      `[bundled-circuits] no bundled artifact for ${unknown.join(', ')}. ` +
      `Known: ${Object.keys(LOADERS).join(', ')}.`,
    );
  }

  const { Rarime } = await import('@rarimo/rarime-rn-sdk');
  for (const name of todo) {
    Rarime.registerBundledCircuit(name, LOADERS[name]());
    registered.add(name);
  }

  console.log(
    `[bundled-circuits] registered ${todo.join(', ')} ` +
    `(${registered.size}/${Object.keys(LOADERS).length} loaded); light + query come from CDN.`,
  );
}
