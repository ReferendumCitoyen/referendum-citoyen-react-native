/**
 * Step 11: the checks before the proof (R7), the error codes (R6) and the
 * lost-response protection (R4), with the SDK replaced by stubs.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    set() {}
    delete() {}
  },
}));
jest.mock('lottie-react-native', () => 'LottieView');
// The installed version the eligibility rule compares with the index minimum.
jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.1', applicationId: 'app.referendumcitoyen.fr' }));
jest.mock('@/utils/circuit-preload', () => ({ ensureCircuitsReady: async () => undefined }));
jest.mock('@/utils/mainnet-vote-flow', () => ({}));
jest.mock('@/utils/identity', () => ({ getOrCreatePrivateKey: async () => '01'.repeat(32) }));
jest.mock('@/constants/mock-backend', () => ({
  isMockBackend: () => false,
  mockDelay: async () => undefined,
  mockTxHash: () => '0x0',
}));
jest.mock('@/utils/vote-confirmation', () => ({ waitForVoteReceipt: async () => 'success' }));
jest.mock('@/utils/logger', () => ({ registerPublicAddress: () => undefined, purgeVoteTrace: async () => undefined }));

import Step11 from './Step11';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { resetVoteAttempts, OUTCOME_WINDOW_MS } from '@/utils/vote-attempt';

const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
const PASSPORT = '0x8Dea8065888A14F66ba9Fb944353d898663863cf';
const now = Math.floor(Date.now() / 1000);
const proposal = (id: string, contract: string) => ({
  id,
  title: `Question ${id}`,
  proposalSmtAddress: '0x0',
  sendVoteContractAddress: contract,
  startTimestamp: BigInt(now - 86400),
  duration: BigInt(86400 * 365),
  questions: [{ title: 'q', variants: ['Oui', 'Non'] }],
  votingResults: [[0n, 0n]],
  criteria: {
    selector: 39457n,
    citizenshipWhitelist: [BigInt('0x465241')],
    birthDateLowerbound: 52983525027888n,
    birthDateUpperbound: 52983525027888n,
    expirationDateLowerbound: 52983525027888n,
  },
});
const passport = {
  dataGroup1: new Uint8Array(95),
  getMRZData: () => ({ birthDate: '850315', issuingCountry: 'FRA' }),
  getPassportHash: () => 123n,
};
const lostAnswer = () =>
  Object.assign(new Error('[SDK] vote POST without answer: Network request failed'), { votePostSent: true });

function makeFt() {
  return {
    isAlreadyVoted: jest.fn(async () => false),
    verify: jest.fn(async () => undefined),
    submitProposal: jest.fn(async () => '0xtx'),
  };
}

function run(ft: ReturnType<typeof makeFt>, p = proposal('73', CARD)) {
  const onSuccess = jest.fn();
  const onError = jest.fn();
  const r = render(
    <ThemeProvider>
    <Step11
      containerWidth={300}
      isActive
      onSuccess={onSuccess}
      onError={onError}
      freedomTool={ft as any}
      rarime={{} as any}
      passport={passport as any}
      proposalInfo={p as any}
      answerIndex={0}
      network="mainnet"
    />
    </ThemeProvider>,
  );
  const settled = () => waitFor(() => expect(onSuccess.mock.calls.length + onError.mock.calls.length).toBe(1));
  return { r, onSuccess, onError, settled };
}
const codeOf = (onError: jest.Mock) => onError.mock.calls[0][2];

beforeEach(() => resetVoteAttempts());
afterEach(() => jest.restoreAllMocks());

describe('Step 11 refuses locally before any proof (R7)', () => {
  it('a card on a closed June question on the passport contract (#54 after #73): no request at all', async () => {
    const ft = makeFt();
    const { onError, settled } = run(ft, proposal('54', PASSPORT));
    await settled();
    expect(['question-closed', 'unsupported-document']).toContain(codeOf(onError));
    expect(ft.isAlreadyVoted).not.toHaveBeenCalled();
    expect(ft.submitProposal).not.toHaveBeenCalled();
  });

  it('an unknown voting contract is refused', async () => {
    const ft = makeFt();
    const { onError, settled } = run(ft, proposal('73', '0x1111111111111111111111111111111111111111'));
    await settled();
    expect(codeOf(onError)).toBe('not-available');
    expect(ft.submitProposal).not.toHaveBeenCalled();
  });

  it('the open card question goes through, with one UTC date handed to the SDK', async () => {
    const ft = makeFt();
    const { onSuccess, settled } = run(ft);
    await settled();
    expect(onSuccess).toHaveBeenCalledWith('0xtx', true);
    const args = (ft.submitProposal.mock.calls[0] as any[])[0];
    expect(args.currentDate).toMatch(/^\d{6}$/);
    expect((ft.verify.mock.calls[0] as any[])[3]).toBe(args.currentDate);
  });
});

describe('a lost answer after the vote POST (R4)', () => {
  it('re-reads the status once: already there → success "confirmation en attente"', async () => {
    const ft = makeFt();
    ft.isAlreadyVoted.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    ft.submitProposal.mockRejectedValueOnce(lostAnswer());
    const { onSuccess, onError, settled } = run(ft);
    await settled();
    expect(onSuccess).toHaveBeenCalledWith('', false);
    expect(onError).not.toHaveBeenCalled();
    expect(ft.isAlreadyVoted).toHaveBeenCalledTimes(2);
  });

  it('not there yet → "outcome unknown", and Retry does not send a second vote', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(lostAnswer());
    const first = run(ft);
    await first.settled();
    expect(codeOf(first.onError)).toBe('outcome-unknown');
    first.r.unmount();

    // Retry: Step 11 remounts.
    const second = run(ft);
    await second.settled();
    expect(codeOf(second.onError)).toBe('outcome-still-unknown');
    expect(ft.submitProposal).toHaveBeenCalledTimes(1);
  });

  it('Retry once the first vote shows up → success, still one POST', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(lostAnswer());
    const first = run(ft);
    await first.settled();
    first.r.unmount();
    ft.isAlreadyVoted.mockResolvedValue(true);
    const second = run(ft);
    await second.settled();
    expect(second.onSuccess).toHaveBeenCalledWith('', false);
    expect(ft.submitProposal).toHaveBeenCalledTimes(1);
  });

  it('after the window with the vote still absent, Retry makes a new proof', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(lostAnswer());
    const first = run(ft);
    await first.settled();
    first.r.unmount();
    const t0 = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(t0 + OUTCOME_WINDOW_MS + 1000);
    const second = run(ft);
    await second.settled();
    expect(second.onSuccess).toHaveBeenCalledWith('0xtx', true);
    expect(ft.submitProposal).toHaveBeenCalledTimes(2);
  });

  it('a relayer 500 after the POST: status re-read, then the service message with Retry', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(
      Object.assign(new Error('HTTP error 500: <html>'), { votePostSent: true, status: 500 }),
    );
    const first = run(ft);
    await first.settled();
    expect(codeOf(first.onError)).toBe('relayer-server');
    expect(ft.isAlreadyVoted).toHaveBeenCalledTimes(2);
    first.r.unmount();
    // The relayer answered: nothing is pending, Retry sends normally.
    const second = run(ft);
    await second.settled();
    expect(ft.submitProposal).toHaveBeenCalledTimes(2);
  });

  it('a 403 is the saturated service, retryable, and nothing is re-read', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(
      Object.assign(new Error('HTTP error 403: Forbidden'), { votePostSent: true, status: 403 }),
    );
    const { onError, settled } = run(ft);
    await settled();
    expect(codeOf(onError)).toBe('relayer-forbidden');
    expect(ft.isAlreadyVoted).toHaveBeenCalledTimes(1);
  });

  it('an opaque 400 keeps Retry', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(
      Object.assign(new Error('HTTP error 400: {"error":"Execution reverted","field":"failed to estimate gas"}'), {
        votePostSent: true,
        status: 400,
      }),
    );
    const { onError, settled } = run(ft);
    await settled();
    expect(codeOf(onError)).toBe('rejected-opaque');
  });

  it('already voted before the proof is the expected refusal', async () => {
    const ft = makeFt();
    ft.isAlreadyVoted.mockResolvedValue(true);
    const { onError, settled } = run(ft);
    await settled();
    expect(codeOf(onError)).toBe('already-voted');
    expect(ft.submitProposal).not.toHaveBeenCalled();
  });
});
