import React, { useEffect } from 'react';
import { StyleSheet, ScrollView, View, Text } from 'react-native';
import { VideoView } from 'expo-video';
import Accordion from '@/components/Accordion';
import { useColors, Typography, Spacing } from '@/constants/theme';
import { useComprendreVideo } from '@/contexts/VideoContext';
import { useTranslation } from 'react-i18next';
import SettingsButton from '@/components/SettingsButton';

export default function ComprendreScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = createStyles(colors);
  const player = useComprendreVideo();
  const sectionsRaw = t('comprendre.sections', { returnObjects: true });
  const sections = Array.isArray(sectionsRaw)
    ? (sectionsRaw as {
        title: string;
        intro?: string;
        accordions: { title: string; content: string }[];
      }[])
    : [];

  useEffect(() => {
    if (!player) return;

    // Start playing when screen is mounted
    try {
      player.play();
    } catch (error) {
      console.log('Error playing video:', error);
    }

    return () => {
      // Pause when leaving screen
      try {
        player.pause();
        player.currentTime = 0;
      } catch (error) {
        console.log('Error pausing video:', error);
      }
    };
  }, [player]);

  useEffect(() => {
    if (!player) return;

    let subscription: any;
    try {
      subscription = player.addListener('playingChange', (newStatus) => {
        if (newStatus.isPlaying === false && player.currentTime >= player.duration - 0.1) {
          // Video finished, wait 30 seconds before replaying
          setTimeout(() => {
            try {
              player.currentTime = 0;
              player.play();
            } catch (error) {
              console.log('Error replaying video:', error);
            }
          }, 30000);
        }
      });
    } catch (error) {
      console.log('Error adding listener:', error);
    }

    return () => {
      if (subscription) {
        try {
          subscription.remove();
        } catch (error) {
          console.log('Error removing listener:', error);
        }
      }
    };
  }, [player]);

  return (
    <View style={styles.screenContainer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer} bounces={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{t('comprendre.welcome.title')}</Text>
            <SettingsButton />
          </View>
          <View style={styles.welcomeContainer}>
            <VideoView
              style={styles.characterVideo}
              player={player}
              contentFit="cover"
              nativeControls={false}
              surfaceType="textureView"
            />
            <View style={styles.welcomeTextContainer}>
              <Text style={styles.welcomeText}>
                {t('comprendre.welcome.text')}
              </Text>
            </View>
          </View>
        </View>

        {/* Sections — each with a pillar header, optional intro paragraph, and a list of Q/A accordions */}
        {sections.map((section, sIdx) => (
          <View key={sIdx} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.intro ? (
              <Text style={styles.sectionIntro}>{section.intro}</Text>
            ) : null}
            {section.accordions.map((accordion, aIdx) => (
              <Accordion
                key={aIdx}
                title={accordion.title}
                content={accordion.content}
                showBorder={true}
              />
            ))}
          </View>
        ))}

        {/* Empty spacer for tab bar */}
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
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: Spacing.tabBar.containerHeight,
  },
  headerSection: {
    backgroundColor: colors.cardBackground,
    paddingTop: Spacing.screen.top,
    paddingHorizontal: Spacing.screen.horizontal,
    paddingBottom: Spacing.screen.bottom,
    gap: Spacing.screen.gap,
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
  welcomeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.screen.gap,
    backgroundColor: colors.cardBackground,
  },
  characterVideo: {
    width: Spacing.video.characterWidth,
    height: Spacing.video.characterHeight,
    borderRadius: Spacing.video.borderRadius,
  },
  welcomeTextContainer: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.cardBackground,
  },
  welcomeText: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
  },
  section: {
    backgroundColor: colors.cardBackground,
    paddingTop: Spacing.accordion.padding,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.accordion.padding,
    paddingBottom: Spacing.accordion.gap,
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: colors.text,
  },
  sectionIntro: {
    paddingHorizontal: Spacing.accordion.padding,
    paddingBottom: Spacing.accordion.gap,
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: colors.text,
  },
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
});
