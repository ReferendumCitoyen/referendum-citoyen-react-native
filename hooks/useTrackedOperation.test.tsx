import { act, renderHook } from '@testing-library/react-native';
import { useTrackedOperation } from './useTrackedOperation';
import { beginTrackedOperation } from '@/utils/logger';

jest.mock('@/utils/logger', () => ({ beginTrackedOperation: jest.fn() }));
const begin = jest.mocked(beginTrackedOperation);
const finish = jest.fn(async () => {});
beforeEach(() => {
  jest.clearAllMocks();
  begin.mockImplementation(() => ({ ready: Promise.resolve(), finish }));
});

it('holds a marker until completion', async () => {
  const screen = renderHook(() => useTrackedOperation(true));
  const operation = screen.result.current.begin();
  await operation.ready;
  expect(begin).toHaveBeenCalledTimes(1);
  expect(finish).not.toHaveBeenCalled();
  await operation.finish();
  expect(finish).toHaveBeenCalledTimes(1);
  screen.unmount();
  expect(finish).toHaveBeenCalledTimes(1);
});

it('releases only this screen on departure', async () => {
  const firstFinish = jest.fn(async () => {});
  const secondFinish = jest.fn(async () => {});
  begin.mockReturnValueOnce({ ready: Promise.resolve(), finish: firstFinish });
  begin.mockReturnValueOnce({ ready: Promise.resolve(), finish: secondFinish });
  const first = renderHook(() => useTrackedOperation(true));
  const second = renderHook(() => useTrackedOperation(true));
  first.result.current.begin();
  second.result.current.begin();
  first.unmount();
  expect(firstFinish).toHaveBeenCalledTimes(1);
  expect(secondFinish).not.toHaveBeenCalled();
  second.unmount();
  expect(secondFinish).toHaveBeenCalledTimes(1);
});

it('releases on deactivation and can track a later activation', async () => {
  const screen = renderHook(({ active }: { active: boolean }) => useTrackedOperation(active), {
    initialProps: { active: true },
  });
  screen.result.current.begin();
  screen.rerender({ active: false });
  expect(finish).toHaveBeenCalledTimes(1);
  screen.rerender({ active: true });
  screen.result.current.begin();
  expect(begin).toHaveBeenCalledTimes(2);
  screen.unmount();
  expect(finish).toHaveBeenCalledTimes(2);
});

it('departure while persistence is pending still releases the marker', async () => {
  let resolve!: () => void;
  begin.mockReturnValue({
    ready: new Promise<void>((r) => {
      resolve = r;
    }),
    finish,
  });
  const screen = renderHook(() => useTrackedOperation(true));
  const operation = screen.result.current.begin();
  screen.unmount();
  expect(finish).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve();
    await operation.ready;
  });
  expect(begin).toHaveBeenCalledTimes(1);
});

it('explicit cancellation releases every operation owned by this screen', async () => {
  const screen = renderHook(() => useTrackedOperation(true));
  screen.result.current.begin();
  screen.result.current.begin();
  screen.result.current.finishAll();
  expect(finish).toHaveBeenCalledTimes(2);
  screen.unmount();
  expect(finish).toHaveBeenCalledTimes(2);
});
