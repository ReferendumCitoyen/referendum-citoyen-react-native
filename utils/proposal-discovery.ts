/**
 * Find the proposals on chain instead of being told about them.
 *
 * The home screen's list normally comes from a signed index published to
 * GitHub Pages — and that file is shared with the PRODUCTION app. Adding a
 * test proposal to it to make it reachable in Beta would put it in front of
 * real voters, which is exactly what the index exists to prevent. So the
 * dependency runs the wrong way for a test build: the one list we must not
 * edit is the one Beta needs to change most often.
 *
 * On the Beta flavour, therefore, the index is bypassed and ProposalsState is
 * asked directly: walk up from the auto-visible floor and keep whatever
 * exists. New scrutins then appear in Beta the moment they are created, with
 * no file to edit, nothing to sign, and no risk to the production list.
 *
 * NOT enabled for production, and the flag says why. Curation is the point
 * there — a voter should see the scrutins the team published, not every test
 * proposal that happens to be on chain.
 *
 * The walk itself is injectable, so the stopping rule is testable without a
 * node.
 */
import { ethers } from 'ethers';
import {
  MAINNET_PROPOSALS_STATE_ADDRESS,
  RARIME_MAINNET_CONFIG,
} from '@/constants/rarime-config';
import { AUTO_VISIBLE_PROPOSAL_ID_FROM } from '@/constants/test-proposal-visibility';

const PROPOSALS_STATE_ABI = [
  'function getProposalConfig(uint256) view returns (tuple(uint64 startTimestamp, uint64 duration, uint256 multichoice, uint256[] acceptedOptions, string description, address[] votingWhitelist, bytes[] votingWhitelistData) config)',
];

/** Ids are contiguous in practice, but a gap must not end the walk — stop
 *  only after this many misses in a row. */
const STOP_AFTER_CONSECUTIVE_MISSES = 8;
/** Voting contracts of every proposal the walk saw, by id, lower-cased.
 * Filled as a side effect of the existence test, which reads the config
 * anyway. The SDK's ProposalInfo only carries entry [0], so this is the one
 * place the app can tell a proposal both documents can vote from a card-only
 * one. */
const votingContracts = new Map<string, string[]>();

export function votingContractsOf(id: string | number): string[] | undefined {
  return votingContracts.get(String(id));
}

/** Hard ceiling, so a malfunctioning `exists` cannot walk forever. */
const MAX_ID = 400;
/** How many ids to ask about at once. */
const BATCH = 16;

export interface DiscoverOptions {
  /** First id to consider. Defaults to the auto-visible floor (52). */
  fromId?: number;
  maxId?: number;
  batchSize?: number;
  stopAfterConsecutiveMisses?: number;
  /** Does a proposal with this id exist? Injected for tests. */
  exists: (id: number) => Promise<boolean>;
}

/**
 * Ids that exist, from `fromId` upward, as decimal strings.
 *
 * Batched so the common case is a couple of round trips rather than one per
 * id, and the walk ends once a run of ids comes back empty.
 */
export async function discoverProposalIds(opts: DiscoverOptions): Promise<string[]> {
  const from = opts.fromId ?? AUTO_VISIBLE_PROPOSAL_ID_FROM;
  const maxId = opts.maxId ?? MAX_ID;
  const batchSize = opts.batchSize ?? BATCH;
  const stopAfter = opts.stopAfterConsecutiveMisses ?? STOP_AFTER_CONSECUTIVE_MISSES;

  const found: string[] = [];
  let consecutiveMisses = 0;

  for (let start = from; start <= maxId; start += batchSize) {
    const ids = Array.from(
      { length: Math.min(batchSize, maxId - start + 1) },
      (_, i) => start + i,
    );
    const present = await Promise.all(ids.map((id) => opts.exists(id).catch(() => false)));

    for (let i = 0; i < ids.length; i++) {
      if (present[i]) {
        found.push(String(ids[i]));
        consecutiveMisses = 0;
      } else {
        consecutiveMisses += 1;
        // Everything after this point in the batch is already known; the
        // outer loop is what actually stops, below.
        if (consecutiveMisses >= stopAfter) break;
      }
    }
    if (consecutiveMisses >= stopAfter) break;
  }

  return found;
}

/** The real walk, against Mainnet's ProposalsState. */
export async function discoverMainnetProposalIds(): Promise<string[]> {
  const provider = new ethers.JsonRpcProvider(
    RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl,
  );
  const contract = new ethers.Contract(
    MAINNET_PROPOSALS_STATE_ADDRESS,
    PROPOSALS_STATE_ABI,
    provider,
  );
  // A proposal that was never created reads back as a zeroed struct, so the
  // start timestamp is the existence test.
  const exists = async (id: number): Promise<boolean> => {
    const config = await contract.getProposalConfig(id);
    const present = BigInt(config.startTimestamp) > 0n;
    if (present) {
      votingContracts.set(
        String(id),
        Array.from(config.votingWhitelist as readonly string[]).map((a) => a.toLowerCase()),
      );
    }
    return present;
  };
  const ids = await discoverProposalIds({ exists });
  console.log(
    `[proposal-discovery] ${ids.length} proposals on chain from #${AUTO_VISIBLE_PROPOSAL_ID_FROM}: [${ids.join(', ')}]`,
  );
  return ids;
}
