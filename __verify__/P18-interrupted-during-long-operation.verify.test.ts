/**
 * P18: a session that goes to the background while an operation is pending and
 * never comes back was interrupted, not left.
 *
 * Before, the two were indistinguishable: any background event wrote a
 * clean-exit marker and the next launch threw the previous tail away. A session
 * reclaimed by the system mid-operation therefore left nothing behind, which is
 * precisely the case that has to be visible.
 *
 * Replays launches on one phone with a persistent cache directory and checks
 * the files themselves, not the hook that drives them.
 */
const mockFiles = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  getInfoAsync: async (uri: string) => ({ exists: mockFiles.has(uri) }),
  readAsStringAsync: async (uri: string) => {
    if (!mockFiles.has(uri)) throw new Error('ENOENT');
    return mockFiles.get(uri)!;
  },
  writeAsStringAsync: async (uri: string, content: string) => { mockFiles.set(uri, content); },
  deleteAsync: async (uri: string) => { mockFiles.delete(uri); },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    if (!mockFiles.has(from)) throw new Error('ENOENT');
    mockFiles.set(to, mockFiles.get(from)!);
    mockFiles.delete(from);
  },
}));

type Logger = Record<string, any>;

function launch(): Logger {
  let mod: Logger = {};
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/utils/logger');
  });
  return mod;
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function atLaunch(logger: Logger) {
  await logger.rotateCrashTailAtLaunch();
  logger.startCrashTail();
}

async function oneTailWrite(logger: Logger) {
  await jest.advanceTimersByTimeAsync(10_000);
  await flush();
  if (logger.__testing?.drainTail) await logger.__testing.drainTail();
}

beforeEach(() => {
  mockFiles.clear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('P18: interrupted mid-operation is not the same as left', () => {
  it('nothing pending: a background exit still discards the tail, as before', async () => {
    const s1 = launch();
    await atLaunch(s1);
    s1.__testing.push('log', '[Accueil] mounted IDLE-SESSION');
    await oneTailWrite(s1);
    await s1.noteAppStateForCrashTail('background');
    await flush();
    s1.stopCrashTail();

    const s2 = launch();
    await atLaunch(s2);
    expect(await s2.readPreviousSessionLog()).toBeNull();
    expect(await s2.wasPreviousOperationInterrupted()).toBe(false);
    s2.stopCrashTail();
  });

  it('an operation pending: the tail survives and the launch knows it', async () => {
    const s1 = launch();
    await atLaunch(s1);
    s1.__testing.push('log', '[flow] step 6 → 7 (next) BUSY-SESSION');
    await oneTailWrite(s1);
    const op = s1.beginTrackedOperation();
    await op.ready;
    await s1.noteAppStateForCrashTail('background');
    await flush();
    // Reclaimed by the system: it never comes back and never finishes.
    s1.stopCrashTail();

    const s2 = launch();
    await atLaunch(s2);
    expect(await s2.wasPreviousOperationInterrupted()).toBe(true);
    expect(await s2.readPreviousSessionLog()).toContain('BUSY-SESSION');
    s2.stopCrashTail();
  });

  it('the operation finished before leaving: nothing is kept', async () => {
    const s1 = launch();
    await atLaunch(s1);
    s1.__testing.push('log', '[flow] step 6 → 7 (next) FINISHED-SESSION');
    await oneTailWrite(s1);
    const op = s1.beginTrackedOperation();
    await op.ready;
    await op.finish();
    await s1.noteAppStateForCrashTail('background');
    await flush();
    s1.stopCrashTail();

    const s2 = launch();
    await atLaunch(s2);
    expect(await s2.wasPreviousOperationInterrupted()).toBe(false);
    expect(await s2.readPreviousSessionLog()).toBeNull();
    s2.stopCrashTail();
  });

  it('two overlapping operations: the first to finish does not clear the second', async () => {
    const s1 = launch();
    await atLaunch(s1);
    s1.__testing.push('log', '[flow] step 6 → 7 (next) OVERLAP-SESSION');
    await oneTailWrite(s1);
    const a = s1.beginTrackedOperation();
    const b = s1.beginTrackedOperation();
    await a.ready; await b.ready;
    await a.finish();
    await s1.noteAppStateForCrashTail('background');
    await flush();
    s1.stopCrashTail();

    const s2 = launch();
    await atLaunch(s2);
    expect(await s2.wasPreviousOperationInterrupted()).toBe(true);
    s2.stopCrashTail();
  });

  it('the markers are presence only and carry no content at all', async () => {
    const s1 = launch();
    await atLaunch(s1);
    const op = s1.beginTrackedOperation();
    await op.ready;
    await s1.noteAppStateForCrashTail('background');
    await flush();
    const markers = [...mockFiles.entries()].filter(([k]) => k.endsWith('.marker'));
    s1.stopCrashTail();
    expect(markers.length).toBeGreaterThan(0);
    for (const [, content] of markers) expect(content).toBe('');
  });
});
