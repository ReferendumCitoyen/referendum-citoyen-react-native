import {
  createNfcScanOwner,
  ANDROID_MIN_GAP_MS,
  ANDROID_SCAN_TIMEOUT_MS,
  IOS_SAFETY_NET_MS,
  NFC_SCAN_TIMEOUT_MESSAGE,
  type ScanOutcome,
} from './nfc-scan-owner';

// A native scan that only settles when the test says so.
function deferredScan<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const setup = (platform: 'ios' | 'android') => {
  const cancelNative = jest.fn(() => Promise.resolve());
  const owner = createNfcScanOwner({ platform, cancelNative });
  return { owner, cancelNative };
};

const settled = async <T,>(p: Promise<ScanOutcome<T>>) => {
  let out: ScanOutcome<T> | undefined;
  p.then((o) => { out = o; });
  await Promise.resolve();
  await Promise.resolve();
  return out;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('nfc scan owner: Android', () => {
  it('leaving during the 5 s pre-arm wait never arms the reader', async () => {
    const { owner, cancelNative } = setup('android');
    const scan = jest.fn(() => deferredScan<string>().promise);
    const onArm = jest.fn();
    const h = owner.start({ preArmWaitMs: ANDROID_MIN_GAP_MS, scan, onArm });
    jest.advanceTimersByTime(2_000);
    owner.cancel('left');
    jest.advanceTimersByTime(60_000);
    expect(scan).not.toHaveBeenCalled();
    expect(onArm).not.toHaveBeenCalled();
    // Nothing was armed, so there is nothing to release natively either.
    expect(cancelNative).not.toHaveBeenCalled();
    expect(await settled(h.done)).toEqual({ kind: 'cancelled', reason: 'left' });
  });

  it('cancel then retry: the old 60 s timer never cancels the new scan', async () => {
    const { owner, cancelNative } = setup('android');
    const first = owner.start({ scan: () => deferredScan<string>().promise });
    jest.advanceTimersByTime(10_000);
    owner.cancel();
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(await settled(first.done)).toEqual({ kind: 'cancelled', reason: 'cancelled' });

    const second = owner.start({ scan: () => deferredScan<string>().promise });
    // t = 65 s: the first attempt's timer would have fired at t = 60 s.
    jest.advanceTimersByTime(55_000);
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(await settled(second.done)).toBeUndefined();

    // t = 70 s: the second attempt's own 60 s.
    jest.advanceTimersByTime(5_000);
    expect(cancelNative).toHaveBeenCalledTimes(2);
    const out = await settled(second.done);
    expect(out?.kind).toBe('error');
    expect((out as any).error.message).toBe(NFC_SCAN_TIMEOUT_MESSAGE);
  });

  it('a native result that arrives after a cancel is dropped', async () => {
    const { owner } = setup('android');
    const native = deferredScan<string>();
    const h = owner.start({ scan: () => native.promise });
    owner.cancel('left');
    native.resolve('late chip data');
    expect(await settled(h.done)).toEqual({ kind: 'cancelled', reason: 'left' });
  });

  it('cancel invalidates the token of a finished attempt too', async () => {
    const { owner } = setup('android');
    const native = deferredScan<string>();
    const h = owner.start({ scan: () => native.promise });
    native.resolve('ok');
    expect((await settled(h.done))?.kind).toBe('result');
    expect(owner.isCurrent(h.token)).toBe(true);
    owner.cancel('left');
    expect(owner.isCurrent(h.token)).toBe(false);
  });
});

describe('nfc scan owner: iOS', () => {
  it('arms no read timer: nothing happens at 60 s, the safety net fires at 75 s', async () => {
    const { owner, cancelNative } = setup('ios');
    const h = owner.start({ scan: () => deferredScan<string>().promise });
    jest.advanceTimersByTime(70_000);
    expect(cancelNative).not.toHaveBeenCalled();
    expect(await settled(h.done)).toBeUndefined();
    jest.advanceTimersByTime(5_000);
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect((await settled(h.done))?.kind).toBe('error');
  });

  it('a CoreNFC failure settles the wait with its elapsed time', async () => {
    const { owner } = setup('ios');
    const native = deferredScan<string>();
    const h = owner.start({ scan: () => native.promise });
    jest.advanceTimersByTime(60_000);
    native.reject(new Error('NFCPassportReaderError.UnexpectedError'));
    const out = await settled(h.done);
    expect(out?.kind).toBe('error');
    expect((out as any).elapsedMs).toBeGreaterThanOrEqual(60_000);
  });
});

// Contact starts a bounded reading window once per armed attempt.
describe('contact deadline', () => {
  it('allows a late contact to finish reading beyond the discovery deadline', async () => {
    const { owner, cancelNative } = setup('android');
    const native = deferredScan<string>();
    const h = owner.start({ scan: () => native.promise });
    jest.advanceTimersByTime(ANDROID_SCAN_TIMEOUT_MS - 500);
    expect(owner.markContact(h.token)).toBe(true);
    jest.advanceTimersByTime(1_500);
    expect(await settled(h.done)).toBeUndefined();
    expect(cancelNative).not.toHaveBeenCalled();
    native.resolve('complete');
    expect((await settled(h.done))?.kind).toBe('result');
    jest.advanceTimersByTime(ANDROID_SCAN_TIMEOUT_MS);
    expect(cancelNative).not.toHaveBeenCalled();
  });

  it('does not let repeated contact events extend a stalled read indefinitely', async () => {
    const { owner, cancelNative } = setup('android');
    const h = owner.start({ scan: () => deferredScan<string>().promise });
    jest.advanceTimersByTime(7_000);
    owner.markContact(h.token);
    jest.advanceTimersByTime(ANDROID_SCAN_TIMEOUT_MS - 1);
    owner.markContact(h.token);
    expect(await settled(h.done)).toBeUndefined();
    jest.advanceTimersByTime(1);
    expect((await settled(h.done))?.kind).toBe('error');
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(owner.markContact(h.token)).toBe(false);
  });

  it('ignores contact before arming and from superseded attempts', async () => {
    const { owner } = setup('android');
    const first = owner.start({ preArmWaitMs: ANDROID_MIN_GAP_MS, scan: () => deferredScan().promise });
    expect(owner.markContact(first.token)).toBe(false);
    const second = owner.start({ scan: () => deferredScan().promise });
    expect(owner.markContact(first.token)).toBe(false);
    expect(owner.markContact(second.token)).toBe(true);
    owner.cancel();
    expect(owner.markContact(second.token)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the original system-session safety net on iOS after contact', async () => {
    const { owner, cancelNative } = setup('ios');
    const h = owner.start({ scan: () => deferredScan().promise });
    jest.advanceTimersByTime(IOS_SAFETY_NET_MS - 500);
    owner.markContact(h.token);
    jest.advanceTimersByTime(500);
    expect((await settled(h.done))?.kind).toBe('error');
    expect(cancelNative).toHaveBeenCalledTimes(1);
  });
});
