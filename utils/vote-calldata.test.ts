import { ethers } from 'ethers';
import { buildVoteCalldata } from './vote-calldata';
import type { Groth16Proof } from './groth16-vote';

// Synthetic proof — public-signal indices that buildVoteCalldata reads:
//   [0]  nullifier
//   [11] registrationRoot
//   [13] currentDate
// (TD3 layout). Other slots are filled with 0n / "0" so layouts that don't
// match what the caller expects throw early on length checks.
const makeProof = (overrides: Partial<Record<number, string>> = {}): Groth16Proof => {
  const ps: string[] = Array(24).fill('0');
  ps[0] = '1234567890';                                       // nullifier
  ps[11] = '99999999999999999999999999999999';                // registrationRoot
  ps[13] = '250519';                                          // currentDate YYMMDD = 25-05-19
  ps[15] = '1744000000';                                      // identityCreationTimestamp
  for (const [k, v] of Object.entries(overrides)) ps[Number(k)] = v as string;
  return {
    proof: {
      pi_a: ['1', '2', '1'],
      pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
      pi_c: ['7', '8', '1'],
      protocol: 'groth16',
    },
    pub_signals: ps,
  };
};

describe('buildVoteCalldata', () => {
  it('produces a 0x-prefixed hex calldata with the right destination', () => {
    const r = buildVoteCalldata({
      proof: makeProof(),
      proposalId: 47,
      voteIndices: [0],
      citizenship: 'FRA',
    });
    expect(r.calldata).toMatch(/^0x[0-9a-f]+$/);
    expect(r.destination).toBe('0x8Dea8065888A14F66ba9Fb944353d898663863cf');
  });

  it('decodes citizenship as big-endian ASCII bytes', () => {
    // "FRA" → 0x46 0x52 0x41 → 4607553
    const r = buildVoteCalldata({
      proof: makeProof(),
      proposalId: 47,
      voteIndices: [0],
      citizenship: 'FRA',
    });
    expect(r.decoded.citizenship).toBe(BigInt(0x46_52_41));
  });

  it('packs vote indices as 1 << index', () => {
    const r = buildVoteCalldata({
      proof: makeProof(),
      proposalId: 47,
      voteIndices: [2],
      citizenship: 'FRA',
    });
    const iface = new ethers.Interface([
      'function vote(bytes32, uint256, uint256, uint256[], (uint256,uint256,uint256), (uint256[2],uint256[2][2],uint256[2]))',
    ]);
    const parsed = iface.parseTransaction({ data: r.calldata });
    const voteArr = parsed!.args[3] as bigint[];
    expect(voteArr).toHaveLength(1);
    expect(voteArr[0]).toBe(1n << 2n);
  });

  it('routes registrationRoot from pub_signals[11] into bytes32 arg', () => {
    const r = buildVoteCalldata({
      proof: makeProof({ 11: '0x1c0f9d0df4269664aba3c3b0e96b1029e3273a1728b6c6674e75b18983db7a60' }),
      proposalId: 47,
      voteIndices: [0],
      citizenship: 'FRA',
    });
    expect(r.decoded.registrationRoot.toLowerCase()).toBe(
      '0x1c0f9d0df4269664aba3c3b0e96b1029e3273a1728b6c6674e75b18983db7a60',
    );
  });

  it('uses ps[15] for identityCreationTimestamp when isRegisteredAfterVoting=true', () => {
    const r = buildVoteCalldata({
      proof: makeProof(),
      proposalId: 47,
      voteIndices: [0],
      citizenship: 'FRA',
      isRegisteredAfterVoting: true,
    });
    const iface = new ethers.Interface([
      'function vote(bytes32, uint256, uint256, uint256[], (uint256 nullifier, uint256 citizenship, uint256 identityCreationTimestamp), (uint256[2],uint256[2][2],uint256[2]))',
    ]);
    const parsed = iface.parseTransaction({ data: r.calldata });
    expect(parsed!.args[4].identityCreationTimestamp).toBe(1744000000n);
  });

  it('throws helpfully when pub_signals are too short (wrong circuit)', () => {
    const tooShort: Groth16Proof = {
      proof: {
        pi_a: ['1', '2', '1'],
        pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
        pi_c: ['7', '8', '1'],
        protocol: 'groth16',
      },
      pub_signals: ['1', '2', '3'], // only 3 — a register-circuit proof, not query
    };
    expect(() =>
      buildVoteCalldata({
        proof: tooShort,
        proposalId: 47,
        voteIndices: [0],
        citizenship: 'FRA',
      }),
    ).toThrow(/pub_signals/);
  });
});
