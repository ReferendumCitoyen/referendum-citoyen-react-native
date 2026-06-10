import { classifyReceipt, waitForVoteReceipt } from './vote-confirmation';

describe('classifyReceipt', () => {
  it('null/undefined receipt → pending (tx not yet mined)', () => {
    expect(classifyReceipt(null)).toBe('pending');
    expect(classifyReceipt(undefined)).toBe('pending');
  });

  it('status 1 → success (accepts number and bigint, ethers v6 quirk)', () => {
    expect(classifyReceipt({ status: 1 })).toBe('success');
    expect(classifyReceipt({ status: 1n })).toBe('success');
  });

  it('status 0 → reverted — THIS is the bug: a reverted tx must NOT read as success', () => {
    expect(classifyReceipt({ status: 0 })).toBe('reverted');
    expect(classifyReceipt({ status: 0n })).toBe('reverted');
  });

  it('present receipt with null/undefined status → pending (pre-Byzantium / unknown)', () => {
    expect(classifyReceipt({ status: null })).toBe('pending');
    expect(classifyReceipt({ status: undefined })).toBe('pending');
  });
});

describe('waitForVoteReceipt', () => {
  it('returns "reverted" when the mined tx has status 0', async () => {
    const provider = { getTransactionReceipt: async () => ({ status: 0 }) };
    await expect(
      waitForVoteReceipt(provider, '0xabc', { intervalMs: 1, timeoutMs: 50 }),
    ).resolves.toBe('reverted');
  });

  it('polls past the unmined window, then returns "success"', async () => {
    let n = 0;
    const provider = {
      getTransactionReceipt: async () => (++n < 3 ? null : { status: 1 }),
    };
    await expect(
      waitForVoteReceipt(provider, '0xabc', { intervalMs: 1, timeoutMs: 1000 }),
    ).resolves.toBe('success');
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('returns "pending" if the tx never mines before the timeout', async () => {
    const provider = { getTransactionReceipt: async () => null };
    await expect(
      waitForVoteReceipt(provider, '0xabc', { intervalMs: 1, timeoutMs: 10 }),
    ).resolves.toBe('pending');
  });

  it('treats transient RPC errors as pending and keeps polling', async () => {
    let n = 0;
    const provider = {
      getTransactionReceipt: async () => {
        if (++n < 2) throw new Error('rpc hiccup');
        return { status: 1 };
      },
    };
    await expect(
      waitForVoteReceipt(provider, '0xabc', { intervalMs: 1, timeoutMs: 1000 }),
    ).resolves.toBe('success');
  });
});
