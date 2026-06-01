import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useVideoPlayer } from 'expo-video';

export function useModalVideoPlayers() {
  const isAndroid = Platform.OS === 'android';

  // Create video players - on Android, some might be null if videos don't load
  // Video 1 - Not working on Android, use null
  const player1 = useVideoPlayer(
    Platform.select({
      ios: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4846_0.mp4'),
      android: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0_android.mp4'), // Use working video 2 as fallback
    })!,
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  // Video 2 - Working on Android
  const player2 = useVideoPlayer(
    Platform.select({
      ios: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0.mp4'),
      android: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0_android.mp4'),
    })!,
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  // Video 3 - Not working on Android, use video 2 as fallback
  const player3 = useVideoPlayer(
    Platform.select({
      ios: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5078_0.mp4'),
      android: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0_android.mp4'), // Use working video 2 as fallback
    })!,
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  // Video 4 - Not working on Android, use video 2 as fallback
  const player4 = useVideoPlayer(
    Platform.select({
      ios: require('@/assets/videos/phoneOverCard.mp4'),
      android: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0_android.mp4'), // Use working video 2 as fallback
    })!,
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  // Video 5 - Not working on Android, use video 2 as fallback
  const player5 = useVideoPlayer(
    Platform.select({
      ios: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5198_0.mp4'),
      android: require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0_android.mp4'), // Use working video 2 as fallback
    })!,
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  // Intro video — full-bleed clip that plays *above* the Step 4 "Démarrer
  // l'analyse" content as a teaching screen. Same source for both platforms;
  // Android uses a re-muxed .mp4 (H.264 Baseline, faststart) so Media3
  // ExoPlayer takes the standard MP4 extractor path and hardware-decodes via
  // MediaCodec on every device.
  const playerIntro = useVideoPlayer(
    Platform.select({
      ios: require('@/assets/videos/intro-passport-flow.mov'),
      android: require('@/assets/videos/intro-passport-flow.mp4'),
    })!,
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  const handleStepChange = useCallback((nextStep: number) => {
    // On Android, add small delay to let player initialize before playing
    const playDelay = isAndroid ? 100 : 0;

    const safePlay = (player: any) => {
      setTimeout(() => {
        try {
          if (player && typeof player.play === 'function') {
            player.play();
          }
        } catch (e) { /* Ignore errors from released players */ }
      }, playDelay);
    };

    const safePause = (player: any) => {
      try {
        if (player && typeof player.pause === 'function') {
          player.pause();
        }
      } catch (e) { /* Ignore errors from released players */ }
    };

    // Handle video playback for each step
    switch (nextStep) {
      case 1:
        safePlay(player1);
        break;
      case 2:
        safePause(player1);
        safePlay(player2);
        break;
      case 3:
        safePause(player2);
        safePlay(player3);
        break;
      case 4:
        safePause(player3);
        safePlay(player1);
        // Step 4 has an iOS-only intro phase that plays the intro video
        // ahead of the existing card content. Kick it off in parallel so
        // the user sees motion the instant the slide arrives.
        safePlay(playerIntro);
        break;
      case 5:
        safePause(player1);
        safePause(playerIntro);
        break;
      case 6:
        safePlay(player4);
        break;
      case 7:
        safePause(player4);
        safePlay(player5);
        break;
      case 9:
        safePlay(player3);
        break;
      case 10:
        safePause(player3);
        break;
    }
  }, [player1, player2, player3, player4, player5, playerIntro, isAndroid]);

  const pauseAll = useCallback(() => {
    try {
      if (player1 && typeof player1.pause === 'function') {
        player1.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
    try {
      if (player2 && typeof player2.pause === 'function') {
        player2.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
    try {
      if (player3 && typeof player3.pause === 'function') {
        player3.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
    try {
      if (player4 && typeof player4.pause === 'function') {
        player4.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
    try {
      if (player5 && typeof player5.pause === 'function') {
        player5.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
    try {
      if (playerIntro && typeof playerIntro.pause === 'function') {
        playerIntro.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
  }, [player1, player2, player3, player4, player5, playerIntro]);

  const pauseVerificationVideo = useCallback(() => {
    try {
      if (player5 && typeof player5.pause === 'function') {
        player5.pause();
      }
    } catch (e) { /* Ignore errors from released players */ }
  }, [player5]);

  return {
    players: { player1, player2, player3, player4, player5, playerIntro },
    handleStepChange,
    pauseAll,
    pauseVerificationVideo,
  };
}
