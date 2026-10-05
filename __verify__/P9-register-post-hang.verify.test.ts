/**
 * P9: the register POST was sent and nothing came back for 11 minutes
 * (field report of 19/09). Replays a relayer that never
 * answers: the call must end on its own within a bounded time, and with one
 * POST only.
 */
// The POST writes the durable "sent, outcome unknown" marker before it goes
// out (AV4), so the relayer module now reaches AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@/utils/heavy-noir-inputs', () => ({
  buildHeavyRegisterInputs: jest.fn(),
  slaveCertSmtLeafKey: jest.fn(),
}));
jest.mock('@/utils/relayer-simulation', () => ({ assertWouldNotRevert: jest.fn(async () => {}) }));

import { submitToRegistrationRelayer } from '@/utils/register-via-noir';

const realFetch = global.fetch;
let posts = 0;

beforeEach(() => {
  posts = 0;
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // A request that left the phone and never gets an answer; it only ends if
  // the caller aborts it.
  global.fetch = jest.fn((_url: any, init: any) => {
    posts++;
    return new Promise((_res, rej) => {
      init?.signal?.addEventListener?.('abort', () => rej(new Error('Aborted')));
    });
  }) as any;
});
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('P9: a register POST without an answer does not hang for minutes', () => {
  it('settles within 2 minutes, with a single POST', async () => {
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let error: any;
    submitToRegistrationRelayer('mainnet', '0x00').then(
      () => { settled = 'resolved'; },
      (e) => { settled = 'rejected'; error = e; },
    );
    await jest.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe('rejected');
    // Not a refusal the app may retry by POSTing again.
    expect(String(error?.message)).not.toMatch(/relayer [45]\d\d/);
    expect(posts).toBe(1);
  });
});
