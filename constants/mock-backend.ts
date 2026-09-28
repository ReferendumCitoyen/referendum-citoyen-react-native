// Whether the register/vote pipeline is stubbed out.
//
// When on, Step7 (register) and Step11 (vote) short-circuit to a simulated
// success instead of calling the relayer or submitting on-chain, and Step5's
// citizenship (nationality) check is bypassed so any passport nationality is
// accepted rather than the active proposal's real whitelist.
//
// Build default vs runtime override
// ---------------------------------
// This used to be a plain `const` flipped by hand before a build. That failed
// in a specific and expensive way: the edit lived as an UNCOMMITTED working-
// tree change, EAS uploads uncommitted changes, and so the value that actually
// shipped depended on the state of one person's checkout — invisible to
// everyone, including whoever later read the resulting error report. Builds
// went out claiming one behaviour and having the other.
//
// So the committed value is now the DEFAULT, overridable at runtime from
// Settings behind the same 7-tap dev-mode gate that already guards the other
// behaviour-changing switches (contexts/DevModeContext; Step5 already reads
// `devMode || <this>` for its citizenship bypass). The effective value and
// whether it was overridden are printed in every error report header
// (utils/logger.ts), so a report can no longer misrepresent which pipeline
// produced it.
//
// The default is `false` — the real pipeline — because that is what every
// build has in fact been shipping via the uncommitted edit. `true` would be
// the safer default in the abstract, but changing it here would silently alter
// what testers get and invite the exact failure this note describes: someone
// reporting "the vote worked" from a stubbed build.
import { isBetaBuild } from '@/constants/app-flavour';

export const MOCK_BACKEND_BUILD_DEFAULT = false;

const OVERRIDE_STORAGE_KEY = '@referendum/mock-backend-override';

// Module-level rather than React state on purpose: every consumer reads this
// from inside an async flow (Step7's registration, Step11's submit, Step5's
// gate), never during render, so there is nothing to re-render and a context
// would add coupling for no benefit. Settings holds its own switch state.
let override: boolean | null = null;

/** The value the app should actually behave by. */
export function isMockBackend(): boolean {
  // The store app runs the real pipeline, whatever this phone's storage
  // says: the override is a tester's switch, and the store app has no dev
  // mode to set it from (contexts/DevModeContext.tsx).
  if (!isBetaBuild()) return MOCK_BACKEND_BUILD_DEFAULT;
  return override ?? MOCK_BACKEND_BUILD_DEFAULT;
}

/** `null` when no override is set — i.e. the build default is in force. */
export function mockBackendOverride(): boolean | null {
  return override;
}

/**
 * Set (or clear, with `null`) the runtime override and persist it.
 *
 * Persisted deliberately: a testing pass involves app restarts, and an
 * override that reset on launch would be worse than useless — the tester would
 * believe they were on the real pipeline while actually running the stub. The
 * cost is that it outlives the dev-mode session that set it, which is why the
 * report header carries it.
 */
export async function setMockBackendOverride(value: boolean | null): Promise<void> {
  override = value;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    if (value === null) await AsyncStorage.removeItem(OVERRIDE_STORAGE_KEY);
    else await AsyncStorage.setItem(OVERRIDE_STORAGE_KEY, value ? 'true' : 'false');
  } catch (e) {
    // The in-memory value still applies for this session; a failed write only
    // means it won't survive a restart.
    console.warn('[mock-backend] could not persist override:', e);
  }
}

/**
 * Load any persisted override. Called once at startup, before the voting flow
 * is reachable — hydrating late would let a run that believes it is stubbed
 * start against the real pipeline.
 */
export async function hydrateMockBackendOverride(): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const stored = await AsyncStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (stored === 'true') override = true;
    else if (stored === 'false') override = false;
    else override = null;
  } catch (e) {
    console.warn('[mock-backend] could not read override, using build default:', e);
    override = null;
  }
  if (override !== null && override !== MOCK_BACKEND_BUILD_DEFAULT) {
    console.warn(
      `[mock-backend] RUNTIME OVERRIDE ACTIVE: ${override} (build default ${MOCK_BACKEND_BUILD_DEFAULT})`,
    );
  }
}

export const mockDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Cosmetic only — displayed in Step12Success as the "vote identifier" but
// never submitted anywhere or checked against anything on-chain.
export const mockTxHash = () =>
  '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
