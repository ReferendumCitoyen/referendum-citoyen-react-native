/**
 * Dossier 2.0.2, R3 and item 3: the registration submission state machine.
 * Every scenario the spec names has a test here: the X during the proof then a
 * rescan, a lost POST answer, a 5xx storm during the poll, a resume from the
 * background, and two documents alternated.
 */
import {
  CONFIRM_TIMEOUT_MS,
  POLL_READ_TIMEOUT_MS,
  __resetRegistrationInflightForTests,
  boundedRead,
  isTransientRpcError,
  runRegistration,
  type PollResult,
  type RegistrationRunDeps,
} from './registration-submission';
import {
  REGISTRATION_OUTCOME_UNKNOWN,
  REGISTRATION_PENDING,
  REGISTRATION_REVERT,
} from './registration-sentinels';

/** A virtual clock: sleep() advances it instantly, so 300 s runs in no time. */
function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    sleep: async (ms: number, onWake: (w: () => void) => void) => {
      onWake(() => {});
      t += ms;
      await Promise.resolve();
    },
  };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function baseDeps(over: Partial<RegistrationRunDeps> = {}): RegistrationRunDeps & {
  calls: { prove: number; submit: number; readStatus: number; poll: number };
} {
  const c = clock();
  const calls = { prove: 0, submit: 0, readStatus: 0, poll: 0 };
  const deps: any = {
    network: 'mainnet',
    passportHash: 'doc-X',
    privateKey: 'key-X',
    confirmOnChain: true,
    now: c.now,
    sleep: c.sleep,
    prove: async () => { calls.prove++; },
    submit: async () => { calls.submit++; return { txHash: '0xabc' }; },
    readStatus: async () => { calls.readStatus++; return 'not-registered'; },
    pollOnce: async (): Promise<PollResult> => { calls.poll++; return 'found'; },
    ...over,
  };
  // Wrap the overrides so the counters still count.
  for (const k of ['prove', 'submit', 'readStatus', 'pollOnce'] as const) {
    if (over[k]) {
      const f = over[k] as any;
      const name = k === 'pollOnce' ? 'poll' : k;
      deps[k] = async (...a: any[]) => { (calls as any)[name]++; return f(...a); };
    }
  }
  deps.calls = calls;
  return deps;
}

beforeEach(() => __resetRegistrationInflightForTests());

describe('runRegistration: double run (the X during the proof, then a rescan)', () => {
  it('the second run for the same document and key proves nothing and adopts the first run success', async () => {
    const proofGate = deferred();
    const a = baseDeps({ prove: () => proofGate.promise });
    const b = baseDeps();
    const runA = runRegistration(a); // the unmounted screen's run keeps going
    await Promise.resolve();
    const runB = runRegistration(b); // the reopened screen, same card, same key
    await Promise.resolve();
    expect(b.calls.prove).toBe(0);
    proofGate.resolve();
    await expect(runA).resolves.toEqual({ registered: true, via: 'this-run' });
    await expect(runB).resolves.toEqual({ registered: true, via: 'adopted' });
    expect(a.calls.prove + b.calls.prove).toBe(1);
    expect(a.calls.submit + b.calls.submit).toBe(1);
  });

  it('a run started just after the first one confirmed still adopts it', async () => {
    await runRegistration(baseDeps());
    const late = baseDeps();
    await expect(runRegistration(late)).resolves.toEqual({ registered: true, via: 'adopted' });
    expect(late.calls.prove).toBe(0);
  });

  it('when the first run certainly failed before sending, the second one may try itself', async () => {
    const proofGate = deferred();
    const a = baseDeps({ prove: () => proofGate.promise });
    const b = baseDeps();
    const runA = runRegistration(a);
    await Promise.resolve();
    const runB = runRegistration(b);
    proofGate.reject(new Error('[PROOF_GENERATION_FAILED] witness'));
    await expect(runA).rejects.toThrow('PROOF_GENERATION_FAILED');
    await expect(runB).resolves.toEqual({ registered: true, via: 'this-run' });
    expect(b.calls.prove).toBe(1);
  });

  it('when the first run could not confirm, the second one shows pending and sends nothing', async () => {
    const a = baseDeps({ pollOnce: async () => 'absent' as const });
    const submitGate = deferred<{ txHash: string }>();
    a.submit = async () => { a.calls.submit++; return submitGate.promise; };
    const b = baseDeps();
    const runA = runRegistration(a);
    await Promise.resolve();
    const runB = runRegistration(b);
    submitGate.resolve({ txHash: '0x1' });
    await expect(runA).rejects.toThrow(REGISTRATION_PENDING);
    await expect(runB).rejects.toThrow(REGISTRATION_PENDING);
    expect(b.calls.prove + b.calls.submit).toBe(0);
  });
});

describe('runRegistration: two documents alternated', () => {
  it('each document proves with its own captured key, neither waits for the other', async () => {
    const used: string[] = [];
    const gateX = deferred();
    const x = baseDeps({ passportHash: 'doc-X', privateKey: 'key-X' });
    x.prove = async () => { await gateX.promise; used.push('key-X'); };
    const y = baseDeps({ passportHash: 'doc-Y', privateKey: 'key-Y' });
    y.prove = async () => { used.push('key-Y'); };
    const runX = runRegistration(x);
    const runY = runRegistration(y);
    await expect(runY).resolves.toMatchObject({ via: 'this-run' });
    gateX.resolve();
    await expect(runX).resolves.toMatchObject({ via: 'this-run' });
    expect(used).toEqual(['key-Y', 'key-X']);
  });

  it('the same document under another key is another registration (own marker)', async () => {
    const gate = deferred();
    const k1 = baseDeps({ privateKey: 'key-1', prove: () => gate.promise });
    const k2 = baseDeps({ privateKey: 'key-2' });
    const r1 = runRegistration(k1);
    await Promise.resolve();
    await expect(runRegistration(k2)).resolves.toMatchObject({ via: 'this-run' });
    expect(k2.calls.prove).toBe(1);
    gate.resolve();
    await r1;
  });
});

describe('runRegistration: lost POST answer', () => {
  it('never POSTs a second time; re-reads the status once and adopts it', async () => {
    const d = baseDeps({
      submit: async () => { throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} relayer answer lost (network)`); },
      readStatus: async () => 'this-key' as const,
    });
    await expect(runRegistration(d)).resolves.toEqual({ registered: true, via: 're-read' });
    expect(d.calls.submit).toBe(1);
    expect(d.calls.readStatus).toBe(1);
    expect(d.calls.poll).toBe(0);
  });

  it('when the re-read does not show it yet, waits for the leaf instead of sending again', async () => {
    let polls = 0;
    const d = baseDeps({
      submit: async () => { throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} relayer did not answer within 90 s`); },
      pollOnce: async () => (++polls >= 3 ? 'found' : 'absent'),
    });
    await expect(runRegistration(d)).resolves.toEqual({ registered: true, via: 'this-run' });
    expect(d.calls.submit).toBe(1);
    expect(d.calls.readStatus).toBe(1);
  });

  it('when it never shows up, ends on "pending", not on a failure', async () => {
    const d = baseDeps({
      submit: async () => { throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} relayer answer lost (network)`); },
      pollOnce: async () => 'absent' as const,
    });
    await expect(runRegistration(d)).rejects.toThrow(REGISTRATION_PENDING);
    expect(d.calls.submit).toBe(1);
  });
});

describe('runRegistration: "already registered"', () => {
  it('a dry-run "already registered" is re-read once and becomes a success for this key', async () => {
    const d = baseDeps({
      submit: async () => { throw new Error(`${REGISTRATION_REVERT} StateKeeper: passport already registered`); },
      readStatus: async () => 'this-key' as const,
    });
    await expect(runRegistration(d)).resolves.toEqual({ registered: true, via: 're-read' });
    expect(d.calls.readStatus).toBe(1);
  });

  it('keeps the refusal when the re-read does not confirm this key', async () => {
    const d = baseDeps({
      submit: async () => { throw new Error(`${REGISTRATION_REVERT} StateKeeper: passport already registered`); },
      readStatus: async () => 'other' as const,
    });
    await expect(runRegistration(d)).rejects.toThrow(REGISTRATION_REVERT);
    expect(d.calls.readStatus).toBe(1);
  });

  it('any other refusal gets no re-read', async () => {
    const d = baseDeps({ submit: async () => { throw new Error('[registerViaNoir] relayer 400 Bad Request: bad proof'); } });
    await expect(runRegistration(d)).rejects.toThrow('relayer 400');
    expect(d.calls.readStatus).toBe(0);
  });
});

describe('runRegistration: confirmation wait', () => {
  it('transient 5xx during the poll are retried, and no failure is declared before 300 s', async () => {
    const c = clock();
    const t0 = c.now();
    let transient = 0;
    const d = baseDeps({
      now: c.now,
      sleep: c.sleep,
      // Two minutes of 502/503 from the gateway (the 21/09 storm lasted about
      // one), then the leaf.
      pollOnce: async () => {
        if (c.now() - t0 < 120_000) { transient++; return 'transient'; }
        return 'found';
      },
    });
    await expect(runRegistration(d)).resolves.toMatchObject({ via: 'this-run' });
    expect(c.now() - t0).toBeLessThan(CONFIRM_TIMEOUT_MS);
    // Backed off: far fewer reads than one every 2 s.
    expect(transient).toBeLessThan(120_000 / 2_000 / 2);
  });

  it('5xx until the end gives the "service unavailable, maybe already registered" pending', async () => {
    const d = baseDeps({ pollOnce: async () => 'transient' as const });
    await expect(runRegistration(d)).rejects.toThrow(`${REGISTRATION_PENDING} service-unavailable`);
  });

  it('waits the full 300 s, and shows "still confirming" after 60 s', async () => {
    const c = clock();
    const still = jest.fn();
    let firstAbsentAt = 0;
    let lastPollAt = 0;
    const d = baseDeps({
      now: c.now,
      sleep: c.sleep,
      pollOnce: async () => {
        if (!firstAbsentAt) firstAbsentAt = c.now();
        lastPollAt = c.now();
        return 'absent';
      },
      ui: { stillConfirming: still },
    });
    await expect(runRegistration(d)).rejects.toThrow(REGISTRATION_PENDING);
    expect(lastPollAt - firstAbsentAt).toBeGreaterThanOrEqual(CONFIRM_TIMEOUT_MS);
    expect(still).toHaveBeenCalledTimes(1);
  });

  it('a resume from the background after the deadline still polls once before deciding', async () => {
    const c = clock();
    let polls = 0;
    const d = baseDeps({
      now: c.now,
      // The phone slept 10 minutes in the first sleep (iOS suspended JS).
      sleep: async (ms, onWake) => { onWake(() => {}); c.advance(polls === 1 ? 600_000 : ms); },
      // The registration landed while the phone slept.
      pollOnce: async () => (++polls === 1 ? 'absent' : 'found'),
    });
    await expect(runRegistration(d)).resolves.toMatchObject({ via: 'this-run' });
    expect(polls).toBe(2);
  });

  it('AppState "active" wakes the wait for an immediate poll', async () => {
    let resume: (() => void) | null = null;
    let polls = 0;
    const d = baseDeps({
      now: () => 0,
      // A sleep that only ends when woken.
      sleep: (_ms, onWake) => new Promise<void>((r) => onWake(r)),
      onResume: (cb) => { resume = cb; return () => { resume = null; }; },
      pollOnce: async () => (++polls === 1 ? 'absent' : 'found'),
    });
    const run = runRegistration(d);
    await new Promise((r) => setImmediate(r));
    expect(polls).toBe(1);
    resume!();
    await expect(run).resolves.toMatchObject({ via: 'this-run' });
    expect(resume).toBeNull(); // unsubscribed
  });

  it('holds its own keep-awake tag during the wait and releases it', async () => {
    const activate = jest.fn();
    const deactivate = jest.fn();
    await runRegistration(baseDeps({ keepAwake: { activate, deactivate } }));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledWith(activate.mock.calls[0][0]);
  });
});

describe('runRegistration: each read is bounded to 15 s (plan D11)', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('one hung SMT read is abandoned after 15 s and the poll goes on', async () => {
    jest.useFakeTimers();
    let n = 0;
    const d = baseDeps({
      pollOnce: () => (++n === 1 ? new Promise<PollResult>(() => {}) : Promise.resolve<PollResult>('found')),
    });
    let result: unknown;
    runRegistration(d).then((r) => { result = r; });
    await jest.advanceTimersByTimeAsync(POLL_READ_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await jest.advanceTimersByTimeAsync(2);
    expect(result).toMatchObject({ registered: true, via: 'this-run' });
    expect(n).toBe(2);
  });

  it('every read hanging still ends on "pending" instead of hanging forever', async () => {
    jest.useFakeTimers();
    const d = baseDeps({ pollOnce: () => new Promise<PollResult>(() => {}) });
    let error: any;
    runRegistration(d).catch((e) => { error = e; });
    // The virtual clock moves by the sleeps only; each hung read costs 15 s
    // of real timers. 300 s / 15 s backoff: a few dozen reads at most.
    for (let i = 0; i < 60 && !error; i++) await jest.advanceTimersByTimeAsync(POLL_READ_TIMEOUT_MS);
    expect(String(error?.message)).toContain(REGISTRATION_PENDING);
  });

  it('a hung status re-read after a lost answer counts as "unknown" and the wait runs', async () => {
    jest.useFakeTimers();
    const d = baseDeps({
      submit: async () => { throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} relayer did not answer`); },
      readStatus: () => new Promise(() => {}),
      pollOnce: async () => 'found' as const,
    });
    let result: unknown;
    runRegistration(d).then((r) => { result = r; });
    await jest.advanceTimersByTimeAsync(POLL_READ_TIMEOUT_MS + 1);
    expect(result).toMatchObject({ registered: true, via: 'this-run' });
    expect(d.calls.submit).toBe(1);
  });

  it('boundedRead returns the read result when it is in time, and leaves no timer', async () => {
    jest.useFakeTimers();
    await expect(boundedRead(async () => 'x', 15_000, 'late')).resolves.toBe('x');
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('runRegistration: pending slot (2c)', () => {
  it('a slot younger than an hour gets one bounded poll before proving; found = no proof', async () => {
    const slot = { ageMs: jest.fn(async () => 120_000), write: jest.fn(), clear: jest.fn() };
    const d = baseDeps({ pendingSlot: slot as any });
    await expect(runRegistration(d)).resolves.toEqual({ registered: true, via: 'pending-slot' });
    expect(d.calls.prove).toBe(0);
    expect(slot.clear).toHaveBeenCalled();
  });

  it('writes the slot once the relayer accepted and clears it on confirmation', async () => {
    const slot = { ageMs: jest.fn(async () => null), write: jest.fn(), clear: jest.fn() };
    await runRegistration(baseDeps({ pendingSlot: slot as any }));
    expect(slot.write).toHaveBeenCalledTimes(1);
    expect(slot.clear).toHaveBeenCalledTimes(1);
  });

  it('hands the slot nothing: the transaction hash never leaves this module (C1)', async () => {
    const slot = { ageMs: jest.fn(async () => null), write: jest.fn(), clear: jest.fn() };
    await runRegistration(
      baseDeps({
        pendingSlot: slot as any,
        submit: async () => ({ txHash: '0x' + 'ab'.repeat(32) }),
      }),
    );
    // No argument at all: not the hash, not a truncated hash, nothing.
    expect(slot.write).toHaveBeenCalledWith();
    for (const call of slot.write.mock.calls) expect(call).toHaveLength(0);
  });

  // AV4. TODO(PROTOCOL-LEAD-B): what the marker holds is still open; that it
  // exists before the request goes out is not.
  it('arms the slot before proving and marks it sent before the POST', async () => {
    const order: string[] = [];
    const slot = {
      ageMs: jest.fn(async () => null),
      arm: jest.fn(() => { order.push('arm'); }),
      markSent: jest.fn(async () => { order.push('markSent'); }),
      write: jest.fn(async () => { order.push('write'); }),
      clear: jest.fn(),
    };
    const d = baseDeps({
      pendingSlot: slot as any,
      prove: async () => { order.push('prove'); },
      submit: async () => { order.push('submit'); return { txHash: '0xabc' }; },
    });
    await runRegistration(d);
    expect(order).toEqual(['arm', 'prove', 'markSent', 'submit', 'write']);
  });

  it('still marks it sent when the answer is lost, and never POSTs again', async () => {
    const slot = {
      ageMs: jest.fn(async () => null),
      arm: jest.fn(),
      markSent: jest.fn(async () => {}),
      write: jest.fn(),
      clear: jest.fn(),
    };
    const d = baseDeps({
      pendingSlot: slot as any,
      submit: async () => { throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} answer lost`); },
      readStatus: async () => 'this-key',
    });
    await expect(runRegistration(d)).resolves.toEqual({ registered: true, via: 're-read' });
    expect(slot.markSent).toHaveBeenCalledTimes(1);
    expect(slot.write).not.toHaveBeenCalled();
    expect(d.calls.submit).toBe(1);
  });

  // No module state survives a run any more, so there is nothing to release:
  // the owner token lives in the run that armed it (wave 2a, constat 1).
  it('never marks it sent when the registration certainly failed', async () => {
    const slot = {
      ageMs: jest.fn(async () => null),
      arm: jest.fn(),
      markSent: jest.fn(async () => {}),
      write: jest.fn(),
      clear: jest.fn(),
    };
    const d = baseDeps({ pendingSlot: slot as any, prove: async () => { throw new Error('nope'); } });
    await expect(runRegistration(d)).rejects.toThrow('nope');
    expect(slot.markSent).not.toHaveBeenCalled();
  });
});

describe('isTransientRpcError', () => {
  it.each([
    'HTTP 503 Service Unavailable: <html><body>…</body></html>',
    'server response 502 Bad Gateway',
    '<!DOCTYPE html><title>504 Gateway Time-out</title>',
  ])('recognises %s', (m) => expect(isTransientRpcError(new Error(m))).toBe(true));

  it('does not swallow an ordinary error', () => {
    expect(isTransientRpcError(new Error('execution reverted'))).toBe(false);
  });
});
