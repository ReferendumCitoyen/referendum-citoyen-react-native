import React, { useEffect } from 'react';
import { StyleSheet, ScrollView, View, Text } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Accordion from '@/components/Accordion';
import { Colors, Typography, Spacing } from '@/constants/theme';

export default function ComprendreScreen() {
  const player = useVideoPlayer(require('@/assets/images/kling_20250904_Image_to_Video_A_playful__5643_0.mp4'), player => {
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
          <Text style={styles.headerTitle}>Bienvenue!</Text>
          <View style={styles.welcomeContainer}>
            <VideoView
              style={styles.characterVideo}
              player={player}
              contentFit="cover"
              nativeControls={false}
            />
            <View style={styles.welcomeTextContainer}>
              <Text style={styles.welcomeText}>
                Nous appelons tous les citoyens à voter lors d'un référendum sur des sujets d'actualité
              </Text>
            </View>
          </View>
        </View>

        {/* Accordion Sections */}
        <Accordion
          title="Un vote unique et infalsifiable"
          content="Le vote se fait par lecture de la puce de votre carte d'identité (pas de passeport pour éviter les votes doubles) - qui reste sur votre téléphone - pour garantir que:&#10;1. Vous êtes français et majeur&#10;2. Personne ne peut voter deux fois"
          showBorder={true}
        />

        <Accordion
          title="Un vote garanti anonyme"
          content="Le vote se fait par lecture de la puce de votre carte d'identité (pas de passeport pour éviter les votes doubles) - qui reste sur votre téléphone - pour garantir que:&#10;1. Vous êtes français et majeur&#10;2. Personne ne peut voter deux fois"
          showBorder={true}
        />

        <Accordion
          title="Un vote transparent"
          content="Le vote se fait par lecture de la puce de votre carte d'identité (pas de passeport pour éviter les votes doubles) - qui reste sur votre téléphone - pour garantir que:&#10;1. Vous êtes français et majeur&#10;2. Personne ne peut voter deux fois"
          showBorder={true}
        />

        <Accordion
          title="Les autres peuvent voter sur votre référendum"
          content="Le vote se fait par lecture de la puce de votre carte d'identité (pas de passeport pour éviter les votes doubles) - qui reste sur votre téléphone - pour garantir que:&#10;1. Vous êtes français et majeur&#10;2. Personne ne peut voter deux fois"
          showBorder={true}
        />

        <Accordion
          title="Que se passe-t-il une fois les votes comptés ?"
          content="Le vote se fait par lecture de la puce de votre carte d'identité (pas de passeport pour éviter les votes doubles) - qui reste sur votre téléphone - pour garantir que:&#10;1. Vous êtes français et majeur&#10;2. Personne ne peut voter deux fois"
          showBorder={true}
        />

        {/* Final Section - D'où ça vient */}
        <View style={styles.finalSection}>
          <Text style={styles.finalSectionTitle}>D'où ça vient</Text>
          <Text style={styles.finalSectionContent}>
            Alexandre Jardin (écrivain, fondateur du mouvement #LesGueux) est convaincu par son fils Robinson Jardin (ex-NordVPN et actuel Nym) du potentiel de la blockchain pour mettre en place une démocratie directe sans attendre.{'\n\n'}
            Ils s'associent avec Alexis Roussel (penseur phare de la démocratie numérique suisse et co-fondateur de Nym) qui établit le cahier des charges de cette application.{'\n\n'}
            Application en logiciel libre{'\n'}
            Logiciel hébergé par le Parti Pirate Suisse{'\n'}
            Traitement de données local - GDPR
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
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
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
    width: 71,
    height: 100,
    borderRadius: 8,
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
    fontFamily: Typography.fontFamily.medium,
    fontWeight: Typography.fontWeight.bold,
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
