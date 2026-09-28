import { createAttemptGeneration } from './attempt-generation';

describe('createAttemptGeneration', () => {
  it('a token is current until the next attempt starts', () => {
    const gen = createAttemptGeneration();
    const first = gen.next();
    expect(gen.isCurrent(first)).toBe(true);
    const second = gen.next();
    expect(gen.isCurrent(first)).toBe(false);
    expect(gen.isCurrent(second)).toBe(true);
    expect(gen.current()).toBe(second);
  });

  it('a guarded callback of a stale attempt never runs', () => {
    const gen = createAttemptGeneration();
    const fn = jest.fn(() => 'ran');
    const stale = gen.guard(gen.next(), fn);
    const fresh = gen.guard(gen.next(), fn);
    expect(stale()).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    expect(fresh()).toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('instances are independent owners', () => {
    const a = createAttemptGeneration();
    const b = createAttemptGeneration();
    const ta = a.next();
    b.next();
    b.next();
    expect(a.isCurrent(ta)).toBe(true);
  });
});
