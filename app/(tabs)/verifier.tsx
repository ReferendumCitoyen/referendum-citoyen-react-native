import React, { useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Linking, TextInput, Keyboard } from 'react-native';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { Svg, Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { formatCount } from '@/utils/format-count';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { getFreedomToolConfig, getExplorerTxBaseUrl, type Network } from '@/constants/rarime-config';
import { classifyReceipt, type VoteTxStatus } from '@/utils/vote-confirmation';
import { useNetwork } from '@/contexts/NetworkContext';
import SettingsButton from '@/components/SettingsButton';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { readCachedProposals } from '@/utils/proposal-cache';
import { readCachedIndex, twinsForNetwork } from '@/utils/proposal-index';
import { otherTwinId, pairProposals, sumVotingResults } from '@/utils/proposal-pairing';
import { TWIN_PROPOSALS } from '@/constants/twin-proposals';
import { parseVoteTxHash, lookupErrorCode } from '@/utils/vote-hash-input';

// Function selector for the BioPassportVoting `vote(...)` wrapper on Mainnet
// (TD3 Groth16 path). Computed from the ABI in utils/vote-calldata.ts:60-67;
// matches the selector logged by Step11 when castMainnetVote succeeds.
// Anything else is assumed to be the TD1 Noir path (executeTD1Noir).
const BIO_PASSPORT_VOTE_SELECTOR = '0x11181976';

const ShieldCheckIcon = ({ color, size = 20 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2ZM10 17L6 13L7.41 11.59L10 14.17L16.59 7.58L18 9L10 17Z"
      fill={color}
    />
  </Svg>
);

const AlertIcon = ({ color, size = 20 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
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
  voteDate: string | null;
  /** On-chain execution status. 'success' = mined & counted, 'reverted' =
   * mined but failed (vote NOT registered), 'pending' = not yet mined. A tx
   * existing and decoding as a vote does NOT mean it counted — gate on this. */
  status: VoteTxStatus;
  /** Which network the tx was actually found on — drives the explorer link
   * below (rarimo mainnet scan vs qtestnet scan). Shared vote hashes can
   * arrive from either network, so the verifier tries both and reports
   * which one matched. */
  network: Network;
}

/** Decode the proposalId + answerIndex out of a vote tx, branching by
 * function selector. Two distinct calldata shapes ship in production:
 *
 *   - `0x11181976` → BioPassportVoting.vote(...) on Mainnet (TD3 Groth16
 *     path; see utils/vote-calldata.ts:59-68 for the ABI source of truth).
 *   - Anything else → executeTD1Noir(bytes32, uint256, bytes, bytes) which
 *     wraps a (proposalId, uint256[] votes, userData) payload in bytes[2].
 *     Covers TD1 votes on both networks + TD3 testnet.
 */
function decodeVoteCalldata(
  txData: string,
  abiCoder: { decode(types: string[], data: string): unknown[] },
): { proposalId: string; answerIndex: number } | null {
  const selector = txData.slice(0, 10).toLowerCase();
  const body = '0x' + txData.slice(10);

  if (selector === BIO_PASSPORT_VOTE_SELECTOR) {
    // vote(bytes32 root, uint256 currentDate, uint256 proposalId,
    //      uint256[] vote_, (uint256,uint256,uint256) userData,
    //      (uint256[2], uint256[2][2], uint256[2]) zkPoints)
    const decoded = abiCoder.decode(
      [
        'bytes32',
        'uint256',
        'uint256',
        'uint256[]',
        'tuple(uint256,uint256,uint256)',
        'tuple(uint256[2],uint256[2][2],uint256[2])',
      ],
      body,
    );
    const proposalId = (decoded[2] as bigint).toString();
    const votesMask = decoded[3] as bigint[];
    const answerIndex = Math.log2(Number(votesMask[0]));
    return { proposalId, answerIndex };
  }

  // TD1 Noir path
  const outer = abiCoder.decode(['bytes32', 'uint256', 'bytes', 'bytes'], body);
  const payload = abiCoder.decode(
    ['uint256', 'uint256[]', 'tuple(uint256,uint256,uint256)'],
    outer[2] as string,
  );
  const proposalId = (payload[0] as bigint).toString();
  const votesMask = payload[1] as bigint[];
  const answerIndex = Math.log2(Number(votesMask[0]));
  return { proposalId, answerIndex };
}

export default function VerifierScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  // Le clavier couvrait le champ lui-meme, et le message d'erreur sous lui.
  // Trouve par la campagne QA du 23/09 sur verify-invalid, iPhone 17 en taille
  // de texte accessibilite. Meme remede que l'etape 5 : l'espace du clavier est
  // ajoute DANS le defilement, en marge basse du contenu, jamais par un
  // KeyboardAvoidingView qui pousse la vue depuis l'exterieur (voir
  // hooks/useKeyboardInset.ts, qui explique pourquoi le second avait rendu le
  // bouton « Continuer » inatteignable a l'etape 5).
  const keyboardInset = useKeyboardInset();
  // La marge basse ci-dessus rend le champ ATTEIGNABLE en faisant defiler.
  // Elle ne le rend pas VISIBLE : rien ne fait defiler a la place de la
  // personne. En taille de texte normale le champ tombait au-dessus du
  // clavier par chance ; en taille agrandie le libelle occupe trois lignes de
  // plus et le champ passe derriere le clavier. Constate le 24/09 sur
  // verify-invalid en 1.3 : la frappe destinee au bouton « Verifier » a
  // atterri sur une touche du clavier, et le champ affichait « abc123i ».
  // On amene donc la carte en haut de la zone visible quand le champ prend le
  // focus, c'est-a-dire au moment exact ou la personne veut la voir.
  const scrollRef = useRef<ScrollView>(null);
  const lookupCardY = useRef(0);
  const styles = createStyles(colors);
  const { network } = useNetwork();
  const [txHashInput, setTxHashInput] = useState('');
  const [txLookupStatus, setTxLookupStatus] = useState<'idle' | 'loading' | 'success' | 'not_found' | 'error' | 'invalid'>('idle');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  /** Try a single network: fetch the tx, decode its calldata, resolve the
   * proposal. Returns null if the tx isn't on that network; throws if it
   * exists but parsing fails. */
  const tryLookupOnNetwork = useCallback(async (
    hash: string,
    net: Network,
  ): Promise<LookupResult | null> => {
    const cfg = getFreedomToolConfig(net);
    const { JsonRpcProvider, AbiCoder } = await import('ethers');
    const provider = new JsonRpcProvider(cfg.api.votingRpcUrl);
    const tx = await provider.getTransaction(hash);
    if (!tx) return null;

    const abiCoder = AbiCoder.defaultAbiCoder();
    const decoded = decodeVoteCalldata(tx.data, abiCoder);
    if (!decoded) return null;
    const { proposalId, answerIndex } = decoded;

    // On-chain execution status + block timestamp. A reverted tx (status 0)
    // still exists and still decodes as a vote(...) — we MUST NOT report it as
    // a counted vote. classifyReceipt maps status→success/reverted/pending.
    let voteDate: string | null = null;
    const receipt = await provider.getTransactionReceipt(hash);
    const status = classifyReceipt(receipt);
    if (receipt?.blockNumber) {
      const block = await provider.getBlock(receipt.blockNumber);
      if (block?.timestamp) {
        voteDate = new Date(block.timestamp * 1000).toLocaleString('fr-FR', {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: 'Europe/Paris',
        });
      }
    }

    // Proposal metadata (title, variants, results). FreedomTool is cheap to
    // instantiate per call — no caching needed since we're network-aware.
    const { FreedomTool } = await import('@rarimo/rarime-rn-sdk');
    const ft = new FreedomTool(cfg);
    let proposal: ProposalInfo = await ft.getProposalInfo(proposalId);
    // The home list shows a twinned question (one id per voting contract)
    // once, with both counts added up. Show the same total here, so a card
    // vote on the card twin does not read as a lonely "1" when the pair has
    // twenty. The id stays the one the transaction voted.
    const [cached, index] = await Promise.all([readCachedProposals(net), readCachedIndex()]);
    const twinTable = { ...TWIN_PROPOSALS, ...(index ? twinsForNetwork(index, net) : {}) };
    const twinId = cached ? otherTwinId(pairProposals(cached, twinTable), proposalId) : undefined;
    if (twinId) {
      try {
        const twin = await ft.getProposalInfo(twinId);
        proposal = { ...proposal, votingResults: sumVotingResults(proposal.votingResults, twin.votingResults) };
      } catch (e: unknown) {
        console.warn(`[Vérifier] twin #${twinId} not loaded, showing #${proposalId} alone (${lookupErrorCode(e)})`);
      }
    }
    const variants = proposal.questions[0]?.variants ?? [];
    const votedFor = variants[answerIndex] ?? `Option ${answerIndex + 1}`;

    return { proposal, votedFor, answerIndex, txHash: hash, voteDate, network: net, status };
  }, []);

  const lookupVoteTx = useCallback(async () => {
    if (!txHashInput.trim()) return;
    Keyboard.dismiss();
    // Validated before any request: nothing that is not a vote serial number
    // (0x + 64 hex) reaches the RPC or the log.
    const hash = parseVoteTxHash(txHashInput);
    if (!hash) {
      setLookupResult(null);
      setTxLookupStatus('invalid');
      return;
    }
    setTxLookupStatus('loading');
    setLookupResult(null);

    // Use the user's active network — for prod users that's always Mainnet
    // (the network toggle in parametres.tsx:133 is gated behind devMode,
    // and DEFAULT_NETWORK is mainnet). Dev users who flip to Testnet are
    // intentionally looking at Testnet votes and we shouldn't silently
    // route them to Mainnet.
    try {
      const result = await tryLookupOnNetwork(hash, network);
      if (result) {
        setLookupResult(result);
        setTxLookupStatus('success');
      } else {
        setTxLookupStatus('not_found');
      }
    } catch (err) {
      // The code only: the ethers message quotes the request, hash included.
      console.warn(`[Vérifier] ${network} lookup failed (${lookupErrorCode(err)})`);
      setTxLookupStatus('error');
    }
  }, [txHashInput, network, tryLookupOnNetwork]);

  return (
    <View style={styles.screenContainer}>
      {/* `keyboardDismissMode="on-drag"`: on iPhone the serial field is the
          only input of the screen and nothing else dismissed its keyboard, so
          a voter who changed their mind had to submit to get rid of it, and
          the QA driver could not hide it at all ("Couldn't hide the keyboard",
          QA iPhone 2.0.2). A scroll now closes it, on both platforms. */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.contentContainer,
          keyboardInset > 0 ? { paddingBottom: keyboardInset + 24 + Spacing.tabBar.containerHeight } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Header */}
        <View style={styles.headerSection}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{t('verifier.title')}</Text>
            <SettingsButton />
          </View>
          <Text style={styles.headerDescription}>
            {t('verifier.description')}
          </Text>
        </View>

        {/* Search */}
        <View
          style={styles.lookupCard}
          onLayout={(e) => { lookupCardY.current = e.nativeEvent.layout.y; }}
        >
          <Text style={styles.lookupLabel}>{t('verifier.lookupLabel')}</Text>
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
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onFocus={() => {
                // Le clavier met un instant a se poser : on defile apres, sinon
                // la marge basse n'existe pas encore et le defilement bute.
                setTimeout(() => {
                  scrollRef.current?.scrollTo({ y: Math.max(0, lookupCardY.current - 12), animated: true });
                }, 120);
              }}
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            <TouchableOpacity
              // The screen title is the same word as this button
              // (verifier.title and verifier.cta are both "Vérifier"), so a
              // text selector in the QA automation landed on the title and
              // the button was never pressed. Named here once and for all.
              testID="verify-cta"
              accessibilityRole="button"
              style={[styles.lookupButton, !txHashInput.trim() && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={lookupVoteTx}
              disabled={!txHashInput.trim() || txLookupStatus === 'loading'}
            >
              {txLookupStatus === 'loading' ? (
                <ActivityIndicator size="small" color={colors.buttonText} />
              ) : (
                <Text style={styles.lookupButtonText}>{t('verifier.cta')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {txLookupStatus === 'invalid' && (
            <Text style={styles.lookupResultError}>{t('verifier.invalidHash')}</Text>
          )}

          {txLookupStatus === 'not_found' && (
            <Text style={styles.lookupResultError}>{t('verifier.notFound')}</Text>
          )}

          {txLookupStatus === 'error' && (
            <Text style={styles.lookupResultError}>{t('verifier.lookupError')}</Text>
          )}
        </View>

        {/* Result card */}
        {txLookupStatus === 'success' && lookupResult && (() => {
          const { proposal: p, votedFor, answerIndex, txHash, voteDate, status } = lookupResult;
          const active = isActive(p);
          const counted = status === 'success';
          const variants = p.questions[0]?.variants ?? [];
          const total = computeTotal(p.votingResults, variants.length);

          return (
            <View style={styles.resultCard}>
              {/* Vote confirmation — gated on the on-chain receipt status, NOT
                  merely on the tx existing. A reverted tx is shown red. */}
              {status === 'success' && (
                <View style={styles.voteConfirmation}>
                  <ShieldCheckIcon color={colors.successText} size={24} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.voteConfirmationTitle}>{t('verifier.voteVerified')}</Text>
                    <Text style={styles.voteConfirmationAnswer}>{t('verifier.voteVerifiedAnswer', { vote: votedFor })}</Text>
                    {voteDate && <Text style={styles.voteConfirmationDate}>{t('verifier.recordedOn', { date: voteDate })}</Text>}
                  </View>
                </View>
              )}
              {status === 'reverted' && (
                <View style={styles.voteConfirmationError}>
                  <AlertIcon color={colors.errorText} size={24} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.voteConfirmationTitleError}>{t('verifier.voteFailed')}</Text>
                    <Text style={styles.voteConfirmationAnswer}>{t('verifier.voteFailedDescription')}</Text>
                  </View>
                </View>
              )}
              {status === 'pending' && (
                <View style={styles.voteConfirmationPending}>
                  <AlertIcon color={colors.warningText} size={24} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.voteConfirmationTitlePending}>{t('verifier.votePending')}</Text>
                    <Text style={styles.voteConfirmationAnswer}>{t('verifier.votePendingDescription')}</Text>
                  </View>
                </View>
              )}

              {/* Poll info */}
              <View style={styles.pollSection}>
                <View style={styles.cardHeader}>
                  <View style={[styles.badge, active && styles.badgeActive]}>
                    <Text style={styles.badgeText} allowFontScaling={false}>{t(active ? 'home.badgeOngoing' : 'home.badgeFinished')}</Text>
                  </View>
                  <Text style={styles.pollId}>#{p.id}</Text>
                </View>

                <Text style={styles.pollTitle}>{p.title}</Text>

                {p.description ? (
                  <Text style={styles.pollDescription}>{p.description}</Text>
                ) : null}

                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>{t('verifier.votesCount')}</Text>
                    <Text style={styles.statValue}>{formatCount(total)}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>{t('verifier.optionsCount')}</Text>
                    <Text style={styles.statValue}>{variants.length}</Text>
                  </View>
                </View>

                {/* Results breakdown */}
                {variants.length > 0 && (
                  <View style={styles.variantsContainer}>
                    {variants.map((v: string, idx: number) => {
                      const count = p.votingResults?.[0]?.[idx] ? Number(p.votingResults[0][idx]) : 0;
                      const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                      const isThisVote = counted && idx === answerIndex;
                      return (
                        <View key={idx} style={[styles.variantRow, isThisVote && styles.variantRowHighlight]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                            {isThisVote && <ShieldCheckIcon color={colors.successText} size={14} />}
                            <Text style={[styles.variantName, isThisVote && styles.variantNameHighlight]} numberOfLines={1}>{v}</Text>
                          </View>
                          <Text style={[styles.variantCount, isThisVote && styles.variantCountHighlight]}>{formatCount(count)} ({pct}%)</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Blockchain link — point at the explorer for the network
                    where the tx actually landed (mainnet vs testnet have
                    different block explorers). */}
                <TouchableOpacity
                  style={styles.explorerLink}
                  activeOpacity={0.7}
                  onPress={() => Linking.openURL(`${getExplorerTxBaseUrl(lookupResult.network)}${txHash}`)}
                >
                  <Text style={styles.explorerText}>{t('verifier.viewTxOnChain')}</Text>
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
    // The tab bar is absolute over the bottom 120 dp (CustomTabBar): without
    // this the result card ends under it at the end of the scroll
    // (2026-09-25). Same padding as the home and "Comprendre".
    paddingBottom: Spacing.tabBar.containerHeight,
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
    color: colors.errorText,
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
    backgroundColor: colors.successBackground,
    borderRadius: 12,
    padding: 16,
  },
  voteConfirmationTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.successText,
  },
  voteConfirmationError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.errorBackground,
    borderRadius: 12,
    padding: 16,
  },
  voteConfirmationTitleError: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.errorText,
  },
  voteConfirmationPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.warningBackground,
    borderRadius: 12,
    padding: 16,
  },
  voteConfirmationTitlePending: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.body,
    color: colors.warningText,
  },
  voteConfirmationAnswer: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    color: colors.text,
    marginTop: 2,
  },
  voteConfirmationDate: {
    fontFamily: Typography.fontFamily.medium,
    fontSize: Typography.fontSize.small,
    color: colors.text,
    opacity: 0.6,
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
    backgroundColor: colors.successBackground,
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
    color: colors.successText,
  },
  variantCount: {
    fontFamily: Typography.fontFamily.semibold,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    color: colors.text,
  },
  variantCountHighlight: {
    color: colors.successText,
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
