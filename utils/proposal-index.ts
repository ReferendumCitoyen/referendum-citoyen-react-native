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

/** The two published versions for one platform. */
export interface PlatformVersions {
  android?: string;
  ios?: string;
}

/**
 * A published version table, in either of two shapes.
 *
 * LEGACY, per platform only, which is what every index published before
 * 23/09/2026 carries and what an app older than 2.0.3 understands:
 *
 *     "min_supported_app_versions": { "android": "1.6.0", "ios": "1.6.0" }
 *
 * PER FLAVOUR, because the same code ships as two apps on two version lines:
 * the store app in 2.0.x and the beta in 1.6.x (app.config.ts, and
 * constants/app-flavour.ts for how a binary knows which it is):
 *
 *     "min_supported_app_versions": {
 *       "beta":       { "android": "1.6.0", "ios": "1.6.0" },
 *       "production": { "android": "2.0.2", "ios": "2.0.2" }
 *     }
 *
 * WHY, and it is the whole point of the second shape. With one value against
 * two version lines, raising the minimum to 2.0.2 so that store users update
 * takes the vote away from every beta tester in the same minute: 1.6.0 is
 * below 2.0.2 by any comparison. The trap is not in the code, it is in the
 * first edit of the published file.
 *
 * THE RULE between the two shapes: as soon as the block names a flavour, the
 * legacy keys of that same block are IGNORED. A flavour that is not named
 * then has no threshold at all, so it is never blocked. The failure mode of
 * a half-filled table is therefore "nobody is blocked", never "the wrong
 * people are blocked". Both shapes keep `version: 1`; an app that predates
 * flavours reads the legacy keys and finds nothing in a flavour-only table,
 * which is the same safe direction.
 */
export interface AppVersionTable extends PlatformVersions {
  beta?: PlatformVersions;
  production?: PlatformVersions;
}

export interface ProposalIndex {
  /** Schema version. App refuses to load future-schema indices. */
  version: number;
  /** ISO 8601 timestamp the maintainer wrote into the JSON. Informational
   * only — we don't gate freshness on it (HTTP cache + ETag handle that). */
  updatedAt?: string;
  /** Optional minimum app version. When the installed native version is
   * older, the home screen shows the red banner and voting is disabled
   * (utils/update-notice.ts). OPTIONAL on purpose, and the schema `version`
   * stays 1: bumping it would make already-shipped apps reject the whole
   * index (version > SUPPORTED_VERSION → bundled fallback) — exactly the
   * installs the notice needs to reach. See AppVersionTable for the two
   * shapes this block accepts. */
  min_supported_app_versions?: AppVersionTable;
  /** Optional recommended version (item 9, R10): below it the home shows a
   * green, dismissible "new version available" banner; below
   * `min_supported_app_versions` a red one, and voting is disabled. Same
   * compatibility rule as above: the schema stays `version: 1`, older apps
   * ignore the field. */
  recommended_app_versions?: AppVersionTable;
  mainnet: NetworkBlock;
  testnet: NetworkBlock;
}

interface NetworkBlock {
  /** Proposal IDs shown to every user. */
  active: string[];
  /** Proposal IDs shown only when dev mode is on. Used to surface QA
   * scrutins without exposing them to ordinary voters. */
  devOnly: string[];
  /** The same question created once per voting contract, passport id →
   * ID-card id. The home list folds each pair into one entry
   * (utils/proposal-pairing.ts), so a pair is declared here — publish and
   * sign, no app release. Optional, and the schema `version` stays 1 for
   * the reason given above: older apps just ignore the field. */
  twins?: Record<string, string>;
  /** Questions shown as finished whatever the chain says — their final
   * counts, no vote button, and "Signer la pétition" to the site instead.
   * The June scrutins stay open on chain until October; the team closed
   * them on the 15th when the main question opened. Optional, see above. */
  closed?: string[];
  /** Proposal id → page under referendumcitoyen.fr/referendums/, for the
   * questions whose page is not named after their id. "En savoir plus" and
   * "Signer la pétition" open `referendums/<page>?src=app` instead of
   * `referendums/<id>`. A slug only — never a full URL, so a signed index
   * can send nobody off the site. Optional, see above. */
  pages?: Record<string, string>;
}

const INDEX_URL =
  'https://referendumcitoyen.github.io/referendum-citoyen-react-native/proposals.json';
const INDEX_SIG_URL = `${INDEX_URL}.sig`;

// v2 since verification became mandatory (2026-09-14): a copy cached by
// 1.2.x was accepted unsigned and still names the June scrutins as open.
// Reading it back on the first launch after the update would show them as
// votable until the signed list arrives. A fresh key means the fallback is
// the bundled launch file instead.
const CACHE_KEY = 'proposal_index_v2';
const LEGACY_CACHE_KEY = 'proposal_index_v1';
const FETCH_TIMEOUT_MS = 5_000;
const SUPPORTED_VERSION = 1;

// Bundled copy of the published file, read at build time so it cannot
// drift from what the workflow signs. Used when the device is offline with
// no cached copy (first install, no network) — and whenever the copy on
// Pages, or in the cache, is OLDER than this one: a store release ships
// with the list it was built from, and Pages may still serve last season's
// file for a while (see isOlderThanBundled). Validated like a download, with
// a last-resort empty list should the file ever fail its own schema.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BUNDLED_FALLBACK: ProposalIndex = validate(require('@/public-data/proposals.json')) ?? {
  version: SUPPORTED_VERSION,
  mainnet: { active: [], devOnly: [] },
  testnet: { active: [], devOnly: [] },
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** `{ "68": "69" }` — decimal ids on both sides, nothing else. */
function isIdMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(
    ([k, val]) => /^\d+$/.test(k) && typeof val === 'string' && /^\d+$/.test(val),
  );
}

/** `{ "72": "plan-marianne" }` — decimal id → one path segment of the site. */
function isPageMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(
    ([k, val]) => /^\d+$/.test(k) && typeof val === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(val),
  );
}

function validate(parsed: unknown): ProposalIndex | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.version !== 'number' || o.version > SUPPORTED_VERSION) return null;
  const validateBlock = (b: unknown): NetworkBlock | null => {
    if (!b || typeof b !== 'object') return null;
    const x = b as Record<string, unknown>;
    if (!isStringArray(x.active) || !isStringArray(x.devOnly)) return null;
    // A malformed twins table, closed list or page map drops that field,
    // never the list.
    const twins = isIdMap(x.twins) ? x.twins : undefined;
    const closed = isStringArray(x.closed) ? x.closed : undefined;
    const pages = isPageMap(x.pages) ? x.pages : undefined;
    return {
      active: x.active,
      devOnly: x.devOnly,
      ...(twins ? { twins } : {}),
      ...(closed ? { closed } : {}),
      ...(pages ? { pages } : {}),
    };
  };
  const mainnet = validateBlock(o.mainnet);
  const testnet = validateBlock(o.testnet);
  if (!mainnet || !testnet) return null;
  // Optional + lenient: a malformed block degrades to "no update notice",
  // never to rejecting the proposal list.
  const version = (x: unknown) => (typeof x === 'string' && /^\d+(\.\d+){0,3}$/.test(x) ? x : undefined);
  const platformVersions = (v: unknown): PlatformVersions | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const m = v as Record<string, unknown>;
    return { android: version(m.android), ios: version(m.ios) };
  };
  /** Legacy keys plus, when present, one sub-table per flavour. A malformed
   * flavour entry drops that flavour, which leaves it unthresholded, i.e.
   * never blocked — the safe direction. */
  const versionTable = (v: unknown): AppVersionTable | undefined => {
    const legacy = platformVersions(v);
    if (!legacy) return undefined;
    const m = v as Record<string, unknown>;
    const beta = platformVersions(m.beta);
    const production = platformVersions(m.production);
    return {
      ...legacy,
      ...(beta ? { beta } : {}),
      ...(production ? { production } : {}),
    };
  };
  const minVersions = versionTable(o.min_supported_app_versions);
  const recommendedVersions = versionTable(o.recommended_app_versions);
  return {
    version: o.version,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : undefined,
    min_supported_app_versions: minVersions,
    ...(recommendedVersions ? { recommended_app_versions: recommendedVersions } : {}),
    mainnet,
    testnet,
  };
}

/**
 * A list older than the one built into this app is stale, not authoritative.
 * The app trusts a signed download over its bundled copy, which is right
 * while the download is the newer of the two — and wrong the other way: the
 * 2.0 store release was built with the launch list while Pages still served
 * June's, and a fresh install would have shown the June scrutins as open
 * and no main question until someone pushed. So `updatedAt` decides: a list
 * dated before the bundled one, or not dated at all, is ignored in favour
 * of the bundled copy. Editing public-data/proposals.json therefore means
 * bumping `updatedAt` too — the README says so.
 */
export function isOlderThanBundled(idx: ProposalIndex, bundled: ProposalIndex = BUNDLED_FALLBACK): boolean {
  const ref = Date.parse(bundled.updatedAt ?? '');
  if (Number.isNaN(ref)) return false;
  const t = Date.parse(idx.updatedAt ?? '');
  return Number.isNaN(t) || t < ref;
}

function newerThanBundledOrNull(idx: ProposalIndex | null, source: string): ProposalIndex | null {
  if (!idx) return null;
  if (isOlderThanBundled(idx)) {
    console.log(
      `[proposal-index] ${source} list (${idx.updatedAt ?? 'undated'}) is older than the bundled one (${BUNDLED_FALLBACK.updatedAt}) — using bundled`,
    );
    return null;
  }
  return idx;
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
    AsyncStorage.removeItem(LEGACY_CACHE_KEY).catch(() => {});
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
    // Not cached either: a stale download must not replace a newer cache.
    if (!newerThanBundledOrNull(parsed, 'published')) return null;
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
  const cached = newerThanBundledOrNull(await readCache(), 'cached');
  if (cached) return cached;
  return BUNDLED_FALLBACK;
}

/** Synchronous-ish cache read for the home screen's first-paint path —
 * avoids waiting for the network when a cached copy exists. A cache older
 * than the bundled list (left by a previous build) paints the bundled one. */
export async function readCachedIndex(): Promise<ProposalIndex | null> {
  const cached = await readCache();
  if (!cached) return null;
  return newerThanBundledOrNull(cached, 'cached') ?? BUNDLED_FALLBACK;
}

/** The list built into this binary. Local, never fetched: the fallback of
 * every eligibility check that must not wait on the network. */
export function bundledProposalIndex(): ProposalIndex {
  return BUNDLED_FALLBACK;
}

/** The trusted index as this phone already holds it: the signed copy cached
 * by the last successful download, or the bundled list. Never a request. */
export async function readLocalProposalIndex(): Promise<ProposalIndex> {
  return (await readCachedIndex()) ?? BUNDLED_FALLBACK;
}

/** Flatten an index to the list of IDs the home screen should display for
 * the current (network, devMode) tuple. */
/** Exposed for tests; the app goes through getProposalIndex/readCachedIndex. */
export const parseProposalIndex = validate;

/** Declared twin pairs for a network, passport id → ID-card id. */
export function twinsForNetwork(idx: ProposalIndex, network: Network): Record<string, string> {
  return idx[network].twins ?? {};
}

export function idsForNetwork(
  idx: ProposalIndex,
  network: Network,
  devMode: boolean,
): string[] {
  const block = idx[network];
  // A twinned question is listed by its passport id; its ID-card id has to
  // be fetched too, or nothing pairs, the card side is never summed, and a
  // card holder is sent to the passport contract. Only the twins of ids in
  // the list — a stray table entry must not surface a hidden scrutin.
  const listed = [...block.active, ...(block.closed ?? []), ...(devMode ? block.devOnly : [])];
  const twins = block.twins ?? {};
  const cardIds = listed.map((id) => twins[id]).filter((id): id is string => typeof id === 'string');
  return [...new Set([...listed, ...cardIds])];
}

/** Ids the index declares finished, as a set for the list to consult. */
export function closedForNetwork(idx: ProposalIndex, network: Network): Set<string> {
  return new Set(idx[network].closed ?? []);
}

/** Site pages for a network, proposal id → slug under /referendums/. */
export function pagesForNetwork(idx: ProposalIndex, network: Network): Record<string, string> {
  return idx[network].pages ?? {};
}
