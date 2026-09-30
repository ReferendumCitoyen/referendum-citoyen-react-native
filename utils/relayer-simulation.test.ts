import { ethers } from 'ethers';
import {
  assertWouldNotRevert,
  revertReasonOf,
  IDENTITY_BOUND_ELSEWHERE,
  REGISTRATION_REVERT,
} from './relayer-simulation';
import { MAINNET_REGISTRATION_RELAYER_EOA } from '@/constants/rarime-config';

const errorString = (reason: string) =>
  '0x08c379a0' + ethers.AbiCoder.defaultAbiCoder().encode(['string'], [reason]).slice(2);

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// The relayer hides every revert behind a 500. The dry run exists to read the
// reason, so decoding it from each shape a node returns is the whole point.
describe('revertReasonOf', () => {
  it('decodes an Error(string) payload in err.data', () => {
    expect(revertReasonOf({ code: 'CALL_EXCEPTION', data: errorString('StateKeeper: certificate is expired') }))
      .toBe('StateKeeper: certificate is expired');
  });

  it('decodes an Error(string) payload nested under info.error.data', () => {
    expect(revertReasonOf({ info: { error: { data: errorString('SparseMerkleTree: the key already exists') } } }))
      .toBe('SparseMerkleTree: the key already exists');
  });

  it('uses the reason ethers already decoded', () => {
    expect(revertReasonOf({ code: 'CALL_EXCEPTION', reason: 'StateKeeper: identity already registered', data: null }))
      .toBe('StateKeeper: identity already registered');
  });

  it('reads a node that only reports the reason in its message', () => {
    expect(revertReasonOf({
      code: 'CALL_EXCEPTION',
      shortMessage: 'missing revert data',
      info: { error: { message: 'execution reverted: StateKeeper: passport already registered' } },
    })).toBe('StateKeeper: passport already registered');
  });

  it('names a bare revert with no reason', () => {
    expect(revertReasonOf({ message: 'execution reverted' })).toBe('execution reverted');
  });

  // What an UltraPlonk verifier throws on a proof it does not accept — which
  // is what a circuit whose verification key is not the one on chain gets.
  // No string, so ethers leaves `reason` null; the selector must survive.
  it('names a custom error by its selector', () => {
    expect(revertReasonOf({
      code: 'CALL_EXCEPTION',
      reason: null,
      data: '0x0711fcec' + '00'.repeat(32),
      message: 'execution reverted (unknown custom error)',
    })).toBe('custom error 0x0711fcec (36 bytes of revert data)');
  });

  it('decodes a Panic code', () => {
    const panic = '0x4e487b71' + ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0x32]).slice(2);
    expect(revertReasonOf({ code: 'CALL_EXCEPTION', data: panic })).toBe('panic 0x32');
  });

  it('still reads an empty data field as a bare revert', () => {
    expect(revertReasonOf({ code: 'CALL_EXCEPTION', data: '0x', message: 'execution reverted' }))
      .toBe('execution reverted');
  });

  it('returns null for a transport failure', () => {
    expect(revertReasonOf({ code: 'NETWORK_ERROR', message: 'could not detect network' })).toBeNull();
    expect(revertReasonOf({ code: 'TIMEOUT', message: 'timeout' })).toBeNull();
  });

  it('returns null for things that are not errors', () => {
    expect(revertReasonOf(null)).toBeNull();
    expect(revertReasonOf('boom')).toBeNull();
    expect(revertReasonOf(new Error('Network request failed'))).toBeNull();
  });
});

describe('assertWouldNotRevert', () => {
  const args = { calldata: '0xdead', destination: '0x' + '1'.repeat(40), label: 'test' };

  it('calls from the relayer address and resolves when the call succeeds', async () => {
    const call = jest.fn().mockResolvedValue('0x');
    await expect(assertWouldNotRevert(args, call)).resolves.toBeUndefined();
    expect(call).toHaveBeenCalledWith({
      from: MAINNET_REGISTRATION_RELAYER_EOA,
      to: args.destination,
      data: args.calldata,
    });
  });

  it('turns "identity already registered" into IDENTITY_BOUND_ELSEWHERE', async () => {
    const call = jest.fn().mockRejectedValue({
      code: 'CALL_EXCEPTION',
      data: errorString('StateKeeper: identity already registered'),
    });
    await expect(assertWouldNotRevert(args, call)).rejects.toThrow(
      `${IDENTITY_BOUND_ELSEWHERE} StateKeeper: identity already registered`,
    );
  });

  it('turns any other revert into REGISTRATION_REVERT with the reason', async () => {
    const call = jest.fn().mockRejectedValue({
      code: 'CALL_EXCEPTION',
      data: errorString('SparseMerkleTree: the key already exists'),
    });
    await expect(assertWouldNotRevert(args, call)).rejects.toThrow(
      `${REGISTRATION_REVERT} SparseMerkleTree: the key already exists`,
    );
  });

  // A revert is authoritative; a failure to simulate is not. The relayer
  // would have accepted the call, so the app must not block on its own RPC.
  it('lets the submission proceed when the simulation itself fails', async () => {
    const call = jest.fn().mockRejectedValue({ code: 'NETWORK_ERROR', message: 'could not detect network' });
    await expect(assertWouldNotRevert(args, call)).resolves.toBeUndefined();
  });
});
