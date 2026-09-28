/**
 * R8 with R4, end to end on the real logger: once a vote may be on chain
 * (a lost answer after the POST, a reverted transaction), Step 11 purges the
 * vote run's lines from the ring buffer before the error screen, so no report
 * built afterwards can place the ballot in time. A relayer that answered 4xx
 * refused the vote before broadcasting it: those lines stay for the report.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, string>();
  return {
    cacheDirectory: 'file:///cache/',
    EncodingType: { UTF8: 'utf8' },
    getInfoAsync: async (p: string) => ({ exists: files.has(p) }),
    readAsStringAsync: async (p: string) => files.get(p) ?? '',
    writeAsStringAsync: async (p: string, s: string) => { files.set(p, s); },
    deleteAsync: async (p: string) => { files.delete(p); },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    readDirectoryAsync: async () => [],
    getFreeDiskStorageAsync: async () => 10_000_000_000,
  };
});
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
jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.1', applicationId: 'app.referendumcitoyen.fr' }));
jest.mock('@/utils/circuit-preload', () => ({ ensureCircuitsReady: async () => undefined }));
jest.mock('@/utils/mainnet-vote-flow', () => ({}));
jest.mock('@/constants/mock-backend', () => ({
  isMockBackend: () => false,
  mockBackendOverride: () => null,
  mockDelay: async () => undefined,
  mockTxHash: () => '0x0',
}));
const mockReceipt = jest.fn(async () => 'success');
jest.mock('@/utils/vote-confirmation', () => ({ waitForVoteReceipt: () => mockReceipt() }));

import Step11 from './Step11';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { resetVoteAttempts } from '@/utils/vote-attempt';
import { __testing, beginVoteTrace, install, uninstall } from '@/utils/logger';

const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
const now = Math.floor(Date.now() / 1000);
const proposal = {
  id: '73',
  title: 'Question 73',
  proposalSmtAddress: '0x0',
  sendVoteContractAddress: CARD,
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
};
const passport = {
  dataGroup1: new Uint8Array(95),
  getMRZData: () => ({ birthDate: '850315', issuingCountry: 'FRA' }),
  getPassportHash: () => 123n,
};

function makeFt() {
  return {
    isAlreadyVoted: jest.fn(async () => false),
    verify: jest.fn(async () => undefined),
    submitProposal: jest.fn(async () => '0xtx'),
  };
}

function run(ft: ReturnType<typeof makeFt>) {
  const onSuccess = jest.fn();
  const onError = jest.fn();
  render(
    <ThemeProvider>
      <Step11
        containerWidth={300}
        isActive
        onSuccess={onSuccess}
        onError={onError}
        freedomTool={ft as any}
        rarime={{} as any}
        passport={passport as any}
        proposalInfo={proposal as any}
        answerIndex={0}
        network="mainnet"
      />
    </ThemeProvider>,
  );
  const settled = () => waitFor(() => expect(onSuccess.mock.calls.length + onError.mock.calls.length).toBe(1));
  return { onSuccess, onError, settled };
}

const VOTE_STEP_LINE = /Step11|Submitting vote|vote failed|Vote error|proposal=#73/;
const lines = () => __testing.snapshot().map((e) => e.msg);

beforeEach(() => {
  resetVoteAttempts();
  mockReceipt.mockReset();
  mockReceipt.mockImplementation(async () => 'success');
  __testing.reset();
  install();
  console.log('[Accueil] before the vote flow');
  beginVoteTrace();
  console.log('[flow] step → 1 (focus-reset)');
});
afterEach(() => {
  uninstall();
  jest.restoreAllMocks();
});

describe('the vote trace is purged after a post-POST error (R8 with R4)', () => {
  it('a lost answer, vote not visible yet: outcome unknown, no vote-step line left', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(
      Object.assign(new Error('[SDK] vote POST without answer: Network request failed'), { votePostSent: true }),
    );
    const { onError, settled } = run(ft);
    await settled();
    expect(onError.mock.calls[0][2]).toBe('outcome-unknown');
    expect(lines().some((l) => VOTE_STEP_LINE.test(l))).toBe(false);
    expect(lines()).toContain('[Accueil] before the vote flow');
  });

  it('a relayer gateway error after the POST: purged too', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(
      Object.assign(new Error('HTTP error 502: <html>'), { votePostSent: true, status: 502 }),
    );
    const { settled } = run(ft);
    await settled();
    expect(lines().some((l) => VOTE_STEP_LINE.test(l))).toBe(false);
  });

  it('a mined transaction that reverted: purged', async () => {
    mockReceipt.mockImplementation(async () => 'reverted');
    const ft = makeFt();
    const { onError, settled } = run(ft);
    await settled();
    expect(onError.mock.calls[0][2]).toBe('reverted');
    expect(lines().some((l) => VOTE_STEP_LINE.test(l))).toBe(false);
  });

  it('a successful vote: purged before onSuccess', async () => {
    const ft = makeFt();
    let atSuccess: string[] = [];
    const { onSuccess, settled } = run(ft);
    onSuccess.mockImplementation(() => { atSuccess = lines(); });
    await settled();
    expect(atSuccess.some((l) => VOTE_STEP_LINE.test(l))).toBe(false);
  });

  it('an answered 400 refused the vote before broadcast: the lines stay for the report', async () => {
    const ft = makeFt();
    ft.submitProposal.mockRejectedValueOnce(
      Object.assign(new Error('HTTP error 400: {"error":"Execution reverted"}'), { votePostSent: true, status: 400 }),
    );
    const { onError, settled } = run(ft);
    await settled();
    expect(onError.mock.calls[0][2]).toBe('rejected-opaque');
    expect(lines().some((l) => /vote failed: rejected-opaque/.test(l))).toBe(true);
  });
});
