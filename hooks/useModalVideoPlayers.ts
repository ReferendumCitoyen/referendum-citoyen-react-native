import { useCallback } from 'react';
import { useVideoPlayer } from 'expo-video';

export function useModalVideoPlayers() {
  // Initialize all video players with preloading
  const player1 = useVideoPlayer(
    require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4846_0.mp4'),
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  const player2 = useVideoPlayer(
    require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__4900_0.mp4'),
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  const player3 = useVideoPlayer(
    require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5078_0.mp4'),
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  const player4 = useVideoPlayer(
    require('@/assets/videos/phoneOverCard.mp4'),
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  const player5 = useVideoPlayer(
    require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5198_0.mp4'),
    player => {
      player.loop = true;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      player.pause();
    }
  );

  const handleStepChange = useCallback((nextStep: number) => {
    // Handle video playback for each step
    switch (nextStep) {
      case 1:
        player1.play();
        break;
      case 2:
        player1.pause();
        player2.play();
        break;
      case 3:
        player2.pause();
        player3.play();
        break;
      case 4:
        player3.pause();
        player1.play();
        break;
      case 5:
        player1.pause();
        break;
      case 6:
        player4.play();
        break;
      case 7:
        player4.pause();
        player5.play();
        break;
      case 9:
        player3.play();
        break;
      case 10:
        player3.pause();
        break;
    }
  }, [player1, player2, player3, player4, player5]);

  const pauseAll = useCallback(() => {
    player1.pause();
    player2.pause();
    player3.pause();
    player4.pause();
    player5.pause();
  }, [player1, player2, player3, player4, player5]);

  const pauseVerificationVideo = useCallback(() => {
    player5.pause();
  }, [player5]);

  return {
    players: { player1, player2, player3, player4, player5 },
    handleStepChange,
    pauseAll,
    pauseVerificationVideo,
  };
}
