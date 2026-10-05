const mockFiles = new Map<string, string>();
let mockWriteFailure = false;
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  getInfoAsync: async (uri: string) => ({ exists: mockFiles.has(uri) }),
  readAsStringAsync: async (uri: string) => mockFiles.get(uri) ?? '',
  writeAsStringAsync: async (uri: string, content: string) => {
    if (mockWriteFailure) throw new Error('storage unavailable');
    mockFiles.set(uri, content);
  },
  deleteAsync: async (uri: string) => {
    mockFiles.delete(uri);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from)!);
    mockFiles.delete(from);
  },
}));

function launch(): typeof import('./logger') {
  let logger!: typeof import('./logger');
  jest.isolateModules(() => {
    logger = require('./logger');
  });
  return logger;
}
const path = (name: string) => `file:///cache/${name}`;
const tail = '2000-01-01T00:00:00.000Z ERROR operation failed';
const seedTail = () => mockFiles.set(path('last-session-log.txt'), tail);

beforeEach(() => {
  mockFiles.clear();
  mockWriteFailure = false;
});

it.each(['active', 'background', 'inactive'])(
  'recovers unfinished work after termination in %s',
  async (state) => {
    const first = launch();
    await first.rotateCrashTailAtLaunch();
    seedTail();
    await first.beginTrackedOperation().ready;
    await first.noteAppStateForCrashTail(state);
    const second = launch();
    await second.rotateCrashTailAtLaunch();
    expect(await second.wasPreviousOperationInterrupted()).toBe(true);
    expect(await second.readPreviousSessionLog()).toContain('operation failed');
    expect(mockFiles.has(path('operation-pending.marker'))).toBe(false);
  }
);

it('an ordinary background exit has no interruption or offer', async () => {
  const first = launch();
  seedTail();
  await first.noteAppStateForCrashTail('background');
  const second = launch();
  await second.rotateCrashTailAtLaunch();
  expect(await second.wasPreviousOperationInterrupted()).toBe(false);
  expect(await second.claimPreviousSessionOffer()).toBe(false);
});

it.each(['active', 'background'])(
  'completion or explicit departure clears work while %s',
  async (state) => {
    const first = launch();
    seedTail();
    const work = first.beginTrackedOperation();
    await work.ready;
    await first.noteAppStateForCrashTail(state);
    await work.finish();
    await first.noteAppStateForCrashTail('background');
    const second = launch();
    await second.rotateCrashTailAtLaunch();
    expect(await second.wasPreviousOperationInterrupted()).toBe(false);
    expect(await second.readPreviousSessionLog()).toBeNull();
  }
);

it('background then resume does not finish pending work', async () => {
  const first = launch();
  const work = first.beginTrackedOperation();
  await work.ready;
  await first.noteAppStateForCrashTail('background');
  await first.noteAppStateForCrashTail('active');
  expect(mockFiles.has(path('operation-pending.marker'))).toBe(true);
  expect(mockFiles.has(path('clean-exit.marker'))).toBe(false);
  await work.finish();
});

it('a pending operation overrides an older clean marker', async () => {
  mockFiles.set(path('clean-exit.marker'), '');
  mockFiles.set(path('operation-pending.marker'), '');
  seedTail();
  const second = launch();
  await second.rotateCrashTailAtLaunch();
  expect(await second.wasPreviousOperationInterrupted()).toBe(true);
  expect(await second.readPreviousSessionLog()).not.toBeNull();
});

it('overlapping owners and late repeated completion cannot clear another operation', async () => {
  const logger = launch();
  const old = logger.beginTrackedOperation();
  await old.ready;
  const current = logger.beginTrackedOperation();
  await current.ready;
  await old.finish();
  await old.finish();
  await logger.noteAppStateForCrashTail('background');
  expect(mockFiles.has(path('operation-pending.marker'))).toBe(true);
  expect(mockFiles.has(path('clean-exit.marker'))).toBe(false);
  await current.finish();
  expect(mockFiles.has(path('operation-pending.marker'))).toBe(false);
  expect(mockFiles.get(path('clean-exit.marker'))).toBe('');
});

it('orders launch, begin, departure, new work and app-state writes', async () => {
  const logger = launch();
  const rotation = logger.rotateCrashTailAtLaunch();
  const old = logger.beginTrackedOperation();
  const leaving = old.finish();
  const current = logger.beginTrackedOperation();
  const background = logger.noteAppStateForCrashTail('background');
  await Promise.all([rotation, old.ready, leaving, current.ready, background]);
  expect(mockFiles.get(path('operation-pending.marker'))).toBe('');
  expect(mockFiles.has(path('clean-exit.marker'))).toBe(false);
  await current.finish();
});

it('persists only empty markers for lifecycle and offer state', async () => {
  const logger = launch();
  await logger.beginTrackedOperation().ready;
  expect([...mockFiles.entries()]).toEqual([[path('operation-pending.marker'), '']]);
  seedTail();
  const next = launch();
  await next.rotateCrashTailAtLaunch();
  await next.claimPreviousSessionOffer();
  expect(mockFiles.get(path('previous-session-offered.marker'))).toBe('');
});

it('storage write failure never rejects operation tracking or shows a recurring offer', async () => {
  const logger = launch();
  mockWriteFailure = true;
  const work = logger.beginTrackedOperation();
  await expect(work.ready).resolves.toBeUndefined();
  await expect(work.finish()).resolves.toBeUndefined();
  mockFiles.set(path('previous-session-log.txt'), tail);
  expect(await logger.claimPreviousSessionOffer()).toBe(false);
});

it('records an interruption even without a retained log, but offers nothing', async () => {
  mockFiles.set(path('operation-pending.marker'), '');
  const logger = launch();
  await logger.rotateCrashTailAtLaunch();
  expect(await logger.wasPreviousOperationInterrupted()).toBe(true);
  expect(await logger.claimPreviousSessionOffer()).toBe(false);
});

it('offers a foreground interruption from an earlier app version', async () => {
  seedTail();
  const logger = launch();
  await logger.rotateCrashTailAtLaunch();
  expect(await logger.claimPreviousSessionOffer()).toBe(true);
});

it('claims an offer only once, including concurrent readers and later launches', async () => {
  seedTail();
  const logger = launch();
  await logger.rotateCrashTailAtLaunch();
  expect(
    await Promise.all([logger.claimPreviousSessionOffer(), logger.claimPreviousSessionOffer()])
  ).toEqual([true, false]);
  const next = launch();
  await next.rotateCrashTailAtLaunch();
  expect(await next.claimPreviousSessionOffer()).toBe(false);
  expect(await next.readPreviousSessionLog()).toContain('operation failed');
});

it('a new tail can be offered after the earlier offer was consumed', async () => {
  seedTail();
  const first = launch();
  await first.rotateCrashTailAtLaunch();
  await first.claimPreviousSessionOffer();
  seedTail();
  const next = launch();
  await next.rotateCrashTailAtLaunch();
  expect(await next.claimPreviousSessionOffer()).toBe(true);
});

it('refusal removes the retained log and cannot reoffer it', async () => {
  seedTail();
  const logger = launch();
  await logger.rotateCrashTailAtLaunch();
  await logger.claimPreviousSessionOffer();
  await logger.clearPreviousSessionLog();
  const next = launch();
  await next.rotateCrashTailAtLaunch();
  expect(await next.readPreviousSessionLog()).toBeNull();
  expect(await next.claimPreviousSessionOffer()).toBe(false);
});

it('never offers a tail entirely removed by the existing vote filter', async () => {
  mockFiles.set(
    path('last-session-log.txt'),
    '2000-01-01T00:00:00.000Z LOG [flow] step → 12 (vote-submitted)'
  );
  mockFiles.set(path('operation-pending.marker'), '');
  const logger = launch();
  await logger.rotateCrashTailAtLaunch();
  expect(await logger.readPreviousSessionLog()).toBeNull();
  expect(await logger.claimPreviousSessionOffer()).toBe(false);
});
