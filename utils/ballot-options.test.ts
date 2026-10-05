/**
 * Ballot integrity (wave 4b, C3): a permuted option array silently inverts a
 * vote, because a vote is an index into it. Two unauthenticated sources feed
 * that array — the IPFS gateway and this app's own AsyncStorage cache — and
 * both are pinned here against the bundled copy for the CID the chain names.
 *
 * The first describe drives the REAL patched FreedomTool build, so it fails
 * on an SDK build without the fix.
 */
import { BUNDLED_PROPOSAL_METADATA } from '@/constants/bundled-proposal-metadata';
import { FREEDOM_TOOL_MAINNET_CONFIG } from '@/constants/rarime-config';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { optionOrderMatchesBundled, withBundledOptionOrder } from '@/utils/ballot-options';
import { loadSdkBuild } from './testing/load-sdk-build';

const CID_73 = 'QmUgNBTTbJ4jca7fkZGkcSfvSku3dRMthV9MNT5gCPVwk2';
const BUNDLED = BUNDLED_PROPOSAL_METADATA[CID_73];

const { FreedomTool } = loadSdkBuild(
  'Freedomtool.js',
  {
    './types': { IDCardVoting__factory: {}, PoseidonSMT__factory: {}, ProposalsState__factory: {} },
    './helpers/contracts': {},
    './Rarime': { mrzDateOrUtcToday: () => '260922' },
  },
  require,
);

/** The authentic ballot of #73, with Oui and Non swapped. */
function invertedOptions() {
  const variants = [...BUNDLED.acceptedOptions[0].variants];
  [variants[0], variants[1]] = [variants[1], variants[0]];
  return [{ title: BUNDLED.acceptedOptions[0].title, variants }];
}

function makeFt(cid: string, metadata: () => Promise<unknown>, onChainMasks: bigint[] = []) {
  const ft = new FreedomTool(FREEDOM_TOOL_MAINNET_CONFIG);
  ft.getProposalInfoFromContracts = async () => [
    '0xsmt',
    0n,
    [1_789_430_400n, 8_640_000n, 0n, onChainMasks, cid, ['0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F'], []],
    [[0n, 0n, 0n, 0n]],
  ];
  ft.getProposalMetadata = metadata;
  ft.getProposalRules = async () => [39457n, [], 0n, 0n, 0n, 0n, 0n, 0n];
  return ft;
}

describe('a gateway that permutes the options does not change what a vote means', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(' '));
      });
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('the bundled order wins over a well-formed but permuted answer', async () => {
    const ft = makeFt(CID_73, async () => ({
      title: BUNDLED.title,
      description: BUNDLED.description,
      acceptedOptions: invertedOptions(),
    }));
    const info = await ft.getProposalInfo('73');
    // Index 0 is still the option the authentic file puts at index 0.
    expect(info.questions).toEqual(BUNDLED.acceptedOptions);
    expect(info.questions[0].variants[0]).toBe(BUNDLED.acceptedOptions[0].variants[0]);
  });

  it('says so under a constant code, naming neither the CID nor the body', async () => {
    const ft = makeFt(CID_73, async () => ({
      title: BUNDLED.title,
      acceptedOptions: invertedOptions(),
    }));
    await ft.getProposalInfo('73');
    expect(logs).toContain('[SDK][getProposalInfo] #73 BALLOT_OPTIONS_MISMATCH bundled-order-used');
    expect(logs.join('\n')).not.toContain(CID_73.slice(0, 10));
  });

  it('display text from the gateway is still used: only the order is taken back', async () => {
    const ft = makeFt(CID_73, async () => ({
      title: 'Titre corrigé',
      description: 'Description corrigée',
      acceptedOptions: invertedOptions(),
    }));
    const info = await ft.getProposalInfo('73');
    expect(info.title).toBe('Titre corrigé');
    expect(info.description).toBe('Description corrigée');
    expect(info.questions).toEqual(BUNDLED.acceptedOptions);
  });

  it('an added option cannot appear either', async () => {
    const ft = makeFt(CID_73, async () => ({
      title: BUNDLED.title,
      acceptedOptions: [
        {
          title: BUNDLED.acceptedOptions[0].title,
          variants: [...BUNDLED.acceptedOptions[0].variants, 'Oui, absolument'],
        },
      ],
    }));
    expect((await ft.getProposalInfo('73')).questions).toEqual(BUNDLED.acceptedOptions);
  });

  it('an untouched answer passes through unremarked', async () => {
    const ft = makeFt(CID_73, async () => ({
      title: BUNDLED.title,
      description: BUNDLED.description,
      acceptedOptions: BUNDLED.acceptedOptions,
      rankingBased: false,
    }));
    const info = await ft.getProposalInfo('73');
    expect(info.questions).toEqual(BUNDLED.acceptedOptions);
    expect(logs.join('\n')).not.toContain('BALLOT_OPTIONS_MISMATCH');
  });

  it('the CID carried on the result is the one the chain named', async () => {
    const ft = makeFt(CID_73, async () => ({ title: 'x', acceptedOptions: BUNDLED.acceptedOptions }));
    expect((await ft.getProposalInfo('73')).metadataCid).toBe(CID_73);
  });

  describe('a CID this build does not ship', () => {
    const live = { title: 'Nouvelle question', acceptedOptions: [{ title: 'q', variants: ['Oui', 'Non'] }] };

    it('is bounded by the chain: more variants than the contract accepts is refused', async () => {
      // mask 0b0001 accepts one option; the file claims two.
      const ft = makeFt('QmNotBundled', async () => live, [1n]);
      await expect(ft.getProposalInfo('99')).rejects.toThrow('[SDK] BALLOT_OPTIONS_REFUSED #99');
      expect(logs.join('\n')).not.toContain('QmNotBundled');
    });

    it('more questions than the contract accepts is refused', async () => {
      const ft = makeFt(
        'QmNotBundled',
        async () => ({ title: 'x', acceptedOptions: [live.acceptedOptions[0], live.acceptedOptions[0]] }),
        [3n],
      );
      await expect(ft.getProposalInfo('99')).rejects.toThrow('[SDK] BALLOT_OPTIONS_REFUSED #99');
    });

    it('is shown when it fits the chain, because refusing a live question is worse', async () => {
      const ft = makeFt('QmNotBundled', async () => live, [3n]);
      expect((await ft.getProposalInfo('99')).questions).toEqual(live.acceptedOptions);
    });

    it('is shown when the chain says nothing about the shape', async () => {
      const ft = makeFt('QmNotBundled', async () => live, []);
      expect((await ft.getProposalInfo('99')).questions).toEqual(live.acceptedOptions);
    });
  });
});

describe('the same door, on this app own cache', () => {
  /** Only the fields this path reads; the rest of ProposalInfo is irrelevant. */
  const asProposal = (o: object): ProposalInfo => o as unknown as ProposalInfo;
  const proposal = asProposal({
    id: '73',
    metadataCid: CID_73,
    title: BUNDLED.title,
    questions: BUNDLED.acceptedOptions,
  });

  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('gives a tampered cached ballot its real order back', () => {
    const tampered = asProposal({ ...proposal, questions: invertedOptions() });
    expect(withBundledOptionOrder(tampered).questions).toEqual(BUNDLED.acceptedOptions);
  });

  it('leaves an untouched one alone, object identity included', () => {
    expect(withBundledOptionOrder(proposal)).toBe(proposal);
  });

  it('leaves a proposal with no bundled copy alone', () => {
    const unknown = asProposal({ ...proposal, metadataCid: 'QmNotBundled' });
    expect(withBundledOptionOrder(unknown)).toBe(unknown);
  });

  it('leaves a proposal with no CID alone, as an older cache entry has none', () => {
    const noCid = asProposal({ id: '73', questions: invertedOptions() });
    expect(withBundledOptionOrder(noCid)).toBe(noCid);
  });

  it('optionOrderMatchesBundled answers the question on its own', () => {
    expect(optionOrderMatchesBundled(CID_73, BUNDLED.acceptedOptions)).toBe(true);
    expect(optionOrderMatchesBundled(CID_73, invertedOptions())).toBe(false);
    expect(optionOrderMatchesBundled(undefined, BUNDLED.acceptedOptions)).toBe(false);
    expect(optionOrderMatchesBundled('QmNotBundled', BUNDLED.acceptedOptions)).toBe(false);
  });
});
