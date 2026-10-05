import { useCallback, useEffect, useRef } from 'react';
import { beginTrackedOperation } from '@/utils/logger';

/** Tracks work owned by a screen, without changing or cancelling the work. */
export function useTrackedOperation(isActive: boolean) {
  const finishes = useRef(new Set<() => Promise<void>>());
  const finishAll = useCallback(() => {
    for (const finish of finishes.current) void finish();
    finishes.current.clear();
  }, []);

  useEffect(() => {
    if (!isActive) finishAll();
    return finishAll;
  }, [isActive, finishAll]);

  const begin = useCallback(() => {
    const operation = beginTrackedOperation();
    const finish = () => {
      finishes.current.delete(finish);
      return operation.finish();
    };
    finishes.current.add(finish);
    return { ready: operation.ready, finish };
  }, []);

  return { begin, finishAll };
}
