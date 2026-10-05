/**
 * Item 16: the proof and the registration root it was generated against are
 * bound together and frozen; the vote calldata carries exactly that root,
 * with no second SMT read and no state kept on the Rarime instance.
 * Also R5: the calldata date is the proof's own public signal.
 *
 * Runs the patched build files (utils/testing/load-sdk-build.ts).
 */
import { loadSdkBuild } from './testing/load-sdk-build';

const ROOT_A = '0x' + 'aa'.repeat(32);
const ROOT_B = '0x' + 'bb'.repeat(32);

const prove = jest.fn(async (inputs: string) => {
  const parsed = JSON.parse(inputs);
  // 15 public signals like TD1: [12] = id_state_root, [14] = current_date.
  const pub = Array.from({ length: 15 }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
  pub[12] = parsed.id_state_root.slice(2);
  pub[14] = parsed.current_date.slice(2);
  return { proof: 'cafe', pub_signals: pub };
});

const rarimeModule = loadSdkBuild(
  'Rarime.js',
  {
    './RarimePassport': { DocumentStatus: {} },
    './types/contracts': {},
    './RnNoirModule': {
      NoirCircuitParams: {
        fromName: () => ({ prove, downloadByteCode: async () => 'bytecode' }),
        downloadTrustedSetup: async () => undefined,
        formatArray: (a: string[]) => a,
      },
    },
    'react-native': { Platform: { OS: 'ios' } },
    './helpers/HashAlgorithm': {},
    './helpers/contracts': {},
    './RarimeUtils': { RarimeUtils: { getProfileKey: () => '11' } },
    './helpers/SignatureAlgorithm': {},
    './utils': { toPaddedHex32: (v: unknown) => String(v), wrapPem: () => '' },
    '@iden3/js-crypto': { Poseidon: { hash: () => 0n } },
  },
  require,
);

const encodeFunctionData = jest.fn((_fn: string, _args: unknown[]) => '0xcalldata');
const { FreedomTool } = loadSdkBuild(
  'Freedomtool.js',
  {
    './types': { IDCardVoting__factory: {}, PoseidonSMT__factory: {}, ProposalsState__factory: {} },
    './helpers/contracts': { createIDCardVotingContract: () => ({ contractInterface: { encodeFunctionData } }) },
    './Rarime': rarimeModule,
  },
  require,
);

const passport = {
  dataGroup1: new Uint8Array(95),
  getPassportKey: () => 1n,
  verifyPassport: jest.fn(),
};
const passportInfo = [
  { activeIdentity: '0x11', identityReissueCounter: 0n },
  [0n, 0n],
];
const proposalInfo = {
  id: '73',
  startTimestamp: 1_789_430_400n,
  duration: 8_640_000n,
  sendVoteContractAddress: '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F',
  criteria: {
    selector: 1n,
    timestampUpperbound: 10n ** 12n,
    identityCountUpperbound: 1n,
    birthDateLowerbound: 0n,
    birthDateUpperbound: 0n,
    expirationDateLowerbound: 0n,
  },
};
const params = {
  eventId: '1', eventData: '2', selector: '3', timestampLowerbound: '0', timestampUpperbound: '0',
  identityCountLowerbound: '0', identityCountUpperbound: '0', birthDateLowerbound: '0',
  birthDateUpperbound: '0', expirationDateLowerbound: '0', expirationDateUpperbound: '0', citizenshipMask: '0',
};

function makeRarime(roots: string[]) {
  const r = new rarimeModule.Rarime({ userConfiguration: { userPrivateKey: '01'.repeat(32) } });
  r.getPassportInfo = async () => passportInfo;
  let i = 0;
  r.getSMTProof = jest.fn(async () => ({ root: roots[Math.min(i++, roots.length - 1)], siblings: [] }));
  return r;
}
function makeFreedomTool() {
  const ft = new FreedomTool({
    contracts: { proposalStateAddress: '0x0' },
    api: { ipfsUrl: 'x', votingRelayerUrl: 'https://relayer.invalid', votingRpcUrl: 'https://rpc.invalid' },
  });
  ft.isAlreadyVoted = async () => false;
  ft.getEventId = async () => 5n;
  return ft;
}
const calldataRoot = () => encodeFunctionData.mock.calls[encodeFunctionData.mock.calls.length - 1][1][0];
const calldataDate = () => encodeFunctionData.mock.calls[encodeFunctionData.mock.calls.length - 1][1][1];

const realFetch = global.fetch;
beforeEach(() => {
  encodeFunctionData.mockClear();
  prove.mockClear();
  passport.verifyPassport.mockClear();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: { id: '0xtx' } }) })) as any;
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = realFetch;
});

describe('generateQueryProof returns the proof bound to its root', () => {
  it('returns a frozen { proof, idStateRoot } and keeps nothing on the instance', async () => {
    const r = makeRarime([ROOT_A]);
    const bound = await r.generateQueryProof(params, passport);
    expect(bound.idStateRoot).toBe(ROOT_A);
    expect(bound.proof.proof).toBe('cafe');
    expect(Object.isFrozen(bound)).toBe(true);
    expect('lastQueryIdStateRoot' in r).toBe(false);
  });

  it('two concurrent proofs on one instance keep their own root', async () => {
    const r = makeRarime([ROOT_A, ROOT_B]);
    const [first, second] = await Promise.all([
      r.generateQueryProof(params, passport),
      r.generateQueryProof(params, passport),
    ]);
    expect(first.idStateRoot).toBe(ROOT_A);
    expect(second.idStateRoot).toBe(ROOT_B);
    const ft = makeFreedomTool();
    await ft.buildProposalCallData([0], proposalInfo, r, passport, first, passportInfo);
    expect(calldataRoot()).toBe(ROOT_A);
  });
});

describe('buildProposalCallData', () => {
  it('root A during the proof, root B on chain before the calldata: A is used, and the SMT is read once', async () => {
    const r = makeRarime([ROOT_A, ROOT_B]);
    const bound = await r.generateQueryProof(params, passport);
    const ft = makeFreedomTool();
    await ft.buildProposalCallData([0], proposalInfo, r, passport, bound, passportInfo);
    expect(calldataRoot()).toBe(ROOT_A);
    expect(r.getSMTProof).toHaveBeenCalledTimes(1);
  });

  it('a proof without its root sends nothing', async () => {
    const r = makeRarime([ROOT_A]);
    const bare = await r.generateQueryProof(params, passport);
    const ft = makeFreedomTool();
    await expect(
      ft.buildProposalCallData([0], proposalInfo, r, passport, { proof: bare.proof }, passportInfo),
    ).rejects.toThrow(/no registration root/);
    // The 2.0.1 shape (the raw proof, root on the instance) is refused too.
    await expect(ft.buildProposalCallData([0], proposalInfo, r, passport, bare.proof, passportInfo)).rejects.toThrow(
      /no query proof/,
    );
    expect(encodeFunctionData).not.toHaveBeenCalled();
  });

  it('submitProposal with a prover that loses the root never reaches the relayer', async () => {
    const r = makeRarime([ROOT_A]);
    const real = r.generateQueryProof.bind(r);
    r.generateQueryProof = async (p: unknown, d: unknown) => ({ proof: (await real(p, d)).proof });
    const ft = makeFreedomTool();
    await expect(ft.submitProposal({ answers: [0], proposalInfo, rarime: r, passport })).rejects.toThrow(
      /no registration root/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('sendProposalRequest tags every failure once the POST may have left (R4)', () => {
  const send = (ft: any) => ft.sendProposalRequest('0xcalldata', proposalInfo);

  it('no answer at all', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    }) as any;
    await expect(send(makeFreedomTool())).rejects.toMatchObject({ votePostSent: true, code: 'VOTE_POST_SENT' });
  });

  it('an HTTP error carries its status', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, statusText: 'x', text: async () => '<html>' })) as any;
    await expect(send(makeFreedomTool())).rejects.toMatchObject({ votePostSent: true, status: 503 });
  });

  it('an accepted vote whose answer cannot be read', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('JSON Parse error');
      },
    })) as any;
    await expect(send(makeFreedomTool())).rejects.toMatchObject({ votePostSent: true });
  });

  it('returns the transaction id otherwise', async () => {
    await expect(send(makeFreedomTool())).resolves.toBe('0xtx');
  });
});

describe('one date per attempt (R5)', () => {
  it('a proof started at 23:58 UTC and sent at 00:01 UTC keeps the proof’s date', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-09-20T23:58:00Z'));
    const r = makeRarime([ROOT_A]);
    const real = r.generateQueryProof.bind(r);
    r.generateQueryProof = async (p: any, d: unknown) => {
      const out = await real(p, d);
      // The proof took three minutes: the calldata is built on the next day.
      jest.setSystemTime(new Date('2026-09-21T00:01:00Z'));
      return out;
    };
    const ft = makeFreedomTool();
    await ft.submitProposal({ answers: [0], proposalInfo, rarime: r, passport });
    // "260920" as the proof committed it, not a fresh "260921".
    expect(calldataDate()).toBe('0x' + Buffer.from('260920').toString('hex'));
    // And the SDK age pre-check read the very same day.
    expect(passport.verifyPassport).toHaveBeenCalledWith(proposalInfo, '260920');
  });

  it('the caller’s own attempt date wins over the clock', async () => {
    const r = makeRarime([ROOT_A]);
    const ft = makeFreedomTool();
    await ft.submitProposal({ answers: [0], proposalInfo, rarime: r, passport, currentDate: '260919' });
    expect(calldataDate()).toBe('0x' + Buffer.from('260919').toString('hex'));
    expect(passport.verifyPassport).toHaveBeenCalledWith(proposalInfo, '260919');
  });
});
