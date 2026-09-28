import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet, FlatList, View, Text, TouchableOpacity, ActivityIndicator, RefreshControl, Linking, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { referendumInfoUrl } from '@/constants/urls';
import { appVersionLabel, appBuildLabel } from '@/utils/app-version';
import { Svg, Path } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import { useRouter, useFocusEffect } from 'expo-router';
import { getFreedomToolConfig } from '@/constants/rarime-config';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { formatCount } from '@/utils/format-count';
import { boundedProposalFetch } from '@/utils/proposal-load-bound';
import { useDevMode } from '@/contexts/DevModeContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useExtraProposals } from '@/contexts/ExtraProposalsContext';
import SettingsButton from '@/components/SettingsButton';
import { preloadCircuits, subscribeCircuitPreload, type PreloadProgress } from '@/utils/circuit-preload';
import {
  readCachedProposals,
  writeCachedProposals,
  migrateLegacyCache,
  bigintReplacer,
} from '@/utils/proposal-cache';
import {
  getProposalIndex,
  readCachedIndex,
  idsForNetwork,
  twinsForNetwork,
  closedForNetwork,
  pagesForNetwork,
  type ProposalIndex,
} from '@/utils/proposal-index';
import { petitionUrl } from '@/constants/urls';
import { isBetaBuild } from '@/constants/app-flavour';
import WhatsNewBanner from '@/components/WhatsNewBanner';
import { TWIN_PROPOSALS } from '@/constants/twin-proposals';
import {
  computeVoteResults,
  decodeCitizenship,
  isFrenchCompatible,
  isPassportVotingTarget,
  acceptsBothDocuments,
} from '@/utils/voteResults';
import { pairProposals, type WithTwin } from '@/utils/proposal-pairing';
import { entryEligibility, localEligibilityContext, refusalMessageKey } from '@/utils/vote-eligibility';
import { CARD_ONLY_LAUNCH } from '@/constants/card-only-launch';
import { discoverProposalsFromChain } from '@/constants/test-proposal-visibility';
import {
  installedApp,
  publishedVersionsFor,
  RECOMMENDED_NOTICE_DISMISSED_KEY,
  resolveAppBanner,
  STORE_URLS,
} from '@/utils/update-notice';
import UpdateNoticeBanner from '@/components/UpdateNoticeBanner';
import { runNoirProbeOnce, useUnsupportedPhone } from '@/utils/device-support';
import { consumePendingVote } from '@/utils/post-vote-refresh';
import i18nModule from 'i18next';

const VOTE_COUNT_THRESHOLD = 5;

const CaretRightIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M9 6L15 12L9 18"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Self-subscribing preload banner. Lives outside the header's useCallback so
// its progress updates don't force renderHeader to recompute (which would
// remount ActivityIndicator and restart the spinner on every progress tick).
const PreloadBanner = React.memo(function PreloadBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const [status, setStatus] = useState<PreloadProgress>({
    stage: 'idle',
    stagePercent: 0,
    overallPercent: 0,
  });
  useEffect(() => subscribeCircuitPreload(setStatus), []);

  const active =
    status.stage === 'checking' ||
    status.stage === 'trusted-setup' ||
    status.stage === 'bytecode';
  if (!active) return null;

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginVertical: 8,
      borderRadius: 4,
      gap: 8,
    }}>
      <ActivityIndicator size="small" color={colors.secondary} />
      <Text style={{
        flex: 1,
        fontFamily: Typography.fontFamily.medium,
        fontSize: 12,
        color: colors.text,
      }}>
        {t('home.preparingVotingData', { percent: Math.round(status.overallPercent * 100) })}
      </Text>
    </View>
  );
});

// --- Helpers ---

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const TextWithLinks = ({ text, style, linkColor }: { text: string; style: any; linkColor: string }) => {
  const parts = text.split(URL_REGEX);
  const textParts: string[] = [];
  const links: string[] = [];
  for (const part of parts) {
    if (URL_REGEX.test(part)) {
      links.push(part);
    } else if (part) {
      textParts.push(part);
    }
  }
  return (
    <View>
      {textParts.length > 0 && (
        <Text style={style}>{textParts.join('').trim()}</Text>
      )}
      {links.map((url, i) => (
        <Text
          key={i}
          style={[style, { color: linkColor, textDecorationLine: 'underline', marginTop: 4 }]}
          onPress={() => Linking.openURL(url)}
          numberOfLines={1}
        >
          {url}
        </Text>
      ))}
    </View>
  );
};

const isActive = (p: ProposalInfo): boolean => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now >= p.startTimestamp && now <= p.startTimestamp + p.duration;
};

/** Created but not open yet — the main question exists hours before its
 * 00:00 start. Shown with the live ones, marked "Bientôt", no vote button;
 * never under "Terminé". */
const isUpcoming = (p: ProposalInfo): boolean =>
  BigInt(Math.floor(Date.now() / 1000)) < p.startTimestamp;

const formatTimeRemaining = (endTimestamp: bigint): string => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= endTimestamp) {
    return i18nModule.t('home.badgeFinished', { defaultValue: 'Terminé' });
  }
  return new Date(Number(endTimestamp) * 1000).toLocaleDateString(i18nModule.language || 'fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

const formatTimeAgo = (timestamp: bigint): string => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < timestamp) {
    return i18nModule.t('home.badgeSoon', { defaultValue: 'Bientôt' });
  }
  const localDate = new Date(Number(timestamp) * 1000);
  return localDate.toLocaleDateString(i18nModule.language || 'fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// --- VoteResults component (dynamic variants) ---

interface VoteResultsProps {
  variants: string[];
  percents: number[];
  counts: number[];
  belowThreshold: boolean;
}

const VoteResults = ({ variants, percents, counts, belowThreshold }: VoteResultsProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  // Blue, Red, neutral, warning, success — cycles for additional variants
  const barColors = colors.chartPalette;
  const { t } = useTranslation();
  const maxHeight = 64;
  const minHeight = 2;
  const total = counts.reduce((s, c) => s + c, 0);
  const hasVotes = total > 0 && !belowThreshold;
  const many = variants.length > 3;
  const labelSize = many ? 9 : Typography.fontSize.voteCount;
  const percentSize = many ? 9 : Typography.fontSize.voteCount;

  // Long-pressing a bar removes the truncation on its label so the user can
  // read the full option text inline (toggleable).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const calculateHeight = (percent: number) => {
    if (percent === 0) return minHeight;
    return Math.max(minHeight, (percent / 100) * maxHeight);
  };

  return (
    <View style={styles.resultsContainer}>
      <View style={styles.barsContainer}>
        {variants.map((_, idx) => (
          <Pressable
            key={idx}
            style={styles.barWrapper}
            onPress={() => toggleExpanded(idx)}
          >
            {hasVotes && (
              <Text style={[styles.barPercent, many && { fontSize: percentSize }]}>{(percents[idx] ?? 0).toFixed(1)}%</Text>
            )}
            <View style={[
              styles.bar,
              {
                height: hasVotes ? calculateHeight(percents[idx] ?? 0) : 24,
                backgroundColor: barColors[idx % barColors.length],
              },
            ]} />
          </Pressable>
        ))}
      </View>
      <View style={styles.labelsContainer}>
        {variants.map((v, idx) => (
          <Text
            key={idx}
            style={[styles.barLabel, many && { fontSize: labelSize, lineHeight: labelSize * 1.3 }]}
            numberOfLines={expanded.has(idx) ? undefined : 3}
          >
            {v}
          </Text>
        ))}
      </View>
      {belowThreshold ? (
        <Text style={[styles.barCount, { textAlign: 'center', width: '100%' }]}>{t('home.countingInProgress')}</Text>
      ) : hasVotes && (
        <View style={styles.countsContainer}>
          {counts.map((c, idx) => (
            <Text key={idx} style={[styles.barCount, many && { fontSize: 9 }]}>{formatCount(c)}</Text>
          ))}
        </View>
      )}
    </View>
  );
};

type PairedProposalInfo = WithTwin<ProposalInfo>;

export default function AccueilScreen() {
  const { t } = useTranslation();
  const { devMode } = useDevMode();
  const colors = useColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const { network } = useNetwork();
  const { extraEnabled, extraIds } = useExtraProposals();
  // Lock down the config for THIS render — capture once so all useCallbacks
  // inside this render share the same network reference. When `network`
  // flips, the whole component re-renders, ftRef is wiped, and the cache is
  // re-read for the new network (see effect below).
  const ftConfig = useMemo(() => getFreedomToolConfig(network), [network]);

  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [proposalIndex, setProposalIndex] = useState<ProposalIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllList, setShowAllList] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const oldestIdRef = useRef<number>(0);
  const ftRef = useRef<any>(null);

  const PAGE_SIZE = 10;

  // One-time legacy-cache wipe — see utils/proposal-cache.ts. Older builds
  // wrote to an unnamespaced key; clean it up so AsyncStorage doesn't keep
  // a stale list around.
  useEffect(() => { migrateLegacyCache(); }, []);

  // Wipe the in-memory FreedomTool ref + visible proposals when the network
  // flips. Without this, the user would see the previous network's proposals
  // until the next refresh — and worse, voting-flow would pick a stale id
  // from cache and submit it to the wrong contract.
  useEffect(() => {
    ftRef.current = null;
    setProposals([]);
    setIsLoading(true);
  }, [network]);

  const getFreedomTool = useCallback(async () => {
    // Always build with the CURRENT ftConfig — caching via ftRef.current
    // raced with the network-flip effect at mount time and left a stale
    // testnet FreedomTool servicing mainnet proposal-id requests, returning
    // testnet's #47 bytes for mainnet's #47 lookup. The instantiation is
    // cheap so we accept the per-call rebuild.
    const { FreedomTool } = await import('@rarimo/rarime-rn-sdk');
    const ft = new FreedomTool(ftConfig);
    ftRef.current = ft;
    return ft;
  }, [ftConfig]);

  const fetchBatch = useCallback(async (startId: number, count: number) => {
    const ft = await getFreedomTool();
    const ids = Array.from({ length: count }, (_, i) => startId - i).filter(id => id >= 1);
    if (ids.length === 0) return [];
    // Bounded (P9): the same rule as the registration and vote POSTs. An
    // unbounded read here is an indefinite spinner, because setIsLoading(false)
    // lives in a finally that waits for every one of these to settle.
    const results = await Promise.allSettled(
      ids.map(id => boundedProposalFetch(() => ft.getProposalInfo(String(id)), String(id)))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<ProposalInfo> => r.status === 'fulfilled')
      .map(r => r.value);
  }, [getFreedomTool]);

  // Allow-list of proposal IDs to display on the home screen. Source of
  // truth is public-data/proposals.json in this repo, published to GitHub
  // Pages via .github/workflows/publish-proposal-index.yml. The app
  // fetches it on mount (utils/proposal-index.ts) so the list can change
  // without a code release. While `proposalIndex` is still null on first
  // paint, fall back to the bundled defaults inside proposal-index.ts —
  // see BUNDLED_FALLBACK there — so cold-start with no network still
  // surfaces the production scrutin.
  // Extras (the editable list in ExtraProposalsContext) are concatenated
  // when the dev toggle is on — used to keep older verified scrutins
  // reachable for QA without exposing them to regular users.
  // Beta, dev mode only: ask the chain what exists, on top of the index.
  // Fire-and-forget — a failure leaves the index-derived list exactly as it
  // was, which is the production behaviour. Outside dev mode the beta shows
  // what the index shows, so a tester sees the store list by default and the
  // test scrutins only once dev mode is on.
  const [discoveredIds, setDiscoveredIds] = useState<string[]>([]);
  // Voting contracts per discovered id — the only way to tell a proposal
  // both documents can vote (both contracts on one id) from a card-only one,
  // since the SDK's ProposalInfo carries entry [0] alone.
  const [contractsById, setContractsById] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (network !== 'mainnet' || !devMode || !discoverProposalsFromChain()) {
      setDiscoveredIds([]);
      setContractsById({});
      return;
    }
    let cancelled = false;
    import('@/utils/proposal-discovery')
      .then((m) =>
        m.discoverMainnetProposalIds().then((ids) => ({
          ids,
          contracts: Object.fromEntries(ids.map((id) => [id, m.votingContractsOf(id) ?? []])),
        })),
      )
      .then(({ ids, contracts }) => {
        if (cancelled) return;
        setDiscoveredIds(ids);
        setContractsById(contracts);
      })
      .catch((e: any) =>
        console.warn('[proposal-discovery] walk failed:', e?.message ?? String(e)),
      );
    return () => { cancelled = true; };
  }, [network, devMode]);

  const effectiveIds = useMemo(() => {
    // `devMode` cannot be true on a store build (DevModeContext), but the
    // #47/#48 incident was exactly a beta-only switch whose persisted STATE
    // reached a store install by another route — so the flavour is re-checked
    // at every point that widens the list rather than trusted once upstream.
    // Same belt-and-braces as discoverProposalsFromChain() below.
    const indexIds = proposalIndex
      ? idsForNetwork(proposalIndex, network, devMode && isBetaBuild())
      : [];
    // BETA, dev mode: everything that exists on chain from the floor upward,
    // found by walking ProposalsState, so a new test scrutin needs no index
    // edit — see discoverProposalsFromChain. Empty otherwise and until the
    // walk returns, so the index decides the first paint either way.
    const merged = [
      ...indexIds,
      ...discoveredIds,
      ...(extraEnabled ? extraIds : []),
    ];
    return Array.from(new Set(merged));
  }, [proposalIndex, network, devMode, extraEnabled, extraIds, discoveredIds]);

  // Hydrate the proposal index from cache for instant render, then fetch
  // fresh in the background. Both updates flow through setProposalIndex so
  // the existing fetchProposals effect re-runs against the new ID list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readCachedIndex();
      if (!cancelled && cached) setProposalIndex(cached);
      const fresh = await getProposalIndex();
      if (!cancelled) setProposalIndex(fresh);
    })();
    return () => { cancelled = true; };
  }, []);

  // App-version banner (item 9, R10), driven by the optional
  // `recommended_app_versions` / `min_supported_app_versions` blocks of the
  // (signed) proposal index — piggybacks on the fetch above, no request to the
  // stores. Green and dismissible (per recommended version) below the
  // recommended one; red, not dismissible, and voting disabled below the
  // minimum (the Vote buttons follow localEligibilityContext); the
  // unsupported-phone banner wins over both (item 4b): its state is the
  // prover probe run below, before the circuit preload (utils/device-support.ts).
  const deviceUnsupported = useUnsupportedPhone();
  const [dismissedRecommended, setDismissedRecommended] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(RECOMMENDED_NOTICE_DISMISSED_KEY)
      .catch(() => null)
      .then((v) => {
        if (!cancelled) setDismissedRecommended(v ?? null);
      });
    return () => { cancelled = true; };
  }, []);
  const appBanner = useMemo(() => {
    const app = installedApp();
    // Own platform AND own flavour: the store app and the beta run on two
    // version lines, so the store threshold must never reach a beta build.
    const { min, recommended } = publishedVersionsFor(proposalIndex, app.platform, app.flavour);
    return resolveAppBanner({
      current: app.current,
      min,
      recommended,
      dismissedRecommended,
      deviceUnsupported,
    });
  }, [proposalIndex, dismissedRecommended, deviceUnsupported]);
  const dismissUpdateNotice = useCallback(() => {
    if (appBanner?.kind !== 'recommended') return;
    AsyncStorage.setItem(RECOMMENDED_NOTICE_DISMISSED_KEY, appBanner.version).catch(() => {});
    setDismissedRecommended(appBanner.version);
  }, [appBanner]);
  const openStorePage = useCallback(() => {
    Linking.openURL(STORE_URLS[installedApp().platform]).catch(() => {});
  }, []);

  const fetchProposals = useCallback(async (refresh = false) => {
    // Wait for the proposal index (the vote LIST) to resolve before doing
    // anything. Until then `effectiveIds` is empty, so turning off the
    // spinner or concluding "no votes" would be wrong — this was the startup
    // flash where "Aucune proposition" showed while the list was still
    // loading. proposalIndex is set by the index effect below (cache-first,
    // then fresh) and ALWAYS resolves (getProposalIndex falls back to a
    // bundled list), so the spinner can't deadlock here.
    if (!proposalIndex) return;
    try {
      if (!refresh) {
        const parsed = await readCachedProposals(network);
        if (parsed) {
          // Filter the cache to the same allowlist so we don't briefly
          // show old proposals (e.g. #48) while the network call is in
          // flight.
          const filtered = parsed.filter(p => effectiveIds.includes(String(p.id)));
          setProposals(filtered);
          // Only stop the spinner if the cache actually has something to
          // show; an empty/stale cache must keep loading until the network
          // fetch returns, otherwise it flashes "no votes".
          if (filtered.length > 0) setIsLoading(false);
        }
      }

      if (refresh) setIsRefreshing(true);
      setLoadError(null);

      const ft = await getFreedomTool();
      // Bounded (P9): see utils/proposal-load-bound.ts. This is the call the
      // `[Accueil] Failed to load proposals: TypeError: Network request failed`
      // line came from, in the same sessions as the P9 reports, and it was the
      // one path the bound was never applied to.
      const results = await Promise.allSettled(
        effectiveIds.map(id => boundedProposalFetch(() => ft.getProposalInfo(id), id))
      );
      const loaded = results
        .filter((r): r is PromiseFulfilledResult<ProposalInfo> => r.status === 'fulfilled')
        .map(r => r.value);

      // Distinguish "the list is genuinely empty" from "every detail call
      // failed". Promise.allSettled swallows rejections, so without this an
      // RPC outage would render as "no votes available" instead of an error.
      // (Partial success still renders what we got — we only error on a total
      // wipe, and we don't overwrite an existing list with [] in that case.)
      if (loaded.length === 0 && effectiveIds.length > 0) {
        const firstRejected = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        throw firstRejected?.reason ?? new Error('all proposal detail fetches failed');
      }
      const sorted = loaded.sort((a, b) => Number(b.id) - Number(a.id));

      console.log(`[Accueil][${network}] Loaded ${sorted.length}/${effectiveIds.length} proposals (extras=${extraEnabled}): [${effectiveIds.join(', ')}]`);
      setProposals(sorted);
      oldestIdRef.current = 0;
      setHasMore(false);

      await writeCachedProposals(network, sorted);

      // -----------------------------------------------------------------
      // Original full-scan code — preserved (commented out) so we can flip
      // back to "show every proposal on the contract" without rewriting.
      // To restore: delete the hardcoded block above and uncomment the
      // block below (and the `PAGE_SIZE` / `fetchBatch` paths it uses).
      // -----------------------------------------------------------------
      //
      // const { JsonRpcProvider, Contract } = await import('ethers');
      // const provider = new JsonRpcProvider(ftConfig.api.votingRpcUrl);
      // const contract = new Contract(
      //   ftConfig.contracts.proposalStateAddress,
      //   ['function lastProposalId() view returns (uint256)'],
      //   provider
      // );
      // const lastId = Number(await contract.lastProposalId());
      // console.log(`[Accueil][${network}] lastProposalId: ${lastId}`);
      //
      // const loaded = await fetchBatch(lastId, PAGE_SIZE);
      // const sorted = loaded.sort((a, b) => Number(b.id) - Number(a.id));
      //
      // console.log(`[Accueil][${network}] Fetched ${sorted.length} proposals from network`);
      // setProposals(sorted);
      // oldestIdRef.current = sorted.length > 0 ? Math.min(...sorted.map(p => Number(p.id))) : 0;
      // setHasMore(oldestIdRef.current > 1);
      //
      // await writeCachedProposals(network, sorted);
    } catch (err) {
      console.error('[Accueil] Failed to load proposals:', err);
      const msg = (err as Error).message?.toLowerCase() || '';
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
        setLoadError(t('home.loadErrorNetwork'));
      } else {
        setLoadError(t('home.loadErrorGeneric'));
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
    // Re-fetch when the effective ID list changes: devMode flips, the
    // extras toggle flips, the user edits the extras list in Settings, the
    // proposal index updates, or the chain walk returns. `effectiveIds` is
    // the one value that moves in every one of those cases, and it has to
    // be a dependency in its own right: until 2026-09-15 this listed the
    // inputs it is computed from except `discoveredIds`, so a scrutin found
    // on chain after dev mode was switched on was never fetched — the walk
    // finishes after the fetch that dev mode triggered, and nothing ran
    // again. The index's devOnly list hid that for as long as every test
    // scrutin was also in the index.
  }, [getFreedomTool, network, ftConfig, proposalIndex, effectiveIds, extraEnabled]);

  const fetchMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || oldestIdRef.current <= 1) return;
    setIsLoadingMore(true);
    try {
      const nextStart = oldestIdRef.current - 1;
      console.log(`[Accueil] Loading more from ID ${nextStart}...`);
      const loaded = await fetchBatch(nextStart, PAGE_SIZE);
      if (loaded.length === 0) {
        setHasMore(false);
      } else {
        const sorted = loaded.sort((a, b) => Number(b.id) - Number(a.id));
        setProposals(prev => [...prev, ...sorted]);
        oldestIdRef.current = Math.min(...sorted.map(p => Number(p.id)));
        setHasMore(oldestIdRef.current > 1);
        console.log(`[Accueil] Loaded ${sorted.length} more, oldest now: ${oldestIdRef.current}`);
      }
    } catch (err) {
      console.error('[Accueil] Failed to load more:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, fetchBatch]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  // Pre-download Noir circuits (~150–300 MB trusted setup + query circuit
  // bytecode) so Step 11 doesn't have to do it during vote submission.
  // On Android the in-flow download often aborts mid-stream; doing it here
  // lets the user browse proposals while it completes. Progress is surfaced
  // via the <PreloadBanner /> child component, which subscribes on its own.
  //
  // Item 4b (2.0.2): ask the prover probe first. A phone whose install lacks
  // the Noir library (32-bit Android) cannot use these files, so it skips the
  // 300 MB download and gets the unsupported-phone banner instead. No probe
  // (iOS, older binary) or any other answer preloads as before.
  useEffect(() => {
    let cancelled = false;
    runNoirProbeOnce().then((status) => {
      if (cancelled) return;
      if (status === 'missing') {
        console.log('[Accueil] prover library missing on this phone: circuit preload skipped');
        return;
      }
      console.log('[Accueil] mounted — triggering circuit preload');
      preloadCircuits().catch((err) => {
        console.warn('[Accueil] Circuit preload failed (will retry at vote time):', err?.message);
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh when screen regains focus (e.g. after voting). Also fires
  // an extra refresh ~4 s later when the user just voted, because the
  // immediate refetch usually races ahead of the vote tx's L2 confirmation
  // and the count would otherwise show pre-vote until the next manual pull.
  const isFirstMount = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstMount.current) {
        isFirstMount.current = false;
        return;
      }
      fetchProposals(true);
      if (consumePendingVote()) {
        const t = setTimeout(() => fetchProposals(true), 4000);
        return () => clearTimeout(t);
      }
    }, [fetchProposals])
  );

  const onRefresh = useCallback(async () => {
    // Pull-to-refresh refreshes BOTH the vote list (proposal index) and the
    // per-vote details/counts — so a newly-published proposal appears without
    // an app restart, not just an updated count on the existing list. The
    // index update flows through setProposalIndex → the fetch effect re-runs
    // with the new id list; the awaited fetchProposals(true) refreshes the
    // current list's details and drives the pull spinner.
    setIsRefreshing(true);
    try {
      const fresh = await getProposalIndex();
      // Only push a new index object when the list actually changed, so the
      // common "list unchanged" pull doesn't trigger a redundant second
      // fetch via the index effect. Same content → same reference → React
      // bails out and only the awaited fetchProposals(true) below runs.
      setProposalIndex((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh,
      );
    } catch {
      // getProposalIndex degrades to cache/bundled internally — ignore.
    }
    await fetchProposals(true);
  }, [fetchProposals]);

  const handleVoterPress = (p: PairedProposalInfo) => {
    // Document type (ID card vs passport) is no longer inferred from the
    // proposal here — voting-flow.tsx's DocumentChoice screen always asks
    // the user directly (see its comment for why this differs from how the
    // prime app would eventually work). A twinned question hands over both
    // ids; the flow votes the one the chosen document can.
    router.push({
      pathname: '/voting-flow',
      params: p.twin
        ? { proposalId: p.twin.passportId, cardProposalId: p.twin.cardId }
        : { proposalId: String(p.id) },
    });
  };

  // Hide proposals whose citizenshipWhitelist excludes FRA (per 2026-04-23
  // recap: only show votes a French ID card can actually be used on).
  // Dev mode bypasses the filter so we can see every proposal during testing.
  //
  // The previous build also filtered Mainnet proposals to only those targeting
  // the BioPassportVoting contract (`isPassportVotingTarget`). That filter
  // has been removed now that the voting flow targets TD1 (French ID card)
  // instead of TD3 (passport) — see Step5/Step6. ID-card-targeted proposals
  // route to the IDCardVoting deployment.
  //
  // TD1 (CNIe) voting works on BOTH networks: Step11 routes every vote that
  // is NOT (TD3 passport + Mainnet) through `FreedomTool.submitProposal`,
  // which auto-routes to the IDCardVoting contract per the proposal's
  // `sendVoteContractAddress` (Step11.tsx — `usesGroth16MainnetPath` gates the
  // Groth16 path on `network === 'mainnet' && dg1.length === 93`).
  // The Groth16 `castMainnetVote` pipeline
  // (`utils/mainnet-vote-flow.ts` + `utils/vote-calldata.ts`) is TD3-only and
  // is never reached for a CNIe vote, so it cannot mis-route one.
  // A question that exists twice on chain — once per voting contract, until
  // one id can carry both — shows once, with the counts added up
  // (utils/proposal-pairing.ts). The cache keeps the raw list, so the vote
  // flow can still load the card twin by its own id.
  // Pairs come from the signed index first (`twins` — publish and sign, no
  // release), then the table shipped in the app; the index wins on a clash.
  const twinTable = useMemo(
    () => ({ ...TWIN_PROPOSALS, ...(proposalIndex ? twinsForNetwork(proposalIndex, network) : {}) }),
    [proposalIndex, network],
  );
  // Questions the index has closed: finished in the list whatever the chain
  // says, with "Signer la pétition" in place of the vote button.
  const closedIds = useMemo(
    () => (proposalIndex ? closedForNetwork(proposalIndex, network) : new Set<string>()),
    [proposalIndex, network],
  );
  // The site page behind "En savoir plus" / "Signer la pétition": the slug
  // the index names for the entry (either twin's id), else the id itself.
  const pageSlugs = useMemo(
    () => (proposalIndex ? pagesForNetwork(proposalIndex, network) : {}),
    [proposalIndex, network],
  );
  const sitePage = useCallback(
    (p: PairedProposalInfo): string =>
      pageSlugs[String(p.id)] ?? (p.twin ? pageSlugs[p.twin.cardId] : undefined) ?? String(p.id),
    [pageSlugs],
  );
  const isLive = useCallback(
    (p: ProposalInfo) => isActive(p) && !closedIds.has(String(p.id)),
    [closedIds],
  );
  const pairedProposals = useMemo(() => {
    const paired = pairProposals(proposals, twinTable);
    // In the log window every report carries, so a tester's mail says which
    // two ids the entry they voted stood for.
    for (const p of paired) {
      if (p.twin) {
        console.log(
          `[proposal-pairing] #${p.twin.passportId} (passeport) + #${p.twin.cardId} (carte) → one entry, counts summed`,
        );
      }
    }
    return paired;
  }, [proposals, twinTable]);
  const eligibleProposals = useMemo(
    () => {
      if (devMode) return pairedProposals;
      return pairedProposals.filter(isFrenchCompatible);
    },
    [pairedProposals, devMode]
  );
  // The Vote button follows the one eligibility rule the flow, the post-vote
  // card and the proof also apply (utils/vote-eligibility.ts): an entry is
  // votable when a document the voter can choose may vote its member. The
  // index here is the one this screen already holds (signed download, cache or
  // bundled list); nothing is fetched for it.
  const voteVerdictFor = useCallback(
    (p: PairedProposalInfo) => {
      if (!proposalIndex) return { ok: false as const, reason: 'not-listed' as const };
      const documents = CARD_ONLY_LAUNCH ? (['idCard'] as const) : (['idCard', 'passport'] as const);
      return entryEligibility(
        { id: String(p.id), twin: p.twin },
        documents,
        (id: string) => proposals.find((x) => String(x.id) === id),
        localEligibilityContext(proposalIndex, network, devMode && isBetaBuild()),
      );
    },
    [proposalIndex, proposals, network, devMode],
  );
  const isLiveOrUpcoming = useCallback(
    (p: ProposalInfo) => isLive(p) || (isUpcoming(p) && !closedIds.has(String(p.id))),
    [isLive, closedIds],
  );
  const activeProposals = useMemo(() => eligibleProposals.filter(isLiveOrUpcoming), [eligibleProposals, isLiveOrUpcoming]);
  const pastProposals = useMemo(() => eligibleProposals.filter(p => !isLiveOrUpcoming(p)), [eligibleProposals, isLiveOrUpcoming]);
  // [DBG] one-line dump per proposal so we can correlate the "I only see
  // closed polls" UX with the actual filter math. Dev-only — the loop
  // fires 5+ lines per focus event per proposal and crowded out actual
  // diagnostics in the 2000-entry ring buffer in production.
  useEffect(() => {
    if (!__DEV__) return;
    if (eligibleProposals.length === 0) return;
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const p of eligibleProposals) {
      const startTs = (p as any).startTimestamp;
      const dur = (p as any).duration;
      const startType = typeof startTs;
      const durType = typeof dur;
      const endTs = startType === 'bigint' && durType === 'bigint' ? (startTs + dur) : 'NaN';
      console.log(`[Accueil][DBG] #${p.id} startTs=${startTs}(${startType}) dur=${dur}(${durType}) endTs=${endTs} now=${now} active=${isActive(p)} title="${String(p.title).slice(0,30)}"`);
    }
    console.log(`[Accueil][DBG] active.length=${activeProposals.length} past.length=${pastProposals.length}`);
  }, [eligibleProposals, activeProposals.length, pastProposals.length]);
  const allProposals = useMemo(() => [...activeProposals, ...pastProposals], [activeProposals, pastProposals]);

  // Tapping a compact row in the "Ongoing Votes" header scrolls down to that
  // proposal's full card below (same screen), rather than pushing into the
  // voting flow.
  const listRef = useRef<FlatList<ProposalInfo>>(null);
  const handleAnchorPress = useCallback((proposalId: string) => {
    const index = allProposals.findIndex(p => p.id === proposalId);
    if (index < 0 || !listRef.current) return;
    try {
      listRef.current.scrollToIndex({ index, animated: true, viewPosition: 0 });
    } catch {}
  }, [allProposals]);

  const renderHeader = useCallback(() => (
    <View style={styles.voteListSection}>
      <View style={styles.voteListHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          {/* flexShrink lets the title wrap rather than push the settings
              button off-screen once Dynamic Type scales it up. */}
          <Text style={[styles.voteListTitle, { flexShrink: 1 }]}>{t('home.ongoingVotes')}</Text>
          {/* The version rides along with the BETA badge so testers always have
              it to hand — bug reports are only actionable against a specific
              build, and the build number is the part that changes between
              TestFlight uploads while the version stays put. */}
          {isBetaBuild() && (
            <View style={styles.betaBadge}>
              <Text style={styles.betaBadgeText} allowFontScaling={false}>
                {`BETA v${appVersionLabel()} (${appBuildLabel()})`}
              </Text>
            </View>
          )}
        </View>
        <SettingsButton />
      </View>

      <WhatsNewBanner />
      {appBanner && (
        <UpdateNoticeBanner banner={appBanner} onDismiss={dismissUpdateNotice} onUpdate={openStorePage} />
      )}

      {isLoading && (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.secondary} />
          <Text style={[styles.voteListItemText, { textAlign: 'center', marginTop: 8 }]}>
            {t('home.loading')}
          </Text>
        </View>
      )}

      {loadError && (
        <Text style={[styles.voteListItemText, { color: colors.errorText, paddingVertical: 12 }]}>
          {loadError}
        </Text>
      )}

      {!isLoading && proposalIndex !== null && activeProposals.length === 0 && !loadError && (
        <Text style={[styles.voteListItemText, { paddingVertical: 12 }]}>
          {t('home.noProposals')}
        </Text>
      )}

      <PreloadBanner />

      {(showAllList ? activeProposals : activeProposals.slice(0, 3)).map((p) => (
        <TouchableOpacity
          key={p.id}
          style={styles.voteListItem}
          activeOpacity={0.7}
          onPress={() => handleAnchorPress(p.id)}
        >
          <Text style={styles.voteListItemText} numberOfLines={2}>{p.title}</Text>
          <CaretRightIcon color={colors.secondary} size={Spacing.icon.size} />
        </TouchableOpacity>
      ))}

      {activeProposals.length > 3 && (
        <TouchableOpacity
          style={styles.voteListItem}
          activeOpacity={0.7}
          onPress={() => setShowAllList(!showAllList)}
        >
          <Text style={[styles.voteListItemText, { color: colors.secondary }]}>
            {showAllList ? t('home.showLess') : t('home.showMore', { count: activeProposals.length - 3 })}
          </Text>
          <CaretRightIcon color={colors.secondary} size={Spacing.icon.size} />
        </TouchableOpacity>
      )}
    </View>
  ), [activeProposals, showAllList, isLoading, loadError, proposalIndex, colors, styles, handleAnchorPress, t, appBanner, dismissUpdateNotice, openStorePage]);

  const renderItem = useCallback(({ item: p, index }: { item: PairedProposalInfo; index: number }) => {
    const active = isLive(p);
    const closedByIndex = closedIds.has(String(p.id));
    const upcoming = !closedByIndex && isUpcoming(p);
    const variants = p.questions[0]?.variants ?? [];
    // Multi-question proposals require N answers; our UI + vote calldata
    // only support N=1. The on-chain BioPassportVoting / IDCardVoting
    // contracts reject `vote_.length !== questions.length` with
    // "wrong number of votes". Disable voting for these and surface why.
    const isMultiQuestion = (p.questions?.length ?? 0) > 1;
    const voteVerdict = voteVerdictFor(p);
    const { percents, counts, total } = computeVoteResults(p.votingResults, variants.length);
    const belowThreshold = total <= VOTE_COUNT_THRESHOLD && !devMode;
    const endTime = p.startTimestamp + p.duration;
    const showPastHeader = !active && index === activeProposals.length;

    return (
      <>
        {showPastHeader && (
          <View style={styles.pastHeader}>
            <Text style={styles.pastHeaderText}>{t('home.badgeFinished')}</Text>
          </View>
        )}
        <View style={[styles.voteCard, !active && styles.voteCardPast]}>
          <View style={styles.badgeContainer}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, !active && { backgroundColor: colors.border }]}>
                <Text style={styles.badgeText} allowFontScaling={false}>
                  {active ? t('home.badgeOngoing') : upcoming ? t('home.badgeSoon') : t('home.badgeFinished')}
                </Text>
              </View>
              {devMode && (
                <TouchableOpacity
                  style={styles.devBadge}
                  activeOpacity={0.7}
                  onPress={() => console.log(`\n=== PROPOSAL #${p.id} ===\n${JSON.stringify(p, bigintReplacer, 2)}\n=== END PROPOSAL #${p.id} ===\n`)}
                >
                  <Text style={styles.devBadgeText}>#{p.id}{p.twin ? ` + #${p.twin.cardId}` : ''}</Text>
                </TouchableOpacity>
              )}
              {/* Document-type + citizenship-whitelist tag. Dev-mode only:
                  this beta lets users pick either document type regardless
                  of a proposal's real contract binding (DocumentChoice
                  screen), so surfacing the contract's actual
                  requirement here would be confusing/irrelevant noise for
                  regular testers — kept visible under devMode for
                  diagnostics. Tag the doc type by voting contract, not
                  selector: selector is a field-reveal bitmask shared by ID
                  and passport proposals (e.g. 39457 appears on both). The
                  authoritative signal is sendVoteContractAddress —
                  BioPassportVoting → passport, everything else (currently
                  IDCardVoting `0x7d73…`) → ID card. */}
              {devMode && (
                <View style={styles.docTagBadge}>
                  <Text style={styles.docTagText}>
                    {p.twin
                      ? `${t('home.docTagPassport')} + ${t('home.docTagIdCard')}`
                      : acceptsBothDocuments(contractsById[p.id])
                        ? `${t('home.docTagPassport')} + ${t('home.docTagIdCard')} (même id)`
                        : isPassportVotingTarget(p)
                          ? t('home.docTagPassport')
                          : t('home.docTagIdCard')}
                    {p.criteria.citizenshipWhitelist.length > 0
                      ? ' ' + p.criteria.citizenshipWhitelist.map((c: string) => {
                          // Shared with the vote path — see decodeCitizenship's
                          // note on the leading-zero bug this inline copy had.
                          try { return decodeCitizenship(BigInt(c)); }
                          catch { return String(c); }
                        }).join(',')
                      : ''}
                  </Text>
                </View>
              )}
              <Text style={styles.startedAgo}>{formatTimeAgo(p.startTimestamp)}</Text>
            </View>
            <Text style={styles.voteTitle}>{p.title}</Text>
          </View>

          {p.description ? (
            <TextWithLinks text={p.description} style={styles.voteDescription} linkColor={colors.secondary} />
          ) : null}

          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={t('home.referendumLearnMore')}
            onPress={() => WebBrowser.openBrowserAsync(referendumInfoUrl(sitePage(p)))}
            style={styles.learnMoreLink}
          >
            <Text style={styles.learnMoreText}>{t('home.referendumLearnMore')}</Text>
            <CaretRightIcon color={colors.secondary} size={16} />
          </TouchableOpacity>

          <View style={styles.statsContainer}>
            {belowThreshold ? (
              <View style={styles.statColumn}>
                <Text style={styles.statValue}>{t('home.countingInProgress')}</Text>
              </View>
            ) : (
              <View style={styles.statColumn}>
                <Text style={styles.statLabel}>{t('home.votes')}</Text>
                <Text style={styles.statValue}>{formatCount(total)}</Text>
              </View>
            )}
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>
                {active ? t('home.endsIn') : upcoming ? t('home.startsOn') : t('home.badgeFinished')}
              </Text>
              <Text style={styles.statValue}>
                {active ? formatTimeRemaining(endTime) : upcoming ? formatTimeRemaining(p.startTimestamp) : formatTimeAgo(endTime)}
              </Text>
            </View>
          </View>

          {active && !isMultiQuestion && voteVerdict.ok && (
            <TouchableOpacity style={styles.voteButton} activeOpacity={0.8} onPress={() => handleVoterPress(p)}>
              <Text style={styles.voteButtonText}>{t('home.voteButton')}</Text>
            </TouchableOpacity>
          )}
          {active && isMultiQuestion && (
            <View style={[styles.voteButton, { backgroundColor: colors.border, opacity: 0.7 }]}>
              <Text style={[styles.voteButtonText, { color: colors.text }]}>{t('home.voteUnsupportedMultiQuestion')}</Text>
            </View>
          )}
          {/* REG-10: a refused verdict used to render nothing at all, so the
              card ended on the results with no call to action and no reason.
              Same greyed button as the multi-question case, with the sentence
              that names the refusal (utils/vote-eligibility.ts). */}
          {active && !isMultiQuestion && !voteVerdict.ok && (
            <View
              style={[styles.voteButton, { backgroundColor: colors.border, opacity: 0.7 }]}
              testID={`vote-refused-${p.id}`}
            >
              <Text style={[styles.voteButtonText, { color: colors.text }]}>
                {t(refusalMessageKey(voteVerdict.reason))}
              </Text>
            </View>
          )}
          {/* A closed question keeps living on the site as a petition, on the
              same page "En savoir plus" opens. */}
          {closedByIndex && (
            <TouchableOpacity
              style={styles.voteButton}
              activeOpacity={0.8}
              accessibilityRole="link"
              onPress={() => Linking.openURL(petitionUrl(sitePage(p)))}
            >
              <Text style={styles.voteButtonText}>{t('home.signPetition')}</Text>
            </TouchableOpacity>
          )}

          {variants.length > 0 && (
            <>
              {active && (
                <Text style={{ fontSize: 12, color: colors.secondary || colors.text, opacity: 0.6, marginBottom: 4, marginTop: 8 }}>
                  {t('home.resultsNow')}
                </Text>
              )}
              <VoteResults variants={variants} percents={percents} counts={counts} belowThreshold={belowThreshold} />
            </>
          )}
        </View>
      </>
    );
  }, [styles, colors, activeProposals.length, devMode, contractsById, isLive, closedIds, sitePage, t, voteVerdictFor]);

  const keyExtractor = useCallback((p: ProposalInfo) => p.id, []);

  if (isLoading && proposals.length === 0) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.fullScreenLoader}>
          <ActivityIndicator size="large" color={colors.secondary} />
          <Text style={styles.fullScreenLoaderText}>{t('home.loading')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <FlatList
        ref={listRef}
        data={allProposals}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={
          <View>
            {isLoadingMore && (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.secondary} />
              </View>
            )}
            {/* The questions that are not votes yet: petitions, on the site. */}
            {!isLoading && (
              <TouchableOpacity
                style={styles.petitionsEntry}
                activeOpacity={0.7}
                onPress={() => router.push('/petitions')}
                accessibilityRole="button"
              >
                <Text style={styles.petitionsEntryTitle}>{t('petitions.title')}</Text>
                <Text style={styles.petitionsEntryText}>{t('petitions.entryText')}</Text>
                <Text style={styles.petitionsEntryLink}>{t('petitions.button')} ›</Text>
              </TouchableOpacity>
            )}
            <View style={styles.tabBarSpacer} />
          </View>
        }
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.secondary} />
        }
        onEndReached={fetchMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={3}
        windowSize={5}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Variable-height rows — scrollToIndex can fail if the target isn't
          // laid out yet. Fall back to an offset estimate, then retry once
          // the row is measured.
          listRef.current?.scrollToOffset({
            offset: Math.max(0, (averageItemLength || 400) * index),
            animated: true,
          });
          setTimeout(() => {
            try {
              listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
            } catch {}
          }, 250);
        }}
      />

    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fullScreenLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  fullScreenLoaderText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
    opacity: 0.6,
  },
  contentContainer: {
    paddingBottom: Spacing.tabBar.containerHeight,
    gap: Spacing.screen.sectionGap,
  },
  voteListSection: {
    backgroundColor: colors.cardBackground,
    paddingTop: Spacing.voteList.paddingTop,
    paddingHorizontal: Spacing.voteList.paddingHorizontal,
  },
  learnMoreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  learnMoreText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.small,
    lineHeight: Typography.lineHeight.small,
    color: colors.secondary,
    textDecorationLine: 'underline',
  },
  voteListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.voteList.titlePaddingVertical,
  },
  voteListTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
  },
  voteListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.voteList.itemPaddingVertical,
    gap: Spacing.voteList.itemGap,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  voteListItemText: {
    flex: 1,
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.settingRow,
    lineHeight: Typography.lineHeight.settingRow,
    letterSpacing: Typography.letterSpacing.settingRow,
    color: colors.text,
  },
  voteCard: {
    backgroundColor: colors.cardBackground,
    padding: Spacing.voteCard.padding,
    gap: Spacing.voteCard.gap,
  },
  badgeContainer: {
    gap: Spacing.voteCard.badgeGap,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  startedAgo: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.text,
    opacity: 0.5,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.voteCard.badgePaddingVertical,
    paddingHorizontal: Spacing.voteCard.badgePaddingHorizontal,
    backgroundColor: colors.background,
    borderRadius: Spacing.voteCard.badgeRadius,
  },
  badgeText: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
  },
  devBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: colors.errorText,
    borderRadius: 8,
  },
  betaBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: colors.secondary,
    borderRadius: 8,
  },
  betaBadgeText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.buttonText,
  },
  petitionsEntry: {
    marginTop: Spacing.screen.sectionGap,
    marginHorizontal: Spacing.voteList.paddingHorizontal,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
    gap: 6,
  },
  petitionsEntryTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.m,
    lineHeight: Typography.lineHeight.m,
    color: colors.text,
  },
  petitionsEntryText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
    opacity: 0.7,
  },
  petitionsEntryLink: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    color: colors.secondary,
  },
  pastHeader: {
    paddingHorizontal: Spacing.voteList.paddingHorizontal,
    paddingTop: Spacing.screen.sectionGap,
    paddingBottom: 8,
  },
  pastHeaderText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
    opacity: 0.5,
  },
  voteCardPast: {
    opacity: 0.7,
  },
  devBadgeText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 11,
    color: colors.buttonText,
  },
  docTagBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: colors.secondary,
    borderRadius: 8,
  },
  docTagText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 10,
    color: colors.buttonText,
  },
  voteTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
  },
  voteDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 0,
  },
  statColumn: {
    flex: 1,
    gap: Spacing.voteCard.statsGap,
  },
  statLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    lineHeight: Typography.lineHeight.small,
    letterSpacing: Typography.letterSpacing.small,
    color: colors.text,
  },
  statValue: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.voteCount,
    lineHeight: Typography.lineHeight.voteCount,
    letterSpacing: Typography.letterSpacing.voteCount,
    color: colors.text,
  },
  voteButton: {
    paddingVertical: Spacing.voteCard.buttonPaddingVertical,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  voteButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.buttonText,
    textAlign: 'center',
  },
  resultsContainer: {
    gap: Spacing.voteCard.resultsGap,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.voteCard.resultsBarGap,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  barWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: Spacing.voteCard.barPaddingVertical,
  },
  barPercent: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.voteCount,
    lineHeight: Typography.lineHeight.voteCount,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.text,
    textAlign: 'center',
  },
  labelsContainer: {
    flexDirection: 'row',
    gap: Spacing.voteCard.resultsBarGap,
  },
  barLabel: {
    flex: 1,
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.voteCount,
    lineHeight: Typography.lineHeight.voteCount,
    letterSpacing: Typography.letterSpacing.button,
    color: colors.text,
    textAlign: 'center',
  },
  countsContainer: {
    flexDirection: 'row',
    gap: Spacing.voteCard.resultsBarGap,
  },
  barCount: {
    flex: 1,
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    lineHeight: Typography.lineHeight.small,
    letterSpacing: Typography.letterSpacing.small,
    color: colors.text,
    textAlign: 'center',
  },
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
    backgroundColor: 'transparent',
  },
});
