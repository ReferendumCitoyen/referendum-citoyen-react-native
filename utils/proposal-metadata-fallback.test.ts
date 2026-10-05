/**
 * Update 22/09: an IPFS metadata failure never hides an open question. The
 * patched FreedomTool.getProposalInfo falls back to the bundled copy for the
 * CID and logs only the proposal id and a constant code.
 */
import { BUNDLED_PROPOSAL_METADATA } from '@/constants/bundled-proposal-metadata';
import { FREEDOM_TOOL_MAINNET_CONFIG } from '@/constants/rarime-config';
import { loadSdkBuild } from './testing/load-sdk-build';

const CID_73 = 'QmUgNBTTbJ4jca7fkZGkcSfvSku3dRMthV9MNT5gCPVwk2';
const { FreedomTool } = loadSdkBuild(
  'Freedomtool.js',
  {
    './types': { IDCardVoting__factory: {}, PoseidonSMT__factory: {}, ProposalsState__factory: {} },
    './helpers/contracts': {},
    './Rarime': { mrzDateOrUtcToday: () => '260922' },
  },
  require,
);

function makeFt(cid: string, metadata: () => Promise<unknown>) {
  const ft = new FreedomTool(FREEDOM_TOOL_MAINNET_CONFIG);
  ft.getProposalInfoFromContracts = async () => [
    '0xsmt',
    0n,
    [1_789_430_400n, 8_640_000n, 0n, [], cid, ['0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F'], []],
    [[0n, 0n, 0n, 0n]],
  ];
  ft.getProposalMetadata = metadata;
  ft.getProposalRules = async () => [39457n, [], 0n, 0n, 0n, 0n, 0n, 0n];
  return ft;
}

describe('getProposalInfo when IPFS fails', () => {
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

  it.each([
    ['Unable to resolve data for blob'],
    ['The specified blob is invalid'],
  ])('"%s": #73 keeps its title and ballot from the bundled copy', async (message) => {
    const ft = makeFt(CID_73, async () => {
      throw new Error(message);
    });
    const info = await ft.getProposalInfo('73');
    expect(info.title).toBe(BUNDLED_PROPOSAL_METADATA[CID_73].title);
    expect(info.questions).toEqual(BUNDLED_PROPOSAL_METADATA[CID_73].acceptedOptions);
    const line = logs.find((l) => l.includes('METADATA_FETCH_FAILED'))!;
    expect(line).toBe('[SDK][getProposalInfo] #73 METADATA_FETCH_FAILED bundled-copy-used');
    expect(logs.join('\n')).not.toContain(message);
    expect(logs.join('\n')).not.toContain(CID_73.slice(0, 10));
  });

  it('a malformed file is a failure too', async () => {
    const ft = makeFt(CID_73, async () => ({ oops: true }));
    expect((await ft.getProposalInfo('73')).title).toBe(BUNDLED_PROPOSAL_METADATA[CID_73].title);
  });

  it('a CID with no bundled copy still fails, with a constant message', async () => {
    const ft = makeFt('QmUnknown', async () => {
      throw new Error('Unable to resolve data for blob');
    });
    await expect(ft.getProposalInfo('99')).rejects.toThrow('[SDK] METADATA_FETCH_FAILED #99');
    expect(logs.join('\n')).not.toContain('QmUnknown');
  });

  it('the live fetch still wins when it works', async () => {
    const ft = makeFt(CID_73, async () => ({ title: 'live', acceptedOptions: [{ title: 'q', variants: ['a'] }] }));
    expect((await ft.getProposalInfo('73')).title).toBe('live');
  });
});
