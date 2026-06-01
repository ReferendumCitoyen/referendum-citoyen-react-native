import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet, FlatList, View, Text, TouchableOpacity, ActivityIndicator, RefreshControl, Linking, Pressable } from 'react-native';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { useRouter, useFocusEffect } from 'expo-router';
import { getFreedomToolConfig } from '@/constants/rarime-config';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
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
import { computeVoteResults, isFrenchCompatible, isPassportVotingTarget } from '@/utils/voteResults';
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
            <Text key={idx} style={[styles.barCount, many && { fontSize: 9 }]}>{c.toLocaleString()}</Text>
          ))}
        </View>
      )}
    </View>
  );
};

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
    const results = await Promise.allSettled(
      ids.map(id => ft.getProposalInfo(String(id)))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<ProposalInfo> => r.status === 'fulfilled')
      .map(r => r.value);
  }, [getFreedomTool]);

  // Main allowlist of proposal IDs to display on the home screen.
  //   #50 — the production scrutin for this release.
  // Extras (the editable list in ExtraProposalsContext) are concatenated
  // when the dev toggle is on — used to keep older verified scrutins
  // reachable for QA without exposing them to regular users.
  const HARDCODED_PROPOSAL_IDS = ['50'];
  // Proposals only surfaced when dev mode is on — recent open PASSPORT
  // scrutins (all on BioPassportVoting) the QA team uses for end-to-end vote
  // tests. Production #50 is in HARDCODED above, so it shows in both modes.
  // NB: #48 is intentionally excluded — it's an IDCardVoting proposal, and a
  // mainnet vote on it fails at submit (vote-calldata targets BioPassportVoting).
  const DEV_ONLY_PROPOSAL_IDS = ['38', '47', '49'];
  const effectiveIds = [
    ...HARDCODED_PROPOSAL_IDS,
    ...(devMode ? DEV_ONLY_PROPOSAL_IDS : []),
    ...(extraEnabled ? extraIds : []),
  ];

  const fetchProposals = useCallback(async (refresh = false) => {
    try {
      if (!refresh) {
        const parsed = await readCachedProposals(network);
        if (parsed) {
          // Filter the cache to the same allowlist so we don't briefly
          // show old proposals (e.g. #48) while the network call is in
          // flight.
          const filtered = parsed.filter(p => effectiveIds.includes(String(p.id)));
          setProposals(filtered);
          setIsLoading(false);
        }
      }

      if (refresh) setIsRefreshing(true);
      setLoadError(null);

      const ft = await getFreedomTool();
      const results = await Promise.allSettled(
        effectiveIds.map(id => ft.getProposalInfo(id))
      );
      const loaded = results
        .filter((r): r is PromiseFulfilledResult<ProposalInfo> => r.status === 'fulfilled')
        .map(r => r.value);
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
    // Re-fetch when the effective ID list changes (devMode flips, the
    // extras toggle flips, or the user edits the extras list in Settings).
  }, [getFreedomTool, network, ftConfig, devMode, extraEnabled, extraIds]);

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
  useEffect(() => {
    console.log('[Accueil] mounted — triggering circuit preload');
    preloadCircuits().catch((err) => {
      console.warn('[Accueil] Circuit preload failed (will retry at vote time):', err?.message);
    });
  }, []);

  // Dump the BJJ keypair at app launch so a developer can save it before
  // any test run — the private key only lives in SecureStore, so wiping the
  // app (or uninstalling) loses on-chain identity. Capture via `adb logcat |
  // grep KEYPAIR`. Duplicates the dump in app/voting-flow.tsx (which fires
  // later in the voting flow).
  //
  // SECURITY: gated behind __DEV__ so release builds never log the private
  // key to logcat. Anyone with `adb logcat` access on an unlocked device
  // could harvest the key and impersonate the user on-chain.
  useEffect(() => {
    if (!__DEV__) return;
    (async () => {
      try {
        const { getOrCreatePrivateKey } = await import('@/utils/identity');
        const storedKey = await getOrCreatePrivateKey();
        const { babyJub } = await import('@iden3/js-crypto');
        const { RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
        const pubPoint = babyJub.mulPointEScalar(babyJub.Base8, BigInt('0x' + storedKey));
        const pubX = pubPoint[0].toString(16).padStart(64, '0');
        const pubY = pubPoint[1].toString(16).padStart(64, '0');
        const profileKey = RarimeUtils.getProfileKey(storedKey);
        console.log('[FreedomTool][KEYPAIR] ===== BJJ KEYPAIR (save before testing) =====');
        console.log('[FreedomTool][KEYPAIR] privateKey: 0x' + storedKey);
        console.log('[FreedomTool][KEYPAIR] pubPoint.x: 0x' + pubX);
        console.log('[FreedomTool][KEYPAIR] pubPoint.y: 0x' + pubY);
        console.log('[FreedomTool][KEYPAIR] profileKey: 0x' + profileKey);
        console.log('[FreedomTool][KEYPAIR] ===== END KEYPAIR =====');
      } catch (e: any) {
        console.error('[FreedomTool][KEYPAIR] launch dump failed:', e?.message ?? e);
      }
    })();
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

  const onRefresh = useCallback(() => fetchProposals(true), [fetchProposals]);

  const handleVoterPress = (p: ProposalInfo) => {
    // Pass `isPassport` in the URL so voting-flow can pick the correct MRZ
    // mask (TD3 passport vs TD1 CNIe) immediately, without waiting on the
    // AsyncStorage cache. Cache hydration on the voting-flow side is racy
    // when the user paginates older proposals and clicks one before the
    // freshly-paginated batch has been written to storage. '1' / '0' for
    // URL-friendliness; voting-flow parses with `=== '1'`.
    const isPassport = isPassportVotingTarget(p) ? '1' : '0';
    const params = { proposalId: String(p.id), isPassport };
    router.push({ pathname: '/voting-flow', params });
  };

  // Hide proposals whose citizenshipWhitelist excludes FRA (per 2026-04-23
  // recap: only show votes a French ID card can actually be used on).
  // Dev mode bypasses the filter so we can see every proposal during testing.
  //
  // The previous build also filtered Mainnet proposals to only those targeting
  // the BioPassportVoting contract (`isPassportVotingTarget`). That filter
  // has been removed now that the voting flow targets TD1 (French ID card)
  // instead of TD3 (passport) — see Step5/Step6. ID-card-targeted proposals
  // route to the IDCardVoting deployment at 0x7d73513d64…
  //
  // Known gap: `utils/mainnet-vote-flow.ts` + `utils/vote-calldata.ts` still
  // build calldata for BioPassportVoting only. On Mainnet, voting on an
  // IDCardVoting proposal will fail at submit time. Testnet works because
  // it goes through `FreedomTool.submitProposal` which auto-routes per
  // `sendVoteContractAddress`. Tracked in CLAUDE.md ▸ "TD1 voting status".
  const eligibleProposals = useMemo(
    () => {
      if (devMode) return proposals;
      return proposals.filter(isFrenchCompatible);
    },
    [proposals, devMode]
  );
  const activeProposals = useMemo(() => eligibleProposals.filter(isActive), [eligibleProposals]);
  const pastProposals = useMemo(() => eligibleProposals.filter(p => !isActive(p)), [eligibleProposals]);
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
        <Text style={styles.voteListTitle}>{t('home.ongoingVotes')}</Text>
        <SettingsButton />
      </View>

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

      {!isLoading && activeProposals.length === 0 && !loadError && (
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
  ), [activeProposals, showAllList, isLoading, loadError, colors, styles, handleAnchorPress, t]);

  const renderItem = useCallback(({ item: p, index }: { item: ProposalInfo; index: number }) => {
    const active = isActive(p);
    const variants = p.questions[0]?.variants ?? [];
    // Multi-question proposals require N answers; our UI + vote calldata
    // only support N=1. The on-chain BioPassportVoting / IDCardVoting
    // contracts reject `vote_.length !== questions.length` with
    // "wrong number of votes". Disable voting for these and surface why.
    const isMultiQuestion = (p.questions?.length ?? 0) > 1;
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
                <Text style={styles.badgeText}>{active ? t('home.badgeOngoing') : t('home.badgeFinished')}</Text>
              </View>
              {devMode && (
                <TouchableOpacity
                  style={styles.devBadge}
                  activeOpacity={0.7}
                  onPress={() => console.log(`\n=== PROPOSAL #${p.id} ===\n${JSON.stringify(p, bigintReplacer, 2)}\n=== END PROPOSAL #${p.id} ===\n`)}
                >
                  <Text style={styles.devBadgeText}>#{p.id}</Text>
                </TouchableOpacity>
              )}
              {/* Document-type + citizenship-whitelist tag. Visible to all
                  users so they can tell at a glance whether a proposal
                  accepts a passport or an ID card, and for which country.
                  Tag the doc type by voting contract, not selector:
                  selector is a field-reveal bitmask shared by ID and
                  passport proposals (e.g. 39457 appears on both). The
                  authoritative signal is sendVoteContractAddress —
                  BioPassportVoting → passport, everything else (currently
                  IDCardVoting `0x7d73…`) → ID card. */}
              <View style={styles.docTagBadge}>
                <Text style={styles.docTagText}>
                  {isPassportVotingTarget(p)
                    ? t('home.docTagPassport')
                    : t('home.docTagIdCard')}
                  {p.criteria.citizenshipWhitelist.length > 0
                    ? ' ' + p.criteria.citizenshipWhitelist.map((c: string) => {
                        try {
                          const hex = BigInt(c).toString(16);
                          const bytes = [];
                          for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substring(i, i + 2), 16));
                          return String.fromCharCode(...bytes);
                        } catch { return String(c); }
                      }).join(',')
                    : ''}
                </Text>
              </View>
              <Text style={styles.startedAgo}>{formatTimeAgo(p.startTimestamp)}</Text>
            </View>
            <Text style={styles.voteTitle}>{p.title}</Text>
          </View>

          {p.description ? (
            <TextWithLinks text={p.description} style={styles.voteDescription} linkColor={colors.secondary} />
          ) : null}

          <View style={styles.statsContainer}>
            {belowThreshold ? (
              <View style={styles.statColumn}>
                <Text style={styles.statValue}>{t('home.countingInProgress')}</Text>
              </View>
            ) : (
              <View style={styles.statColumn}>
                <Text style={styles.statLabel}>{t('home.votes')}</Text>
                <Text style={styles.statValue}>{total.toLocaleString()}</Text>
              </View>
            )}
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>{active ? t('home.endsIn') : t('home.badgeFinished')}</Text>
              <Text style={styles.statValue}>{active ? formatTimeRemaining(endTime) : formatTimeAgo(endTime)}</Text>
            </View>
          </View>

          {active && !isMultiQuestion && (
            <TouchableOpacity style={styles.voteButton} activeOpacity={0.8} onPress={() => handleVoterPress(p)}>
              <Text style={styles.voteButtonText}>{t('home.voteButton')}</Text>
            </TouchableOpacity>
          )}
          {active && isMultiQuestion && (
            <View style={[styles.voteButton, { backgroundColor: colors.border, opacity: 0.7 }]}>
              <Text style={[styles.voteButtonText, { color: colors.text }]}>{t('home.voteUnsupportedMultiQuestion')}</Text>
            </View>
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
  }, [styles, colors, activeProposals.length, devMode]);

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
