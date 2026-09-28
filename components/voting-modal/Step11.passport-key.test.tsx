/**
 * Integration of the registration branch (R2: one key per attempt, captured
 * at step 7) with the vote branch (frozen attempt, UTC date, bound root) in
 * Step 11's passport path: the Groth16 mainnet vote proves with the captured
 * key handed in as a prop, frozen with the attempt, and never falls back to
 * the global key slot.
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
jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.1', applicationId: 'app.referendumcitoyen.fr' }));
jest.mock('@/utils/circuit-preload', () => ({ ensureCircuitsReady: async () => undefined }));
const mockPrepare = jest.fn(async (_args: any): Promise<any> => ({ prepared: true }));
const mockSubmit = jest.fn(async (_prepared: any) => ({ txId: '0xtx' }));
jest.mock('@/utils/mainnet-vote-flow', () => ({
  prepareMainnetVote: (args: any) => mockPrepare(args),
  submitPreparedVote: (prepared: any) => mockSubmit(prepared),
}));
const mockGlobalKey = jest.fn(async () => 'ff'.repeat(32));
jest.mock('@/utils/identity', () => ({ getOrCreatePrivateKey: () => mockGlobalKey() }));
jest.mock('@rarimo/rarime-rn-sdk', () => ({ RarimeUtils: { getProfileKey: () => '22'.repeat(32) } }));
jest.mock('@/utils/vote-eligibility', () => ({
  checkVoteEligibility: () => ({ ok: true }),
  localEligibilityContext: () => ({}),
}));
jest.mock('@/constants/mock-backend', () => ({
  isMockBackend: () => false,
  mockDelay: async () => undefined,
  mockTxHash: () => '0x0',
}));
jest.mock('@/utils/vote-confirmation', () => ({ waitForVoteReceipt: async () => 'success' }));
jest.mock('@/utils/logger', () => ({ registerPublicAddress: () => undefined, purgeVoteTrace: async () => undefined }));

import Step11 from './Step11';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { resetVoteAttempts } from '@/utils/vote-attempt';

const PASSPORT = '0x8Dea8065888A14F66ba9Fb944353d898663863cf';
const now = Math.floor(Date.now() / 1000);
const proposal = {
  id: '72',
  title: 'Question 72',
  proposalSmtAddress: '0x0',
  sendVoteContractAddress: PASSPORT,
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
// TD3: DG1 of 93 bytes, the Groth16 mainnet path.
const passport = {
  dataGroup1: new Uint8Array(93),
  getMRZData: () => ({ birthDate: '850315', issuingCountry: 'FRA' }),
  getPassportHash: () => 123n,
};
const ft = {
  isAlreadyVoted: jest.fn(async () => false),
  verify: jest.fn(async () => undefined),
  submitProposal: jest.fn(async () => '0xtx'),
};

function run(privateKey?: string) {
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
        proposalInfo={proposal as any}
        answerIndex={1}
        network="mainnet"
        isPassportFlow
        privateKey={privateKey}
      />
    </ThemeProvider>,
  );
  const settled = () => waitFor(() => expect(onSuccess.mock.calls.length + onError.mock.calls.length).toBe(1));
  return { r, onSuccess, onError, settled };
}

beforeEach(() => {
  resetVoteAttempts();
  mockPrepare.mockClear();
  mockSubmit.mockClear();
  mockGlobalKey.mockClear();
});

describe('Step 11 passport vote: the captured key of the attempt (R2)', () => {
  it('proves with the key handed in by the flow, not the global slot', async () => {
    const captured = 'ab'.repeat(32);
    const { onSuccess, settled } = run(captured);
    await settled();
    expect(onSuccess).toHaveBeenCalledWith('0xtx', true);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockPrepare.mock.calls[0][0].bjjPrivateKeyHex).toBe(captured);
    expect(mockGlobalKey).not.toHaveBeenCalled();
  });

  it('a later prop change does not reach the attempt already running', async () => {
    const first = 'ab'.repeat(32);
    let release: () => void = () => undefined;
    mockPrepare.mockImplementationOnce(
      (args: any) => new Promise((resolve) => { release = () => resolve({ prepared: true, key: args.bjjPrivateKeyHex }); }),
    );
    const { r, settled } = run(first);
    await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(1));
    r.rerender(
      <ThemeProvider>
        <Step11
          containerWidth={300}
          isActive
          freedomTool={ft as any}
          rarime={{} as any}
          passport={passport as any}
          proposalInfo={proposal as any}
          answerIndex={1}
          network="mainnet"
          isPassportFlow
          privateKey={'cd'.repeat(32)}
        />
      </ThemeProvider>,
    );
    release();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0].key).toBe(first);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    void settled;
  });

  it('with no captured key, stops before any proof and never reads the global slot', async () => {
    const { onError, settled } = run(undefined);
    await settled();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockGlobalKey).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][2]).toBe('unknown');
  });
});
