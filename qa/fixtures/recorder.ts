/**
 * What the last button did, for the QA gallery.
 *
 * In the gallery a state's callbacks (onRetry, onVerify…) are recorders: they
 * do not navigate, they write here, and the overlay shows the label so a
 * person or an automation can check the button reached the right place. The
 * jest suite reads the same log.
 */
export interface RecordedAction {
  id: string;
  label: string;
  at: number;
}

let log: RecordedAction[] = [];
const listeners = new Set<(last: RecordedAction | null) => void>();

export function recordAction(id: string, label?: string): void {
  const entry = { id, label: label ?? id, at: Date.now() };
  log = [...log.slice(-49), entry];
  listeners.forEach((l) => l(entry));
}

export function lastAction(): RecordedAction | null {
  return log.length ? log[log.length - 1] : null;
}

export function allActions(): readonly RecordedAction[] {
  return log;
}

export function resetActions(): void {
  log = [];
  listeners.forEach((l) => l(null));
}

export function subscribeActions(fn: (last: RecordedAction | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The prefix the overlay shows before a recorded action. Maestro flows
 *  assert on it, so it is a constant. */
export const ACTION_PREFIX = 'QA ▸ ';
