import React, { useState } from 'react';
import { StyleSheet, ScrollView, View, Text, TouchableOpacity, Platform } from 'react-native';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { Svg, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import VotingModal from '@/components/voting-modal/VotingModal';

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

interface VoteResultsProps {
  ouiPercent: number;
  blancPercent: number;
  nonPercent: number;
  ouiCount: number;
  blancCount: number;
  nonCount: number;
}

const VoteResults = ({ ouiPercent, blancPercent, nonPercent, ouiCount, blancCount, nonCount }: VoteResultsProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const maxHeight = 64;
  const minHeight = 2;

  const calculateHeight = (percent: number) => {
    if (percent === 0) return minHeight;
    return Math.max(minHeight, (percent / 100) * maxHeight);
  };

  return (
    <View style={styles.resultsContainer}>
      <View style={styles.barsContainer}>
        <View style={styles.barWrapper}>
          <View style={[styles.bar, { height: calculateHeight(ouiPercent), backgroundColor: colors.voteBarOui }]}>
            <Text style={styles.barPercent}>{ouiPercent}%</Text>
          </View>
        </View>
        <View style={styles.barWrapper}>
          <View style={[styles.bar, { height: calculateHeight(blancPercent), backgroundColor: colors.voteBarBlanc }]}>
            <Text style={styles.barPercent}>{blancPercent}%</Text>
          </View>
        </View>
        <View style={styles.barWrapper}>
          <View style={[styles.bar, { height: calculateHeight(nonPercent), backgroundColor: colors.voteBarNon }]}>
            <Text style={styles.barPercent}>{nonPercent}%</Text>
          </View>
        </View>
      </View>
      <View style={styles.labelsContainer}>
        <Text style={styles.barLabel}>Oui</Text>
        <Text style={styles.barLabel}>Blanc</Text>
        <Text style={styles.barLabel}>Non</Text>
      </View>
      <View style={styles.countsContainer}>
        <Text style={styles.barCount}>{ouiCount.toLocaleString()}</Text>
        <Text style={styles.barCount}>{blancCount.toLocaleString()}</Text>
        <Text style={styles.barCount}>{nonCount.toLocaleString()}</Text>
      </View>
    </View>
  );
};

export default function AccueilScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const router = useRouter();
  const [isModalVisible, setIsModalVisible] = useState(false);

  const handleVoterPress = () => {
    if (Platform.OS === 'android') {
      // On Android, navigate to full-screen voting flow
      router.push('/voting-flow');
    } else {
      // On iOS, show bottom sheet modal
      setIsModalVisible(true);
    }
  };

  return (
    <View style={styles.screenContainer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer} bounces={false}>
        {/* Vote List Section */}
        <View style={styles.voteListSection}>
          <View style={styles.voteListHeader}>
            <Text style={styles.voteListTitle}>Les votes en cours</Text>
          </View>

          <TouchableOpacity style={styles.voteListItem} activeOpacity={0.7}>
            <Text style={styles.voteListItemText}>Les Zones à Fortes Emission (ZFE)</Text>
            <CaretRightIcon color={colors.secondary} size={Spacing.icon.size} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.voteListItem} activeOpacity={0.7}>
            <Text style={styles.voteListItemText}>La Politique Pluriannuelle de l'Energie (PPE)</Text>
            <CaretRightIcon color={colors.secondary} size={Spacing.icon.size} />
          </TouchableOpacity>
        </View>

        {/* Active Vote Card */}
        <View style={styles.voteCard}>
          <View style={styles.badgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Vote en cours</Text>
            </View>
            <Text style={styles.voteTitle}>Approuvez vous la Loi instaurant les zones à faibles émissions mobilité ?</Text>
          </View>

          <Text style={styles.voteDescription}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.{'\n\n'}
            Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
          </Text>

          <View style={styles.statsContainer}>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>Votes</Text>
              <Text style={styles.statValue}>6,932</Text>
            </View>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>Se termine dans</Text>
              <Text style={styles.statValue}>24J 12H 5M</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.voteButton} activeOpacity={0.8} onPress={handleVoterPress}>
            <Text style={styles.voteButtonText}>Voter</Text>
          </TouchableOpacity>

          <VoteResults
            ouiPercent={76.8}
            blancPercent={4.3}
            nonPercent={18.9}
            ouiCount={5327}
            blancCount={298}
            nonCount={1308}
          />
        </View>

        {/* Upcoming Vote Card */}
        <View style={styles.voteCard}>
          <View style={styles.badgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Bientôt</Text>
            </View>
            <Text style={styles.voteTitle}>Approuvez vous la Loi instaurant les zones à faibles émissions mobilité ?</Text>
          </View>

          <Text style={styles.voteDescription}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.{'\n\n'}
            Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.{'\n\n'}
            Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
          </Text>

          <View style={styles.statsContainer}>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>Commence</Text>
              <Text style={styles.statValue}>01 Dec 25</Text>
            </View>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>Terminé</Text>
              <Text style={styles.statValue}>01 Feb 26</Text>
            </View>
          </View>
        </View>

        {/* Finished Vote Card */}
        <View style={styles.voteCard}>
          <View style={styles.badgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Terminé</Text>
            </View>
            <Text style={styles.voteTitle}>Approuvez vous la troisième Programmation pluriannuelle énergétique (PPE) ?</Text>
          </View>

          <Text style={styles.voteDescription}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </Text>

          <View style={styles.statsContainer}>
            <View style={[styles.statColumn, { flex: 1 }]}>
              <Text style={styles.statLabel}>Terminé</Text>
              <Text style={styles.statValue}>01 Sep 25</Text>
            </View>
          </View>

          <VoteResults
            ouiPercent={76.8}
            blancPercent={4.3}
            nonPercent={18.9}
            ouiCount={5327}
            blancCount={298}
            nonCount={1308}
          />
        </View>

        {/* Empty spacer for tab bar */}
        <View style={styles.tabBarSpacer} />
      </ScrollView>

      <VotingModal
        isVisible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
      />
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
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
