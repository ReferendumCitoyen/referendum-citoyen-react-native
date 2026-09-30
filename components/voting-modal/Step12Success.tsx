import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, LayoutChangeEvent, ScrollView, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { ProposalInfo } from '@rarimo/rarime-rn-sdk';
import { createModalStyles, createStepSpecificStyles, slideBoxStyle, slideFooterStyle } from './styles';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { useTranslation } from 'react-i18next';
import { formatCount } from '@/utils/format-count';
import { computeVoteResults } from '@/utils/voteResults';
import { readCachedProposals } from '@/utils/proposal-cache';
import { readLocalProposalIndex } from '@/utils/proposal-index';
import { localEligibilityContext, pickNextProposal } from '@/utils/vote-eligibility';
import { openContactEmail } from '@/utils/open-contact-email';
import { SuccessReportButton } from '@/components/SuccessReportButton';
import { isBetaBuild } from '@/constants/app-flavour';
import SiteLinkCard from '@/components/SiteLinkCard';
import { CONTRIBUTE_URL } from '@/constants/urls';
import type { Network } from '@/constants/rarime-config';

interface Step12SuccessProps {
  /** false = tx submitted but not yet confirmed on-chain (timeout). Shows a
   * neutral "awaiting confirmation" banner instead of definitive success, and
   * hides the results — they cannot include a vote that has not landed. */
  confirmed?: boolean;
  containerWidth: number;
  voteIdentifier?: string;
  /** Dismisses the flow. Only rendered on Android, which has no header. */
  onClose?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Available slide-area height; caps the iOS ScrollView so content scrolls
   * instead of overflowing the sheet. */
  slideAreaHeight?: number;
  /** The proposal just voted on — supplies the question, tallies and end date. */
  proposalInfo?: ProposalInfo;
  /** Index of the variant the user chose, for the check badge and the
   * optimistic +1 below. */
  answerIndex?: number;
  /** Picks the right cache namespace for the "another referendum" card. */
  network?: Network;
  /** Opens the voting flow for a different proposal. A twinned question hands
   * over both ids, like the home, so each document goes to its own contract. */
  onVoteAnother?: (proposalId: string, cardProposalId?: string) => void;
  /** The document just used: the suggestion must be votable with it. */
  isPassportFlow?: boolean;
  /** devMode && isBetaBuild(), computed by the flow (utils/vote-eligibility.ts). */
  devAllowed?: boolean;
  /** Sends the user to the Vérifier tab. */
  onVerify?: () => void;
  /**
   * True when THIS run registered the document for the first time — i.e. the
   * moment its key stopped being a local detail and started being the only
   * thing that can ever vote with that document again.
   *
   * Gated on that rather than shown after every vote, because a notice a user
   * has already dismissed four times is a notice they no longer read. Comes
   * from Step 7, which is the only place that knows the difference (it checks
   * `DocumentStatus.NotRegistered` before deciding to register at all).
   */
  justRegistered?: boolean;
  /** Opens key management so the user can export a backup. Rendered only
   * alongside `justRegistered`; absent means the card is not shown. */
  onBackupKey?: () => void;
}

const BAR_MAX_HEIGHT = 72;
const BAR_MIN_HEIGHT = 6;

/** Total votes cast on a proposal, used to rank "most popular". */
const totalVotesOf = (p: ProposalInfo): number =>
  computeVoteResults(p.votingResults, p.questions[0]?.variants?.length ?? 0).total;

/** "0x8f2b…f2537" — long enough to recognise, short enough for one line. */
const shortenIdentifier = (id: string): string =>
  id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-5)}`;

const Step12Success: React.FC<Step12SuccessProps> = ({
  containerWidth,
  voteIdentifier,
  confirmed = true,
  onClose,
  onLayout,
  slideAreaHeight,
  proposalInfo,
  answerIndex,
  network,
  onVoteAnother,
  onVerify,
  justRegistered,
  onBackupKey,
  isPassportFlow = false,
  devAllowed = false,
}) => {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const modalStyles = createModalStyles(colors);
  const stepSpecificStyles = createStepSpecificStyles(colors);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!voteIdentifier) return;
    await Clipboard.setStringAsync(voteIdentifier);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [voteIdentifier]);

  // Annotated because ProposalInfo resolves to an error type — the SDK does not
  // actually export it (a pre-existing problem shared with 10 other files), so
  // without this every map callback below would be an implicit any.
  const variants: string[] = proposalInfo?.questions[0]?.variants ?? [];

  // Live tallies, with the user's own vote added to their chosen variant.
  //
  // The vote reaches the chain asynchronously (and in this beta not at all —
  // see constants/mock-backend.ts), so the tallies we just fetched cannot
  // include it. Showing them untouched means someone who votes Oui watches the
  // Oui count fail to move on the very screen that tells them their vote was
  // validated. The +1 is presentation only — nothing is written anywhere, and
  // it is exactly what the chain will report once the tx settles.
  const results = useMemo(() => {
    const base = computeVoteResults(proposalInfo?.votingResults, variants.length);
    if (!variants.length) return base;
    const idx = answerIndex ?? -1;
    if (idx < 0 || idx >= variants.length) return base;

    const counts = base.counts.length === variants.length
      ? [...base.counts]
      : new Array(variants.length).fill(0);
    counts[idx] += 1;
    const total = counts.reduce((sum, c) => sum + c, 0);
    const percents = counts.map((c) => (total > 0 ? (c / total) * 100 : 0));
    return { counts, percents, total };
  }, [proposalInfo?.votingResults, variants.length, answerIndex]);

  // French-flag order for the standard Oui / Blanc / Non ballot, which is what
  // every proposal in this app uses. Anything else falls back to the shared
  // chart palette rather than inventing colours.
  //
  // Literal hexes rather than theme tokens: these are flag colours, so they
  // must not follow the theme. colors.white in particular is swapped to black
  // in dark mode, which would render the "Blanc" bar black.
  const isFlagBallot = variants.length === 3;
  const barColorFor = useCallback(
    (idx: number): string =>
      isFlagBallot
        ? ['#0B4FA8', '#FFFFFF', '#D5262C'][idx]
        : colors.chartPalette[idx % colors.chartPalette.length],
    [isFlagBallot, colors.chartPalette],
  );

  const endDateLabel = useMemo(() => {
    if (!proposalInfo) return null;
    const end = Number(proposalInfo.startTimestamp) + Number(proposalInfo.duration);
    return new Date(end * 1000).toLocaleDateString(i18n.language || 'fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, [proposalInfo, i18n.language]);

  // The "another referendum" card. Read from the proposal cache the home screen
  // already populates and from the index this phone already holds, so this
  // never blocks the screen on a network call. It used to offer the most-voted
  // proposal open on chain dates, which was #54 (a closed June question on the
  // passport contract) for every card voter; the candidate now has to pass the
  // same eligibility rule as the home, the flow and the proof
  // (utils/vote-eligibility.ts), for the document just used. Nothing
  // qualifies, or anything cannot be decided locally: no card.
  const [otherProposal, setOtherProposal] = useState<{
    proposal: ProposalInfo;
    proposalId: string;
    cardProposalId?: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!network) return;
      try {
        const [list, index] = await Promise.all([readCachedProposals(network), readLocalProposalIndex()]);
        if (!list || cancelled) return;
        const choice = pickNextProposal<ProposalInfo>({
          list,
          justVotedId: proposalInfo?.id,
          document: isPassportFlow ? 'passport' : 'idCard',
          ctx: localEligibilityContext(index, network, devAllowed),
          votesOf: totalVotesOf,
        });
        if (!cancelled) setOtherProposal(choice);
      } catch {
        // Constant text only: nothing about the candidates goes to the log.
        console.warn('[Step12Success] no suggestion: local lists unreadable');
        if (!cancelled) setOtherProposal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [network, proposalInfo?.id, isPassportFlow, devAllowed]);

  const styles = stepSpecificStyles;

  return (
    <View
      style={[
        { width: containerWidth },
        // iOS: exactly the measured slide area. Android: the same box
        // (2026-09-25; with a minHeight only, the scroll grew to its content
        // and carried the Android "Fermer" past the bottom of a 360 x 640
        // screen at text size 1.3, unreachable).
        slideBoxStyle(slideAreaHeight),
      ]}
      onLayout={onLayout}
    >
      <ScrollView
        style={{ width: '100%', flex: 1 }}
        contentContainerStyle={styles.step12Scroll}
        bounces={false}
      >
        {/* Thank-you, above the confirmation itself — a beta tester asked for it at
            the top of the page. It says something the banner deliberately does
            not: the banner reports what happened, this asks the reader to do
            something about it. */}
        {confirmed && (
          <View style={styles.step12Thanks}>
            <Text style={styles.step12ThanksTitle}>{t('voting.step12ThanksTitle')}</Text>
            <Text style={styles.step12ThanksBody}>{t('voting.step12ThanksBody')}</Text>
            <TouchableOpacity
              style={styles.step12ContactButton}
              activeOpacity={0.8}
              onPress={() => openContactEmail(t)}
              accessibilityRole="button"
            >
              <Text style={styles.step12ContactButtonText}>{t('settings.contact')}</Text>
            </TouchableOpacity>
            {/* The logs of a vote that WORKED, with the query proof attached
                unredacted. Failures have had this for months; the verifier
                author needs the working case. Opt-in: nothing is sent until
                the tester taps. */}
            {isBetaBuild() && (
              <SuccessReportButton
                context={{ step: 12, network: network ?? null, proposalId: proposalInfo?.id }}
              />
            )}
          </View>
        )}

        {/* Contribute. A link to the website, nothing more: no payment in the
            app (App Store rules) and no identifier of any kind in the URL, so
            a contribution can never be tied to a vote. Only once the vote is
            confirmed — asking next to "awaiting confirmation" reads as a
            paywall. */}

        {/* Success banner */}
        <View style={confirmed ? styles.step12Banner : styles.step12BannerPending}>
          <View style={styles.step12BannerIcon}>
            <Text style={styles.step12BannerCheck} allowFontScaling={false}>
              {confirmed ? '✓' : '…'}
            </Text>
          </View>
          <View style={styles.step12BannerBody}>
            <Text style={styles.step12BannerTitle}>
              {t(confirmed ? 'voting.step12SuccessTitle' : 'voting.step12PendingTitle')}
            </Text>
            {voteIdentifier ? (
              <View style={styles.step12SerialRow}>
                <Text style={styles.step12Serial} numberOfLines={1}>
                  {t('voting.step12SerialPrefix', { id: shortenIdentifier(voteIdentifier) })}
                </Text>
                <Text style={styles.step12SerialDot}> · </Text>
                <TouchableOpacity onPress={handleCopy} activeOpacity={0.7} accessibilityRole="button">
                  <Text style={styles.step12SerialCopy}>
                    {copied ? t('voting.step12VoteIdCopied') : t('voting.step12VoteIdCopy')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* Key backup. Only after a first registration — see `justRegistered`.
            Placed directly under the confirmation, above the results, because
            it is the one thing on this screen the user still has to do and the
            results below are long enough to push it out of sight. */}
        {justRegistered && onBackupKey ? (
          <View style={styles.step12Backup}>
            <Text style={styles.step12BackupTitle}>
              {t('voting.step12BackupTitle', {
                defaultValue: 'Sauvegardez votre accès',
              })}
            </Text>
            <Text style={styles.step12BackupBody}>
              {t('voting.step12BackupBody', {
                defaultValue:
                  'Votre pièce d’identité est désormais liée à une clé conservée sur ce téléphone. ' +
                  'Si vous changez d’appareil ou réinstallez l’application sans sauvegarde, ' +
                  'vous ne pourrez plus voter avec cette pièce.',
              })}
            </Text>
            <TouchableOpacity
              style={styles.step12BackupButton}
              onPress={onBackupKey}
              activeOpacity={0.8}
            >
              <Text style={styles.step12BackupButtonText}>
                {t('voting.step12BackupCta', {
                  defaultValue: 'Sauvegarder maintenant',
                })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* La demande de contribution, APRES la confirmation et apres
            l'avertissement sur la sauvegarde de la cle, depuis le 24/09/2026.
            Elle etait placee avant les deux. La campagne QA du 23/09 l'a
            trouvee en taille de texte accessibilite : la personne qui vient de
            voter voyait le bloc de don et devait faire defiler pour lire que
            son vote etait valide, et plus loin encore pour apprendre qu'elle
            doit sauvegarder sa cle sous peine de ne plus jamais pouvoir voter
            avec cette carte. Demander de l'argent avant d'avoir confirme le
            vote et avant d'avoir prevenu du risque, c'est l'ordre qu'il ne faut
            pas. Les remerciements restent en haut : c'est une demande explicite
            d'un testeur, et ils ne demandent rien.
            Contenu inchange. */}
        {confirmed && (
          <View style={styles.step12Contribute}>
            <SiteLinkCard
              text={t('voting.step12ContributeBody')}
              buttonLabel={t('voting.step12ContributeCta')}
              url={CONTRIBUTE_URL}
            />
          </View>
        )}

        {/* Live results — only meaningful once the vote is actually counted. */}
        {confirmed && variants.length > 0 && (
          <View style={styles.step12Section}>
            <Text style={styles.step12SectionTitle}>{t('voting.step12ResultsTitle')}</Text>
            {proposalInfo?.title ? (
              <Text style={styles.step12Question}>{proposalInfo.title}</Text>
            ) : null}

            <View style={styles.step12Bars}>
              {variants.map((_, idx) => (
                <View key={idx} style={styles.step12BarColumn}>
                  <Text style={styles.step12BarPercent}>
                    {(results.percents[idx] ?? 0).toFixed(1)}%
                  </Text>
                  <View
                    style={[
                      styles.step12Bar,
                      {
                        height: Math.max(
                          BAR_MIN_HEIGHT,
                          ((results.percents[idx] ?? 0) / 100) * BAR_MAX_HEIGHT,
                        ),
                        backgroundColor: barColorFor(idx),
                        // The white "Blanc" bar needs an outline to read at all
                        // against the white sheet.
                        borderWidth: isFlagBallot && idx === 1 ? 1 : 0,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                </View>
              ))}
            </View>

            <View style={styles.step12Bars}>
              {variants.map((v, idx) => (
                <View key={idx} style={styles.step12BarColumn}>
                  <View style={styles.step12BarLabelRow}>
                    <Text style={styles.step12BarLabel} numberOfLines={2}>
                      {v}
                    </Text>
                    {idx === answerIndex && (
                      <Text
                        style={styles.step12BarChosen}
                        allowFontScaling={false}
                        accessibilityLabel={t('voting.step12YourChoice')}
                      >
                        {' ✓'}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.step12BarCount}>
                    {formatCount(results.counts[idx] ?? 0, i18n?.language)}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={styles.step12Meta}>
              {t('voting.step12ResultsMeta', {
                votes: formatCount(results.total, i18n?.language),
                date: endDateLabel ?? '',
              })}
            </Text>
          </View>
        )}

        {/* One other referendum to vote on next */}
        {otherProposal && (
          <View style={styles.step12Section}>
            <View style={styles.step12Divider} />
            <Text style={styles.step12NextLabel}>{t('voting.step12NextLabel')}</Text>
            <View style={styles.step12Card}>
              <View style={styles.step12CardHeader}>
                <View style={styles.step12CardBadge}>
                  <Text style={styles.step12CardBadgeText}>{t('home.badgeOngoing')}</Text>
                </View>
                <Text style={styles.step12CardVotes}>
                  {t('voting.step12CardVotes', { votes: formatCount(totalVotesOf(otherProposal.proposal), i18n?.language) })}
                </Text>
              </View>
              <Text style={styles.step12CardTitle}>{otherProposal.proposal.title}</Text>
              <TouchableOpacity
                style={styles.step12CardButton}
                activeOpacity={0.8}
                onPress={() => onVoteAnother?.(otherProposal.proposalId, otherProposal.cardProposalId)}
              >
                <Text style={styles.step12CardButtonText}>{t('home.voteButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={onVerify}
          activeOpacity={0.7}
          accessibilityRole="link"
          style={styles.step12VerifyLink}
        >
          <Text style={styles.step12VerifyText}>{t('voting.step12VerifyLink')}</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Android has no navigation chrome at this step (the header with
          "Fermer" is iOS-only and the bottom nav stops after step 3), so
          without this the only way out is the system back gesture. In a fixed
          footer under the scroll (2026-09-25): the way out never moves, the
          content above scrolls. */}
      {Platform.OS !== 'ios' && (
        <View style={slideFooterStyle(colors, Spacing.modal.contentPaddingHorizontal)}>
          <TouchableOpacity
            style={[modalStyles.step12AndroidClose, { marginTop: 0 }]}
            activeOpacity={0.8}
            onPress={onClose}
          >
            <Text style={modalStyles.step12AndroidCloseText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default Step12Success;
