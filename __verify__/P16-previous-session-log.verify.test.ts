/**
 * P16: "send the previous session's log" produced a report holding the
 * current session (a home screen a few seconds old). Replays two launches on
 * one phone with a persistent cache directory:
 *   - session 1 logs a flow line and dies in the foreground (no background
 *     event), after its tail was mirrored to disk;
 *   - session 2 starts, shows the home screen, runs past one tail write, and
 *     the user opens Settings.
 * The "previous session" text must be session 1's, never session 2's. A
 * session that ended in the background (the user left the app) has nothing
 * to offer.
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
  // What utils/logger-install.ts does at app start, whichever version.
  if (typeof logger.rotateCrashTailAtLaunch === 'function') await logger.rotateCrashTailAtLaunch();
  logger.startCrashTail();
}

async function oneTailWrite(logger: Logger) {
  await jest.advanceTimersByTimeAsync(10_000);
  await flush();
  if (logger.__testing?.drainTail) await logger.__testing.drainTail();
}

function readPrevious(logger: Logger): Promise<string | null> {
  return (logger.readPreviousSessionLog ?? logger.readLastSessionLog)();
}

beforeEach(() => {
  mockFiles.clear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('P16: the previous-session report holds the previous session', () => {
  it('after a foreground death, Settings offers session 1, not the running session 2', async () => {
    const s1 = launch();
    await atLaunch(s1);
    s1.__testing.push('log', '[flow] step 5 → 6 (next) SESSION-ONE');
    await oneTailWrite(s1);
    s1.stopCrashTail();
    // Killed in the foreground: no AppState 'background' event.

    const s2 = launch();
    await atLaunch(s2);
    s2.__testing.push('log', '[Accueil] mounted SESSION-TWO');
    await oneTailWrite(s2);

    const text = await readPrevious(s2);
    s2.stopCrashTail();
    expect(text).toContain('SESSION-ONE');
    expect(text ?? '').not.toContain('SESSION-TWO');
  });

  it('a session that ended in the background leaves nothing to offer', async () => {
    const s1 = launch();
    await atLaunch(s1);
    s1.__testing.push('log', '[Accueil] mounted SESSION-ONE');
    await oneTailWrite(s1);
    if (typeof s1.noteAppStateForCrashTail === 'function') await s1.noteAppStateForCrashTail('background');
    s1.stopCrashTail();

    const s2 = launch();
    await atLaunch(s2);
    s2.__testing.push('log', '[Accueil] mounted SESSION-TWO');
    await oneTailWrite(s2);

    const text = await readPrevious(s2);
    s2.stopCrashTail();
    expect(text).toBeNull();
  });
});
