/**
 * Dynamic proposal allow-list. The set of proposal IDs the home screen
 * shows used to be hardcoded in app/(tabs)/index.tsx, which meant every
 * list change required a code edit + rebuild + store release. Instead we
 * publish the list as a JSON file via GitHub Pages
 * (workflow: .github/workflows/publish-proposal-index.yml, source:
 * public-data/proposals.json) and fetch it at runtime.
 *
 * Trust model: the JSON is *only an index of IDs*. The actual proposal
 * metadata (dates, ballot options, voting contract, identity rules) still
 * comes from the on-chain ProposalsState contract via `getProposalInfo(id)`.
 * Worst case a tampered JSON could only change WHICH proposals appear in
 * the list — it cannot change what they say or where the vote goes.
 *
 * Cache + offline strategy:
 *   1. Read AsyncStorage cache first (instant render).
 *   2. Fetch fresh in parallel with a short timeout.
 *   3. On success: cache + use fresh.
 *   4. On failure: use cache; if none, fall back to the bundled constants
 *      below so a fresh install with no network still works.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ed25519 } from '@noble/curves/ed25519';
import type { Network } from '@/constants/rarime-config';
import {
  PROPOSAL_INDEX_PUBLIC_KEY_HEX,
  PROPOSAL_INDEX_VERIFICATION_REQUIRED,
} from '@/constants/proposal-index-signing';

export interface ProposalIndex {
  /** Schema version. App refuses to load future-schema indices. */
  version: number;
  /** ISO 8601 timestamp the maintainer wrote into the JSON. Informational
   * only — we don't gate freshness on it (HTTP cache + ETag handle that). */
  updatedAt?: string;
  mainnet: NetworkBlock;
  testnet: NetworkBlock;
}

interface NetworkBlock {
  /** Proposal IDs shown to every user. */
  active: string[];
  /** Proposal IDs shown only when dev mode is on. Used to surface QA
   * scrutins without exposing them to ordinary voters. */
  devOnly: string[];
}

const INDEX_URL =
  'https://referendumcitoyen.github.io/referendum-citoyen-react-native/proposals.json';
const INDEX_SIG_URL = `${INDEX_URL}.sig`;

const CACHE_KEY = 'proposal_index_v1';
const FETCH_TIMEOUT_MS = 5_000;
const SUPPORTED_VERSION = 1;

// Bundled fallback used only when (a) the device is offline AND (b) no
// cached copy has ever been written (first install, no network). Mirrors
// the previously-hardcoded list so nothing regresses for that edge case.
// Keep this in sync with public-data/proposals.json when the production
// list changes; the cache will overwrite it as soon as the device gets
// online.
const BUNDLED_FALLBACK: ProposalIndex = {
  version: SUPPORTED_VERSION,
  mainnet: { active: ['50'], devOnly: ['38', '47', '49'] },
  testnet: { active: [], devOnly: [] },
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validate(parsed: unknown): ProposalIndex | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.version !== 'number' || o.version > SUPPORTED_VERSION) return null;
  const validateBlock = (b: unknown): NetworkBlock | null => {
    if (!b || typeof b !== 'object') return null;
    const x = b as Record<string, unknown>;
    if (!isStringArray(x.active) || !isStringArray(x.devOnly)) return null;
    return { active: x.active, devOnly: x.devOnly };
  };
  const mainnet = validateBlock(o.mainnet);
  const testnet = validateBlock(o.testnet);
  if (!mainnet || !testnet) return null;
  return {
    version: o.version,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : undefined,
    mainnet,
    testnet,
  };
}

async function readCache(): Promise<ProposalIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeCache(text: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, text);
  } catch (e: any) {
    console.log('[proposal-index] cache write failed:', e?.message ?? e);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function utf8ToBytes(s: string): Uint8Array {
  // RN's fetch can't reliably give us the exact bytes of the HTTP body
  // (only the decoded text), but the JSON file is canonical UTF-8 so
  // re-encoding the text matches the bytes the workflow signed.
  return new TextEncoder().encode(s);
}

async function verifySignature(jsonText: string, sigBytes: Uint8Array): Promise<boolean> {
  if (!PROPOSAL_INDEX_VERIFICATION_REQUIRED) {
    // Public key not yet pinned — accept any list and warn. This soft
    // mode lets the feature ship before the maintainer has run
    // `node scripts/generate-proposal-signing-key.mjs`. Flips off
    // automatically the moment a non-zero key is committed.
    console.log('[proposal-index] verification disabled (placeholder public key) — accepting list');
    return true;
  }
  if (sigBytes.length !== 64) {
    console.log(`[proposal-index] signature length ${sigBytes.length} ≠ 64 — rejecting`);
    return false;
  }
  try {
    const pk = hexToBytes(PROPOSAL_INDEX_PUBLIC_KEY_HEX);
    const msg = utf8ToBytes(jsonText);
    return ed25519.verify(sigBytes, msg, pk);
  } catch (e: any) {
    console.log('[proposal-index] verification threw:', e?.message ?? e);
    return false;
  }
}

async function fetchFresh(): Promise<ProposalIndex | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    // Fetch JSON and signature in parallel — they're served from the same
    // CDN and bandwidth is negligible (~few hundred bytes each).
    const [jsonRes, sigRes] = await Promise.all([
      fetch(INDEX_URL, { signal: ctrl.signal }),
      fetch(INDEX_SIG_URL, { signal: ctrl.signal }),
    ]);
    clearTimeout(timer);
    if (!jsonRes.ok) {
      console.log(`[proposal-index] JSON HTTP ${jsonRes.status}`);
      return null;
    }
    const text = await jsonRes.text();

    if (PROPOSAL_INDEX_VERIFICATION_REQUIRED) {
      if (!sigRes.ok) {
        console.log(`[proposal-index] signature HTTP ${sigRes.status} — rejecting (verification required)`);
        return null;
      }
      const sigBuf = new Uint8Array(await sigRes.arrayBuffer());
      const ok = await verifySignature(text, sigBuf);
      if (!ok) {
        console.log('[proposal-index] signature INVALID — rejecting fetched copy');
        return null;
      }
      console.log('[proposal-index] signature OK');
    } else if (sigRes.ok) {
      // Soft mode: signature present but not required — still verify
      // opportunistically so a misconfiguration surfaces in logs.
      const sigBuf = new Uint8Array(await sigRes.arrayBuffer());
      await verifySignature(text, sigBuf);
    }

    const parsed = validate(JSON.parse(text));
    if (!parsed) {
      console.log('[proposal-index] schema invalid — ignoring fetched copy');
      return null;
    }
    await writeCache(text);
    return parsed;
  } catch (e: any) {
    console.log('[proposal-index] fetch failed:', e?.message ?? e);
    return null;
  }
}

/**
 * Resolve the proposal index. Caller decides whether to await or fire-and-
 * cache: typical pattern is to read the cache synchronously (via the
 * `cached` value returned from `readCachedIndex`) for instant render, then
 * await this to overwrite with fresh data when it arrives.
 */
export async function getProposalIndex(): Promise<ProposalIndex> {
  const fresh = await fetchFresh();
  if (fresh) return fresh;
  const cached = await readCache();
  if (cached) return cached;
  return BUNDLED_FALLBACK;
}

/** Synchronous-ish cache read for the home screen's first-paint path —
 * avoids waiting for the network when a cached copy exists. */
export async function readCachedIndex(): Promise<ProposalIndex | null> {
  return readCache();
}

/** Flatten an index to the list of IDs the home screen should display for
 * the current (network, devMode) tuple. */
export function idsForNetwork(
  idx: ProposalIndex,
  network: Network,
  devMode: boolean,
): string[] {
  const block = idx[network];
  return [...block.active, ...(devMode ? block.devOnly : [])];
}
