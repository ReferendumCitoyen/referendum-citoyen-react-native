import React, { useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Linking, TextInput, Keyboard } from 'react-native';
import { Svg, Path } from 'react-native-svg';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { FREEDOM_TOOL_CONFIG } from '@/constants/rarime-config';
import SettingsButton from '@/components/SettingsButton';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';

const EXPLORER_BASE = 'https://scan.qtestnet.org/tx/';

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

interface LookupResult {
  proposal: ProposalInfo;
  votedFor: string;
  answerIndex: number;
  txHash: string;
}

export default function VerifierScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const [txHashInput, setTxHashInput] = useState('');
  const [txLookupStatus, setTxLookupStatus] = useState<'idle' | 'loading' | 'success' | 'not_found' | 'error'>('idle');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  const ftRef = useRef<any>(null);

  const getFreedomTool = useCallback(async () => {
    if (!ftRef.current) {
      const { FreedomTool } = await import('@rarimo/rarime-rn-sdk');
      ftRef.current = new FreedomTool(FREEDOM_TOOL_CONFIG);
    }
    return ftRef.current;
  }, []);

  const lookupVoteTx = useCallback(async () => {
    const hash = txHashInput.trim();
    if (!hash) return;
    Keyboard.dismiss();
    setTxLookupStatus('loading');
    setLookupResult(null);
    try {
      const { JsonRpcProvider, AbiCoder } = await import('ethers');
      const provider = new JsonRpcProvider(FREEDOM_TOOL_CONFIG.api.votingRpcUrl);
      const tx = await provider.getTransaction(hash);
      if (!tx) {
        setTxLookupStatus('not_found');
        return;
      }

      // Decode executeTD1Noir(bytes32, uint256, bytes, bytes)
      const abiCoder = AbiCoder.defaultAbiCoder();
      const decoded = abiCoder.decode(
        ['bytes32', 'uint256', 'bytes', 'bytes'],
        '0x' + tx.data.slice(10)
      );

      // Decode userPayload: (uint256 proposalId, uint256[] votes, (uint256,uint256,uint256))
      const payloadDecoded = abiCoder.decode(
        ['uint256', 'uint256[]', 'tuple(uint256,uint256,uint256)'],
        decoded[2]
      );
      const proposalId = payloadDecoded[0].toString();
      const votesMask = payloadDecoded[1];
      const answerIndex = Math.log2(Number(votesMask[0]));

      // Look up proposal to get full info
      const ft = await getFreedomTool();
      const proposal = await ft.getProposalInfo(proposalId);
      const variants = proposal.questions[0]?.variants ?? [];
      const votedFor = variants[answerIndex] ?? `Option ${answerIndex + 1}`;

      setLookupResult({ proposal, votedFor, answerIndex, txHash: hash });
      setTxLookupStatus('success');
    } catch (err) {
      console.error('[Vérifier] TX lookup error:', err);
      setTxLookupStatus('error');
    }
  }, [txHashInput, getFreedomTool]);

  return (
    <View style={styles.screenContainer}>
      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.headerSection}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Vérifier</Text>
            <SettingsButton />
          </View>
          <Text style={styles.headerDescription}>
            Chaque vote est enregistré sur la blockchain et vérifiable publiquement. Aucun serveur central ne peut modifier les résultats.
          </Text>
        </View>

        {/* Search */}
        <View style={styles.lookupCard}>
          <Text style={styles.lookupLabel}>Rechercher un vote par numéro de série</Text>
          <View style={styles.lookupInputRow}>
            <TextInput
              style={styles.lookupInput}
              value={txHashInput}
              onChangeText={(text) => {
                setTxHashInput(text);
                if (txLookupStatus !== 'idle') {
                  setTxLookupStatus('idle');
                  setLookupResult(null);
                }
              }}
              placeholder="0x..."
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.lookupButton, !txHashInput.trim() && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={lookupVoteTx}
              disabled={!txHashInput.trim() || txLookupStatus === 'loading'}
            >
              {txLookupStatus === 'loading' ? (
                <ActivityIndicator size="small" color={colors.buttonText} />
              ) : (
                <Text style={styles.lookupButtonText}>Vérifier</Text>
              )}
            </TouchableOpacity>
          </View>

          {txLookupStatus === 'not_found' && (
            <Text style={styles.lookupResultError}>Numéro de série introuvable. Vérifiez et réessayez.</Text>
          )}

          {txLookupStatus === 'error' && (
            <Text style={styles.lookupResultError}>Erreur lors de la vérification. Réessayez.</Text>
          )}
        </View>

        {/* Result card */}
        {txLookupStatus === 'success' && lookupResult && (() => {
          const { proposal: p, votedFor, answerIndex, txHash } = lookupResult;
          const active = isActive(p);
          const variants = p.questions[0]?.variants ?? [];
          const total = computeTotal(p.votingResults, variants.length);

          return (
            <View style={styles.resultCard}>
              {/* Vote confirmation */}
              <View style={styles.voteConfirmation}>
                <ShieldCheckIcon color="#22C55E" size={24} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.voteConfirmationTitle}>Vote vérifié</Text>
                  <Text style={styles.voteConfirmationAnswer}>Ce vote a choisi : {votedFor}</Text>
                </View>
              </View>

              {/* Poll info */}
              <View style={styles.pollSection}>
                <View style={styles.cardHeader}>
                  <View style={[styles.badge, active && styles.badgeActive]}>
                    <Text style={styles.badgeText}>{active ? 'En cours' : 'Terminé'}</Text>
                  </View>
                  <Text style={styles.pollId}>#{p.id}</Text>
                </View>

                <Text style={styles.pollTitle}>{p.title}</Text>

                {p.description ? (
                  <Text style={styles.pollDescription}>{p.description}</Text>
                ) : null}

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

                {/* Results breakdown */}
                {variants.length > 0 && (
                  <View style={styles.variantsContainer}>
                    {variants.map((v: string, idx: number) => {
                      const count = p.votingResults?.[0]?.[idx] ? Number(p.votingResults[0][idx]) : 0;
                      const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                      const isThisVote = idx === answerIndex;
                      return (
                        <View key={idx} style={[styles.variantRow, isThisVote && styles.variantRowHighlight]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                            {isThisVote && <ShieldCheckIcon color="#22C55E" size={14} />}
                            <Text style={[styles.variantName, isThisVote && styles.variantNameHighlight]} numberOfLines={1}>{v}</Text>
                          </View>
                          <Text style={[styles.variantCount, isThisVote && styles.variantCountHighlight]}>{count.toLocaleString()} ({pct}%)</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Blockchain link */}
                <TouchableOpacity
                  style={styles.explorerLink}
                  activeOpacity={0.7}
                  onPress={() => Linking.openURL(`${EXPLORER_BASE}${txHash}`)}
                >
                  <Text style={styles.explorerText}>Voir la transaction sur la blockchain</Text>
                  <ExternalLinkIcon color={colors.secondary} size={14} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}

        <View style={styles.tabBarSpacer} />
      </ScrollView>
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
  lookupCard: {
    backgroundColor: colors.cardBackground,
    padding: Spacing.voteCard.padding,
    gap: 12,
  },
  lookupLabel: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  lookupInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  lookupInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Typography.fontFamily.mono,
    fontSize: 13,
    color: colors.text,
  },
  lookupButton: {
    backgroundColor: colors.secondary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lookupButtonText: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.buttonText,
  },
  lookupResultError: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    color: '#EF4444',
  },
  resultCard: {
    backgroundColor: colors.cardBackground,
    padding: Spacing.voteCard.padding,
    gap: 16,
  },
  voteConfirmation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F0FFF4',
    borderRadius: 12,
    padding: 16,
  },
  voteConfirmationTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: '#22C55E',
  },
  voteConfirmationAnswer: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    marginTop: 2,
  },
  pollSection: {
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
  pollId: {
    fontFamily: Typography.fontFamily.mono,
    fontSize: Typography.fontSize.small,
    color: colors.text,
    opacity: 0.5,
  },
  pollTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
  },
  pollDescription: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
    opacity: 0.7,
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
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  variantRowHighlight: {
    backgroundColor: '#F0FFF4',
  },
  variantName: {
    flex: 1,
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  variantNameHighlight: {
    fontFamily: Typography.fontFamily.bold,
    color: '#22C55E',
  },
  variantCount: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  variantCountHighlight: {
    color: '#22C55E',
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
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
  },
});
