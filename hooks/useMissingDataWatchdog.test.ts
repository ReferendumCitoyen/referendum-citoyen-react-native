/**
 * Dossier 2.0.2, item 5 (c). The "missing data" watchdog of Step 7 fired
 * falsely whenever the JS thread had been frozen past its deadline. These
 * pin both halves: a blocked thread must not produce the error, and a real
 * failure on a free thread must still produce it at 30 s.
 */
import { renderHook, act } from '@testing-library/react-native';
import {
  BLOCKED_GRACE_MS,
  MISSING_DATA_TIMEOUT_MS,
  useMissingDataWatchdog,
} from './useMissingDataWatchdog';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-22T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());

/** The JS thread was frozen `ms`: wall time moved on, no timer could run. */
function freezeThread(ms: number) {
  jest.setSystemTime(Date.now() + ms);
}

describe('useMissingDataWatchdog', () => {
  it('a real failure on a free thread fires at 30 s, not before', () => {
    const onExpire = jest.fn();
    renderHook(() => useMissingDataWatchdog({ armed: true, ready: false, onExpire }));
    act(() => { jest.advanceTimersByTime(MISSING_DATA_TIMEOUT_MS - 1); });
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a clock that jumped 40 s (blocked thread) is no failure, and the refs that arrive then win', () => {
    const onExpire = jest.fn();
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useMissingDataWatchdog({ armed: true, ready, onExpire }),
      { initialProps: { ready: false } },
    );
    // Frozen for 40 s, then the overdue timer runs first.
    freezeThread(40_000);
    act(() => { jest.advanceTimersByTime(MISSING_DATA_TIMEOUT_MS); });
    expect(onExpire).not.toHaveBeenCalled();
    // The SDK reply that was queued behind the blockage lands.
    rerender({ ready: true });
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('calls the latest onExpire, not the one captured at arming', () => {
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useMissingDataWatchdog({ armed: true, ready: false, onExpire: cb }),
      { initialProps: { cb: first } },
    );
    rerender({ cb: latest });
    act(() => { jest.advanceTimersByTime(MISSING_DATA_TIMEOUT_MS); });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('a thread that stays blocked still ends on the error after two graces', () => {
    const onExpire = jest.fn();
    renderHook(() => useMissingDataWatchdog({ armed: true, ready: false, onExpire }));
    freezeThread(40_000);
    act(() => { jest.advanceTimersByTime(MISSING_DATA_TIMEOUT_MS); });
    expect(onExpire).not.toHaveBeenCalled(); // grace 1
    freezeThread(20_000);
    act(() => { jest.advanceTimersByTime(BLOCKED_GRACE_MS); });
    expect(onExpire).not.toHaveBeenCalled(); // grace 2
    freezeThread(20_000);
    act(() => { jest.advanceTimersByTime(BLOCKED_GRACE_MS); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not arm when ready or not armed', () => {
    const onExpire = jest.fn();
    renderHook(() => useMissingDataWatchdog({ armed: true, ready: true, onExpire }));
    renderHook(() => useMissingDataWatchdog({ armed: false, ready: false, onExpire }));
    act(() => { jest.advanceTimersByTime(120_000); });
    expect(onExpire).not.toHaveBeenCalled();
  });
});
