import { Platform } from 'react-native';

const mockProbe = jest.fn();
jest.mock('@modules/witnesscalculator/src/WitnesscalculatorModule', () => ({
  __esModule: true,
  default: { probeNoirLibrary: () => mockProbe() },
}));

import {
  assertProverCanRun,
  classifyNoirProbe,
  DEVICE_UNSUPPORTED,
  isUnsupportedPhone,
  runNoirProbeOnce,
  subscribeUnsupportedPhone,
  __resetDeviceSupportForTests,
  type NoirProbeStatus,
} from './device-support';
import { step7ErrorMessage } from './step7-error-message';

// What WitnesscalculatorModule.kt's probeNoirLibrary() returned on the
// 32-bit Samsung A13 installs (2.0.0 and 2.0.1 build 24).
const NOT_FOUND =
  'dlopen failed: library "libnoir_java.so" not found';
const CLASSLOADER =
  'dalvik.system.PathClassLoader[DexPathList[[zip file "/data/app/~~Xy12ab==/fr.app-Q9==/base.apk"],' +
  'nativeLibraryDirectories=[/data/app/~~Xy12ab==/lib/arm]]] couldn\'t find "libnoir_java.so"';

describe('classifyNoirProbe', () => {
  it.each([
    ['ok', 'ok'],
    [NOT_FOUND, 'missing'],
    [CLASSLOADER, 'missing'],
    ['dlopen failed: cannot locate symbol "__aeabi_memcpy"', 'failed'],
    [undefined, 'absent'],
    [null, 'absent'],
  ])('%p → %s', (result, status) => {
    expect(classifyNoirProbe(result)).toBe(status);
  });
});

describe('step 7 stops before the proof on an explicit negative probe (item 4)', () => {
  // The order Step7 runs: probe, then the heavy proof, then the relayer POST.
  const run = async (status: NoirProbeStatus) => {
    const prove = jest.fn(async () => 'proof');
    const post = jest.fn(async (_proof: string) => 'tx');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await assertProverCanRun('Ce téléphone ne peut pas générer la preuve de vote.', async () => status);
      await post(await prove());
      return { prove, post, error: null as Error | null, logs: logSpy.mock.calls.flat().join('\n') };
    } catch (e) {
      return { prove, post, error: e as Error, logs: logSpy.mock.calls.flat().join('\n') };
    } finally {
      logSpy.mockRestore();
    }
  };

  it.each(['missing', 'failed'] as NoirProbeStatus[])('%s: nothing is proved or sent', async (status) => {
    const r = await run(status);
    expect(r.prove).not.toHaveBeenCalled();
    expect(r.post).not.toHaveBeenCalled();
    expect(r.error?.message.startsWith(DEVICE_UNSUPPORTED)).toBe(true);
    // The user reads the French sentence, without the sentinel.
    const shown = step7ErrorMessage(r.error, {
      docSfx: 'idCard',
      keyLinkedToOtherDocument: false,
      t: (k) => k,
      fallback: () => 'fallback',
    });
    expect(shown).toBe('Ce téléphone ne peut pas générer la preuve de vote.');
  });

  it.each(['absent', 'ok'] as NoirProbeStatus[])('%s: continues as today', async (status) => {
    const r = await run(status);
    expect(r.error).toBeNull();
    expect(r.prove).toHaveBeenCalledTimes(1);
    expect(r.post).toHaveBeenCalledTimes(1);
  });

  it('logs the status word only, never the loader text', async () => {
    const r = await run('missing');
    expect(r.logs).toBe('[noir-probe] status=missing');
  });
});

describe('shared unsupported-phone state (4b)', () => {
  beforeEach(() => __resetDeviceSupportForTests());
  afterEach(() => jest.restoreAllMocks());

  it('Android without the library: unsupported, probed once, listeners told', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockProbe.mockReturnValue(NOT_FOUND);
    const seen: boolean[] = [];
    subscribeUnsupportedPhone((u) => seen.push(u));
    const [a, b] = await Promise.all([runNoirProbeOnce(), runNoirProbeOnce()]);
    expect(a).toBe('missing');
    expect(b).toBe('missing');
    expect(mockProbe).toHaveBeenCalledTimes(1);
    expect(isUnsupportedPhone()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('Android with a binary that has no probe keeps today\'s behaviour', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockProbe.mockReturnValue(undefined);
    expect(await runNoirProbeOnce()).toBe('absent');
    expect(isUnsupportedPhone()).toBe(false);
  });

  it('iOS (the jest platform) has no probe: never unsupported', async () => {
    const seen: boolean[] = [];
    subscribeUnsupportedPhone((u) => seen.push(u));
    expect(await runNoirProbeOnce()).toBe('absent');
    expect(isUnsupportedPhone()).toBe(false);
    expect(seen).toEqual([false]);
  });
});
