/**
 * Dossier 2.0.2, item 3 e (plan D10): the vote POST is bounded, the request
 * AND its body read, and a lost answer is "sent, outcome unknown" (R4):
 * tagged votePostSent so Step 11 re-reads the status once and never re-sends.
 *
 * Covers the patched SDK (FreedomTool.sendProposalRequest, card votes) and
 * the app's own submitVote (passport votes).
 */
import { loadSdkBuild } from './testing/load-sdk-build';

jest.mock('@/constants/rarime-config', () => ({
  FREEDOM_TOOL_MAINNET_CONFIG: { api: { votingRelayerUrl: 'https://relayer.invalid' } },
}));

const { FreedomTool, VOTE_POST_TIMEOUT_MS } = loadSdkBuild(
  'Freedomtool.js',
  { './Rarime': {}, './helpers/contracts': {}, './types': {} },
  require,
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { submitVote, VOTE_POST_TIMEOUT_MS: APP_BOUND } = require('./vote-calldata');

type Sender = () => Promise<unknown>;
const senders: [string, Sender][] = [
  [
    'SDK sendProposalRequest',
    () =>
      new FreedomTool({ api: { votingRelayerUrl: 'https://relayer.invalid' } }).sendProposalRequest(
        '0x00',
        { sendVoteContractAddress: '0x01' },
      ),
  ],
  ['app submitVote', () => submitVote('mainnet', '0x00', '0x01')],
];

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle(p: Promise<unknown>, ms: number) {
  let outcome: { ok: true; value: unknown } | { ok: false; error: any } | undefined;
  p.then((value) => { outcome = { ok: true, value }; }, (error) => { outcome = { ok: false, error }; });
  await jest.advanceTimersByTimeAsync(ms);
  return outcome;
}

it('both bounds are 90 s', () => {
  expect(VOTE_POST_TIMEOUT_MS).toBe(90_000);
  expect(APP_BOUND).toBe(90_000);
});

describe.each(senders)('%s', (_name, send) => {
  it('a relayer that never answers (and ignores abort) ends after 90 s as outcome unknown, one POST', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    const early = await settle(send(), 89_000);
    expect(early).toBeUndefined();
    const p = send();
    const out = await settle(p, 90_001);
    expect(out?.ok).toBe(false);
    const err = (out as any).error;
    expect(err.votePostSent).toBe(true);
    expect(err.code).toBe('VOTE_POST_SENT');
    expect(String(err.message)).toMatch(/within 90 s/);
    // One POST per call, never a retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('the POST is aborted at the bound', async () => {
    let signal: AbortSignal | undefined;
    jest.spyOn(global, 'fetch').mockImplementation((_u, init) => {
      signal = (init as RequestInit).signal ?? undefined;
      return new Promise((_r, rej) => signal?.addEventListener('abort', () => rej(new Error('Aborted'))));
    });
    const out = await settle(send(), 90_001);
    expect(signal?.aborted).toBe(true);
    expect((out as any).error.votePostSent).toBe(true);
  });

  it('a body that never arrives is bounded too', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
      text: () => new Promise(() => {}),
    } as unknown as Response);
    const out = await settle(send(), 90_001);
    expect((out as any).error.votePostSent).toBe(true);
  });

  it('a normal answer still returns the transaction id and leaves no timer', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: '0xabc' } }),
    } as unknown as Response);
    const out = await settle(send(), 0);
    expect(out?.ok).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
