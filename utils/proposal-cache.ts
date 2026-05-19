/**
 * Shared proposal cache. The home screen keeps a list of recent proposals in
 * AsyncStorage; the voting flow reads from that cache on entry to skip the
 * ~2–3 s `ft.getProposalInfo()` network roundtrip that otherwise gates Step 7.
 *
 * **Network-namespaced.** Each network has its own proposal-id space
 * (testnet's #302 has nothing to do with Mainnet's #302), so the cache key is
 * suffixed with the network. Without this, switching network in Settings would
 * leave the old network's proposals in the cache and the voting flow would
 * try to vote on a foreign proposal id — exactly the bug observed in the
 * Mainnet test where Step 11 hit a stale testnet proposal #302 while the
 * SDK was bound to Mainnet contracts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import type { Network } from '@/constants/rarime-config';

const PROPOSALS_CACHE_KEY_PREFIX = 'cached_proposals_v1';

const cacheKeyFor = (network: Network): string =>
  `${PROPOSALS_CACHE_KEY_PREFIX}:${network}`;

// Legacy single-network key, kept around so old installs that wrote to it
// before the namespacing change can be cleared on first run.
export const LEGACY_CACHE_KEY = PROPOSALS_CACHE_KEY_PREFIX;

export const bigintReplacer = (_: string, v: any) =>
  typeof v === 'bigint' ? v.toString() + 'n' : v;

export const bigintReviver = (_: string, v: any) =>
  typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v;

export async function readCachedProposals(network: Network): Promise<ProposalInfo[] | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKeyFor(network));
    if (!raw) return null;
    return JSON.parse(raw, bigintReviver) as ProposalInfo[];
  } catch {
    return null;
  }
}

export async function findCachedProposal(network: Network, id: string): Promise<ProposalInfo | null> {
  const list = await readCachedProposals(network);
  if (!list) return null;
  return list.find(p => String(p.id) === String(id)) ?? null;
}

export async function writeCachedProposals(network: Network, list: ProposalInfo[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKeyFor(network), JSON.stringify(list, bigintReplacer));
  } catch {}
}

/** One-time cleanup: wipe the legacy unnamespaced entry left behind by builds
 * that wrote before this file gained network awareness. Safe to call
 * repeatedly. */
export async function migrateLegacyCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {}
}
