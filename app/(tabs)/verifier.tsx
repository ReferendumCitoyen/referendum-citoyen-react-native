import React, { useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Svg, Path } from 'react-native-svg';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { FREEDOM_TOOL_CONFIG, RARIME_TESTNET_CONFIG, PRIVATE_KEY_STORAGE_KEY } from '@/constants/rarime-config';
import * as SecureStore from 'expo-secure-store';
import SettingsButton from '@/components/SettingsButton';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';

const EXPLORER_BASE = 'https://scan.qtestnet.org/address/';

const ShieldCheckIcon = ({ color, size = 20 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2ZM10 17L6 13L7.41 11.59L10 14.17L16.59 7.58L18 9L10 17Z"
      fill={color}
    />
  </Svg>
);

const ExternalLinkIcon = ({ color, size = 16 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 13V19C18 20.1 17.1 21 16 21H5C3.9 21 3 20.1 3 19V8C3 6.9 3.9 6 5 6H11M15 3H21V9M10 14L21 3"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const isActive = (p: ProposalInfo): boolean => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return now >= p.startTimestamp && now <= p.startTimestamp + p.duration;
};

const computeTotal = (votingResults: bigint[][], variantCount: number): number => {
  if (!votingResults?.[0]) return 0;
  return Number(votingResults[0].slice(0, variantCount).reduce((s, v) => s + v, 0n));
};

export default function VerifierScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [voteStatus, setVoteStatus] = useState<Record<string, 'checking' | 'voted' | 'not_voted' | 'error'>>({});
  const ftRef = useRef<any>(null);
  const rarimeRef = useRef<any>(null);

  const getFreedomTool = useCallback(async () => {
    if (!ftRef.current) {
      const { FreedomTool } = await import('@rarimo/rarime-rn-sdk');
      ftRef.current = new FreedomTool(FREEDOM_TOOL_CONFIG);
    }
    return ftRef.current;
  }, []);

  const getRarime = useCallback(async () => {
    if (!rarimeRef.current) {
      const { Rarime, RarimeUtils } = await import('@rarimo/rarime-rn-sdk');
      let storedKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);
      if (!storedKey) {
        storedKey = RarimeUtils.generateBJJPrivateKey();
        await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, storedKey);
      }
      rarimeRef.current = new Rarime({
        ...RARIME_TESTNET_CONFIG,
        userConfiguration: { userPrivateKey: storedKey },
      });
    }
    return rarimeRef.current;
  }, []);

  const checkVote = useCallback(async (proposal: ProposalInfo) => {
    setVoteStatus(prev => ({ ...prev, [proposal.id]: 'checking' }));
    try {
      const ft = await getFreedomTool();
      const rarime = await getRarime();
      const voted = await ft.isAlreadyVoted(proposal, rarime);
      setVoteStatus(prev => ({ ...prev, [proposal.id]: voted ? 'voted' : 'not_voted' }));
    } catch (err) {
      console.error('[Vérifier] Check vote error:', err);
      setVoteStatus(prev => ({ ...prev, [proposal.id]: 'error' }));
    }
  }, [getFreedomTool, getRarime]);

  const fetchProposals = useCallback(async (refresh = false) => {
    try {
      if (refresh) setIsRefreshing(true);

      const { JsonRpcProvider, Contract } = await import('ethers');
      const provider = new JsonRpcProvider(FREEDOM_TOOL_CONFIG.api.votingRpcUrl);
      const contract = new Contract(
        FREEDOM_TOOL_CONFIG.contracts.proposalStateAddress,
        ['function lastProposalId() view returns (uint256)'],
        provider
      );
      const lastId = Number(await contract.lastProposalId());
      const ft = await getFreedomTool();

      const ids = Array.from({ length: Math.min(lastId, 3) }, (_, i) => lastId - i).filter(id => id >= 1);
      const results = await Promise.allSettled(ids.map(id => ft.getProposalInfo(String(id))));
      const loaded = results
        .filter((r): r is PromiseFulfilledResult<ProposalInfo> => r.status === 'fulfilled')
        .map(r => r.value)
        .sort((a, b) => Number(b.id) - Number(a.id));

      setProposals(loaded);
    } catch (err) {
      console.error('[Vérifier] Failed to load proposals:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [getFreedomTool]);

  useFocusEffect(
    useCallback(() => {
      fetchProposals();
    }, [fetchProposals])
  );

  const onRefresh = useCallback(() => fetchProposals(true), [fetchProposals]);

  const renderItem = useCallback(({ item: p }: { item: ProposalInfo }) => {
    const active = isActive(p);
    const variants = p.questions[0]?.variants ?? [];
    const total = computeTotal(p.votingResults, variants.length);
    const contractAddress = p.sendVoteContractAddress;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.badge, active && styles.badgeActive]}>
            <Text style={styles.badgeText}>{active ? 'En cours' : 'Terminé'}</Text>
          </View>
          <View style={styles.verifiedBadge}>
            <ShieldCheckIcon color="#22C55E" size={16} />
            <Text style={styles.verifiedText}>On-chain</Text>
          </View>
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>{p.title}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Votes enregistrés</Text>
            <Text style={styles.statValue}>{total.toLocaleString()}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Options</Text>
            <Text style={styles.statValue}>{variants.length}</Text>
          </View>
        </View>

        {variants.length > 0 && (
          <View style={styles.variantsContainer}>
            {variants.map((v, idx) => {
              const count = p.votingResults?.[0]?.[idx] ? Number(p.votingResults[0][idx]) : 0;
              const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
              return (
                <View key={idx} style={styles.variantRow}>
                  <Text style={styles.variantName} numberOfLines={1}>{v}</Text>
                  <Text style={styles.variantCount}>{count.toLocaleString()} ({pct}%)</Text>
                </View>
              );
            })}
          </View>
        )}

        {contractAddress && (
          <TouchableOpacity
            style={styles.explorerLink}
            activeOpacity={0.7}
            onPress={() => Linking.openURL(`${EXPLORER_BASE}${contractAddress}`)}
          >
            <Text style={styles.explorerText}>Voir sur la blockchain</Text>
            <ExternalLinkIcon color={colors.secondary} size={14} />
          </TouchableOpacity>
        )}

        {(() => {
          const status = voteStatus[p.id];
          if (status === 'checking') {
            return (
              <View style={styles.checkingRow}>
                <ActivityIndicator size="small" color={colors.secondary} />
                <Text style={styles.checkingText}>Vérification...</Text>
              </View>
            );
          }
          if (status === 'voted') {
            return (
              <View style={styles.resultRow}>
                <ShieldCheckIcon color="#22C55E" size={20} />
                <Text style={[styles.resultText, { color: '#22C55E' }]}>Votre vote a été enregistré</Text>
              </View>
            );
          }
          if (status === 'not_voted') {
            return (
              <View style={styles.resultRow}>
                <Text style={[styles.resultText, { color: colors.text, opacity: 0.5 }]}>Aucun vote trouvé pour cet appareil</Text>
              </View>
            );
          }
          if (status === 'error') {
            return (
              <TouchableOpacity style={styles.verifyButton} activeOpacity={0.8} onPress={() => checkVote(p)}>
                <Text style={styles.verifyButtonText}>Réessayer</Text>
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity style={styles.verifyButton} activeOpacity={0.8} onPress={() => checkVote(p)}>
              <Text style={styles.verifyButtonText}>Vérifier mon vote</Text>
            </TouchableOpacity>
          );
        })()}
      </View>
    );
  }, [styles, colors, voteStatus, checkVote]);

  const renderHeader = useCallback(() => (
    <View style={styles.headerSection}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Vérifier</Text>
        <SettingsButton />
      </View>
      <Text style={styles.headerDescription}>
        Chaque vote est enregistré sur la blockchain et vérifiable publiquement. Aucun serveur central ne peut modifier les résultats.
      </Text>
    </View>
  ), [styles]);

  if (isLoading) {
    return (
      <View style={styles.screenContainer}>
        {renderHeader()}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.secondary} />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <FlatList
        data={proposals}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.secondary} />
        }
        ListFooterComponent={<View style={styles.tabBarSpacer} />}
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
    gap: Spacing.screen.sectionGap,
  },
  headerSection: {
    backgroundColor: colors.cardBackground,
    paddingTop: Spacing.screen.top,
    paddingHorizontal: Spacing.screen.horizontal,
    paddingBottom: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
  },
  headerDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
    opacity: 0.6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    opacity: 0.6,
  },
  card: {
    backgroundColor: colors.cardBackground,
    padding: Spacing.voteCard.padding,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.border,
    borderRadius: 8,
  },
  badgeActive: {
    backgroundColor: colors.background,
  },
  badgeText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: '#22C55E',
  },
  cardTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
  },
  statsRow: {
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    gap: 2,
  },
  statLabel: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.small,
    lineHeight: Typography.lineHeight.small,
    color: colors.text,
  },
  statValue: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.voteCount,
    lineHeight: Typography.lineHeight.voteCount,
    color: colors.text,
  },
  variantsContainer: {
    gap: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  variantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  variantName: {
    flex: 1,
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  variantCount: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  explorerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  explorerText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.secondary,
  },
  verifyButton: {
    paddingVertical: 12,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    borderRadius: 8,
  },
  verifyButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.button,
    lineHeight: Typography.lineHeight.button,
    color: colors.buttonText,
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  checkingText: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    opacity: 0.6,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  resultText: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
  },
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
  },
});
