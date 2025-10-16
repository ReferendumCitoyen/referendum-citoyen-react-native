import React, { createContext, useContext, ReactNode } from 'react';
import { useVideoPlayer } from 'expo-video';

interface VideoContextType {
  comprendrePlayer: any;
}

const VideoContext = createContext<VideoContextType | null>(null);

export function VideoProvider({ children }: { children: ReactNode }) {
  // Initialize and preload comprendre video immediately when app loads
  const comprendrePlayer = useVideoPlayer(
    require('@/assets/videos/kling_20250904_Image_to_Video_A_playful__5643_0.mp4'),
    player => {
      player.loop = false;
      player.muted = true;
      player.audioMixingMode = 'mixWithOthers';
      // Preload immediately but don't play
      player.pause();
    }
  );

  return (
    <VideoContext.Provider value={{ comprendrePlayer }}>
      {children}
    </VideoContext.Provider>
  );
}

export function useComprendreVideo() {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useComprendreVideo must be used within VideoProvider');
  }
  return context.comprendrePlayer;
}
