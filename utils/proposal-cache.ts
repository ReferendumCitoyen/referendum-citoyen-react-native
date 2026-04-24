/**
 * Shared proposal cache. The home screen keeps a list of recent proposals in
 * AsyncStorage; the voting flow reads from that cache on entry to skip the
 * ~2–3 s `ft.getProposalInfo()` network roundtrip that otherwise gates Step 7.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';

export const PROPOSALS_CACHE_KEY = 'cached_proposals_v1';

export const bigintReplacer = (_: string, v: any) =>
  typeof v === 'bigint' ? v.toString() + 'n' : v;

export const bigintReviver = (_: string, v: any) =>
  typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v;

export async function readCachedProposals(): Promise<ProposalInfo[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PROPOSALS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw, bigintReviver) as ProposalInfo[];
  } catch {
    return null;
  }
}

export async function findCachedProposal(id: string): Promise<ProposalInfo | null> {
  const list = await readCachedProposals();
  if (!list) return null;
  return list.find(p => String(p.id) === String(id)) ?? null;
}

export async function writeCachedProposals(list: ProposalInfo[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PROPOSALS_CACHE_KEY, JSON.stringify(list, bigintReplacer));
  } catch {}
}
