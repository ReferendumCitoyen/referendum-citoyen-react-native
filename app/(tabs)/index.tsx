import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet, FlatList, View, Text, TouchableOpacity, Platform, ActivityIndicator, RefreshControl } from 'react-native';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { useRouter, useFocusEffect } from 'expo-router';
import { FREEDOM_TOOL_CONFIG } from '@/constants/rarime-config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { useTranslation } from 'react-i18next';
import { useDevMode } from '@/contexts/DevModeContext';

const PROPOSALS_CACHE_KEY = 'cached_proposals_v1';
const bigintReplacer = (_: string, v: any) => typeof v === 'bigint' ? v.toString() + 'n' : v;
const bigintReviver = (_: string, v: any) => typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v;

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

// --- Helpers ---

const isActive = (p: ProposalInfo): boolean => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now >= p.startTimestamp && now <= p.startTimestamp + p.duration;
};

const formatTimeRemaining = (endTimestamp: bigint): string => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= endTimestamp) return 'Terminé';
  const diff = Number(endTimestamp - now);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  return `${days}J ${hours}H ${minutes}M`;
};

const formatTimeAgo = (timestamp: bigint): string => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < timestamp) return 'Bientôt';
  const localDate = new Date(Number(timestamp) * 1000);
  return localDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const computeVoteResults = (votingResults: bigint[][], variantCount: number) => {
  if (!votingResults || votingResults.length === 0 || !votingResults[0]) {
    return { percents: [], counts: [], total: 0 };
  }
  // Slice results to match actual number of variants (contract may pad with zeros)
  const results = votingResults[0].slice(0, variantCount);
  const total = results.reduce((sum, v) => sum + v, 0n);
  const percents = results.map(v => total > 0n ? Number(v * 10000n / total) / 100 : 0);
  const counts = results.map(v => Number(v));
  return { percents, counts, total: Number(total) };
};

// --- VoteResults component (dynamic variants) ---

interface VoteResultsProps {
  variants: string[];
  percents: number[];
  counts: number[];
}

// Blue, Red, White, then cycle for extras
const barColors = ['#3B82F6', '#EF4444', '#E5E7EB', '#F59E0B', '#22C55E'];

const VoteResults = ({ variants, percents, counts }: VoteResultsProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const maxHeight = 64;
  const minHeight = 2;
  const total = counts.reduce((s, c) => s + c, 0);
  const hasVotes = total > 0;

  const calculateHeight = (percent: number) => {
    if (percent === 0) return minHeight;
    return Math.max(minHeight, (percent / 100) * maxHeight);
  };

  return (
    <View style={styles.resultsContainer}>
      <View style={styles.barsContainer}>
        {variants.map((_, idx) => (
          <View key={idx} style={styles.barWrapper}>
            <View style={[
              styles.bar,
              {
                height: hasVotes ? calculateHeight(percents[idx] ?? 0) : 24,
                backgroundColor: barColors[idx % barColors.length],
                opacity: hasVotes ? 1 : 0.4,
              },
            ]}>
              {hasVotes && (
                <Text style={styles.barPercent}>{(percents[idx] ?? 0).toFixed(1)}%</Text>
              )}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.labelsContainer}>
        {variants.map((v, idx) => (
          <Text key={idx} style={styles.barLabel}>{v}</Text>
        ))}
      </View>
      {hasVotes && (
        <View style={styles.countsContainer}>
          {counts.map((c, idx) => (
            <Text key={idx} style={styles.barCount}>{c.toLocaleString()}</Text>
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

  const getFreedomTool = useCallback(async () => {
    if (!ftRef.current) {
      const { FreedomTool } = await import('@rarimo/rarime-rn-sdk');
      ftRef.current = new FreedomTool(FREEDOM_TOOL_CONFIG);
    }
    return ftRef.current;
  }, []);

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

  const fetchProposals = useCallback(async (refresh = false) => {
    try {
      if (!refresh) {
        try {
          const cached = await AsyncStorage.getItem(PROPOSALS_CACHE_KEY);
          if (cached) {
            const parsed = JSON.parse(cached, bigintReviver) as ProposalInfo[];
            setProposals(parsed);
            setIsLoading(false);
          }
        } catch {}
      }

      if (refresh) setIsRefreshing(true);
      setLoadError(null);

      const { JsonRpcProvider, Contract } = await import('ethers');
      const provider = new JsonRpcProvider(FREEDOM_TOOL_CONFIG.api.votingRpcUrl);
      const contract = new Contract(
        FREEDOM_TOOL_CONFIG.contracts.proposalStateAddress,
        ['function lastProposalId() view returns (uint256)'],
        provider
      );
      const lastId = Number(await contract.lastProposalId());
      console.log(`[Accueil] lastProposalId: ${lastId}`);

      const loaded = await fetchBatch(lastId, PAGE_SIZE);
      const sorted = loaded.sort((a, b) => Number(b.id) - Number(a.id));

      console.log(`[Accueil] Fetched ${sorted.length} proposals from network`);
      setProposals(sorted);
      oldestIdRef.current = sorted.length > 0 ? Math.min(...sorted.map(p => Number(p.id))) : 0;
      setHasMore(oldestIdRef.current > 1);

      try {
        await AsyncStorage.setItem(PROPOSALS_CACHE_KEY, JSON.stringify(sorted, bigintReplacer));
      } catch {}
    } catch (err) {
      console.error('[Accueil] Failed to load proposals:', err);
      setLoadError((err as Error).message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fetchBatch]);

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

  // Auto-refresh when screen regains focus (e.g. after voting)
  const isFirstMount = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstMount.current) {
        isFirstMount.current = false;
        return;
      }
      fetchProposals(true);
    }, [fetchProposals])
  );

  const onRefresh = useCallback(() => fetchProposals(true), [fetchProposals]);

  const handleVoterPress = (proposalId: string) => {
    if (Platform.OS === 'android') {
      router.push('/voting-flow');
    } else {
      router.push({ pathname: '/voting-screen', params: { proposalId } });
    }
  };

  const activeProposals = useMemo(() => proposals.filter(isActive), [proposals]);
  const pastProposals = useMemo(() => proposals.filter(p => !isActive(p)), [proposals]);
  const allProposals = useMemo(() => [...activeProposals, ...pastProposals], [activeProposals, pastProposals]);

  const renderHeader = useCallback(() => (
    <View style={styles.voteListSection}>
      <View style={styles.voteListHeader}>
        <Text style={styles.voteListTitle}>{t('home.ongoingVotes')}</Text>
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
        <Text style={[styles.voteListItemText, { color: '#EF4444', paddingVertical: 12 }]}>
          {t('home.error', { message: loadError })}
        </Text>
      )}

      {!isLoading && activeProposals.length === 0 && !loadError && (
        <Text style={[styles.voteListItemText, { paddingVertical: 12 }]}>
          {t('home.noProposals')}
        </Text>
      )}

      {(showAllList ? activeProposals : activeProposals.slice(0, 3)).map((p) => (
        <TouchableOpacity key={p.id} style={styles.voteListItem} activeOpacity={0.7}>
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
  ), [activeProposals, showAllList, isLoading, loadError, colors, styles]);

  const renderItem = useCallback(({ item: p, index }: { item: ProposalInfo; index: number }) => {
    const active = isActive(p);
    const variants = p.questions[0]?.variants ?? [];
    const { percents, counts, total } = computeVoteResults(p.votingResults, variants.length);
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
                <>
                  <TouchableOpacity
                    style={styles.devBadge}
                    activeOpacity={0.7}
                    onPress={() => console.log(`\n=== PROPOSAL #${p.id} ===\n${JSON.stringify(p, bigintReplacer, 2)}\n=== END PROPOSAL #${p.id} ===\n`)}
                  >
                    <Text style={styles.devBadgeText}>#{p.id}</Text>
                  </TouchableOpacity>
                  <View style={styles.devInfoBadge}>
                    <Text style={styles.devInfoText}>
                      {Number(p.criteria.selector) === 6689 ? 'ID' : 'PP'}
                      {p.criteria.citizenshipWhitelist.length > 0
                        ? ' ' + p.criteria.citizenshipWhitelist.map(c => {
                            try {
                              const hex = BigInt(c).toString(16);
                              const bytes = [];
                              for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substring(i, i + 2), 16));
                              return String.fromCharCode(...bytes);
                            } catch { return String(c); }
                          }).join(',')
                        : ' ALL'}
                    </Text>
                  </View>
                </>
              )}
              <Text style={styles.startedAgo}>{formatTimeAgo(p.startTimestamp)}</Text>
            </View>
            <Text style={styles.voteTitle}>{p.title}</Text>
          </View>

          {p.description ? (
            <Text style={styles.voteDescription}>{p.description}</Text>
          ) : null}

          <View style={styles.statsContainer}>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>{t('home.votes')}</Text>
              <Text style={styles.statValue}>{total.toLocaleString()}</Text>
            </View>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>{active ? t('home.endsIn') : t('home.badgeFinished')}</Text>
              <Text style={styles.statValue}>{active ? formatTimeRemaining(endTime) : formatTimeAgo(endTime)}</Text>
            </View>
          </View>

          {active && (
            <TouchableOpacity style={styles.voteButton} activeOpacity={0.8} onPress={() => handleVoterPress(p.id)}>
              <Text style={styles.voteButtonText}>{t('home.voteButton')}</Text>
            </TouchableOpacity>
          )}

          {variants.length > 0 && (
            <VoteResults variants={variants} percents={percents} counts={counts} />
          )}
        </View>
      </>
    );
  }, [styles, colors, activeProposals.length, devMode]);

  const keyExtractor = useCallback((p: ProposalInfo) => p.id, []);

  return (
    <View style={styles.screenContainer}>
      <FlatList
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
      />

    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
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
    backgroundColor: '#EF4444',
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
    color: '#FFFFFF',
  },
  devInfoBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: '#6366F1',
    borderRadius: 8,
  },
  devInfoText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: 10,
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
});
