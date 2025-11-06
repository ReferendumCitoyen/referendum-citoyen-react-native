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

  const handleStepChange = useCallback((nextStep: number) => {
    // On Android, add small delay to let player initialize before playing
    const playDelay = isAndroid ? 100 : 0;

    // Handle video playback for each step
    switch (nextStep) {
      case 1:
        setTimeout(() => {
          try { player1.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 2:
        player1.pause();
        setTimeout(() => {
          try { player2.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 3:
        player2.pause();
        setTimeout(() => {
          try { player3.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 4:
        player3.pause();
        setTimeout(() => {
          try { player1.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 5:
        player1.pause();
        break;
      case 6:
        setTimeout(() => {
          try { player4.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 7:
        player4.pause();
        setTimeout(() => {
          try { player5.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 9:
        setTimeout(() => {
          try { player3.play(); } catch (e) { console.log('Error playing video:', e); }
        }, playDelay);
        break;
      case 10:
        player3.pause();
        break;
    }
  }, [player1, player2, player3, player4, player5, isAndroid]);

  const pauseAll = useCallback(() => {
    try { player1.pause(); } catch (e) { console.log('Error pausing player1:', e); }
    try { player2.pause(); } catch (e) { console.log('Error pausing player2:', e); }
    try { player3.pause(); } catch (e) { console.log('Error pausing player3:', e); }
    try { player4.pause(); } catch (e) { console.log('Error pausing player4:', e); }
    try { player5.pause(); } catch (e) { console.log('Error pausing player5:', e); }
  }, [player1, player2, player3, player4, player5]);

  const pauseVerificationVideo = useCallback(() => {
    try { player5.pause(); } catch (e) { console.log('Error pausing player5:', e); }
  }, [player5]);

  return {
    players: { player1, player2, player3, player4, player5 },
    handleStepChange,
    pauseAll,
    pauseVerificationVideo,
  };
}
