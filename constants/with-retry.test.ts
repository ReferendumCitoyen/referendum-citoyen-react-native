/**
 * withRetry's per-attempt bound (dossier 2.0.2, AV1 / plan D2): a read that
 * never settles is a failed attempt, and the whole call ends within
 * attempts x bound + pauses instead of hanging for ever.
 */
jest.mock('@rarimo/rarime-rn-sdk', () => ({}));
import { withRetry } from './rarime-config';

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('three hung attempts of 20 s and two 3 s pauses end in 66 s with the timeout message', async () => {
  const fn = jest.fn(() => new Promise<never>(() => {}));
  let error: any;
  withRetry(fn, { attemptTimeoutMs: 20_000, timeoutMessage: '[X] late' }).catch((e) => { error = e; });
  await jest.advanceTimersByTimeAsync(65_999);
  expect(error).toBeUndefined();
  await jest.advanceTimersByTimeAsync(2);
  expect(error?.message).toBe('[X] late');
  expect(fn).toHaveBeenCalledTimes(3);
});

it('a hung first attempt is followed by a second one that answers', async () => {
  const fn = jest
    .fn<Promise<string>, []>()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockImplementationOnce(async () => 'ok');
  let value: string | undefined;
  withRetry(fn, { attemptTimeoutMs: 20_000 }).then((v) => { value = v; });
  await jest.advanceTimersByTimeAsync(23_001);
  expect(value).toBe('ok');
});

it('without a bound, behaviour is unchanged and no timer is left', async () => {
  await expect(withRetry(async () => 1)).resolves.toBe(1);
  expect(jest.getTimerCount()).toBe(0);
  await expect(withRetry(async () => 2, { attemptTimeoutMs: 1_000 })).resolves.toBe(2);
  expect(jest.getTimerCount()).toBe(0);
});
