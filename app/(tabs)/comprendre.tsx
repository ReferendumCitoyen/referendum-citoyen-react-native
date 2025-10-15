import React, { useEffect } from 'react';
import { StyleSheet, ScrollView, View, Text } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Accordion from '@/components/Accordion';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { comprendreContent } from '@/constants/comprendreContent';

export default function ComprendreScreen() {
  const player = useVideoPlayer(require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5643_0.mp4'), player => {
    player.loop = false;
    player.muted = true;
    player.play();
  });

  useEffect(() => {
    const subscription = player.addListener('playingChange', (newStatus) => {
      if (newStatus.isPlaying === false && player.currentTime >= player.duration - 0.1) {
        // Video finished, wait 30 seconds before replaying
        setTimeout(() => {
          player.currentTime = 0;
          player.play();
        }, 30000);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  return (
    <View style={styles.screenContainer}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.headerTitle}>{comprendreContent.welcome.title}</Text>
          <View style={styles.welcomeContainer}>
            <VideoView
              style={styles.characterVideo}
              player={player}
              contentFit="cover"
              nativeControls={false}
            />
            <View style={styles.welcomeTextContainer}>
              <Text style={styles.welcomeText}>
                {comprendreContent.welcome.text}
              </Text>
            </View>
          </View>
        </View>

        {/* Accordion Sections */}
        {comprendreContent.accordions.map((accordion, index) => (
          <Accordion
            key={index}
            title={accordion.title}
            content={accordion.content}
            showBorder={true}
          />
        ))}

        {/* Final Section - D'où ça vient */}
        <View style={styles.finalSection}>
          <Text style={styles.finalSectionTitle}>{comprendreContent.origin.title}</Text>
          <Text style={styles.finalSectionContent}>
            {comprendreContent.origin.content}
          </Text>
        </View>

        {/* Empty spacer for tab bar */}
        <View style={styles.tabBarSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: Spacing.tabBar.containerHeight,
  },
  headerSection: {
    backgroundColor: Colors.white,
    paddingTop: Spacing.screen.top,
    paddingHorizontal: Spacing.screen.horizontal,
    paddingBottom: Spacing.screen.bottom,
    gap: Spacing.screen.gap,
  },
  headerTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: Colors.primary,
  },
  welcomeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.screen.gap,
    backgroundColor: Colors.white,
  },
  characterVideo: {
    width: Spacing.video.characterWidth,
    height: Spacing.video.characterHeight,
    borderRadius: Spacing.video.borderRadius,
  },
  welcomeTextContainer: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  welcomeText: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: Colors.primary,
  },
  finalSection: {
    backgroundColor: Colors.white,
    padding: Spacing.accordion.padding,
    gap: Spacing.accordion.gap,
  },
  finalSectionTitle: {
    fontFamily: Typography.fontFamily.bold,
    fontSize: Typography.fontSize.h1,
    lineHeight: Typography.lineHeight.h1,
    letterSpacing: Typography.letterSpacing.h1,
    color: Colors.primary,
  },
  finalSectionContent: {
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.medium,
    fontSize: Typography.fontSize.body,
    lineHeight: Typography.lineHeight.body,
    letterSpacing: Typography.letterSpacing.body,
    color: Colors.primary,
  },
  tabBarSpacer: {
    height: Spacing.tabBar.containerHeight,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
});
