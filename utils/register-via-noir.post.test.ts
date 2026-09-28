/**
 * Dossier 2.0.2, item 3 (e): the registration POST is bounded (request and
 * body read), and every failure to get its answer is "sent, outcome unknown",
 * never a refusal a caller could retry by POSTing again.
 */
import { REGISTRATION_OUTCOME_UNKNOWN } from './registration-sentinels';

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
jest.mock('./heavy-noir-inputs', () => ({
  buildHeavyRegisterInputs: jest.fn(),
  slaveCertSmtLeafKey: jest.fn(),
}));
jest.mock('./relayer-simulation', () => ({ assertWouldNotRevert: jest.fn(async () => {}) }));

import { RELAYER_POST_TIMEOUT_MS, submitToRegistrationRelayer } from './register-via-noir';

const realFetch = global.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function mockFetch(impl: (init: any) => Promise<any>) {
  global.fetch = jest.fn((_url: any, init: any) => { fetchCalls++; return impl(init); }) as any;
}

describe('submitToRegistrationRelayer', () => {
  it('a network failure after sending is "outcome unknown", with one POST only', async () => {
    mockFetch(async () => { throw new TypeError('Network request failed'); });
    await expect(submitToRegistrationRelayer('mainnet', '0x00')).rejects.toThrow(
      REGISTRATION_OUTCOME_UNKNOWN,
    );
    expect(fetchCalls).toBe(1);
  });

  it('gives up after 90 s, request and body read included, as "outcome unknown"', async () => {
    jest.useFakeTimers();
    mockFetch(
      (init) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(new Error('Aborted')));
        }),
    );
    const p = submitToRegistrationRelayer('mainnet', '0x00');
    const assertion = expect(p).rejects.toThrow(/did not answer within 90 s/);
    await jest.advanceTimersByTimeAsync(RELAYER_POST_TIMEOUT_MS);
    await assertion;
    expect(fetchCalls).toBe(1);
  });

  it('a body that stalls is bounded too', async () => {
    jest.useFakeTimers();
    mockFetch(async (init) => ({
      status: 200,
      statusText: 'OK',
      text: () =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(new Error('Aborted')));
        }),
    }));
    const p = submitToRegistrationRelayer('mainnet', '0x00');
    const assertion = expect(p).rejects.toThrow(REGISTRATION_OUTCOME_UNKNOWN);
    await jest.advanceTimersByTimeAsync(RELAYER_POST_TIMEOUT_MS);
    await assertion;
  });

  it('a relayer refusal is still reported as the relayer refusal', async () => {
    mockFetch(async () => ({ status: 400, statusText: 'Bad Request', text: async () => 'bad proof' }));
    await expect(submitToRegistrationRelayer('mainnet', '0x00')).rejects.toThrow(
      '[registerViaNoir] relayer 400 Bad Request: bad proof',
    );
  });

  it('returns the tx hash on success', async () => {
    mockFetch(async () => ({
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ data: { attributes: { tx_hash: '0x1234' } } }),
    }));
    await expect(submitToRegistrationRelayer('mainnet', '0x00')).resolves.toEqual({ txHash: '0x1234' });
  });
});
