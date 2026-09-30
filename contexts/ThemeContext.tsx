import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';
import { useColorScheme } from 'react-native';

// Try to use MMKV, fallback to AsyncStorage if not available
let storage: MMKV | null = null;
try {
  storage = new MMKV();
} catch (_error) {
  // MMKV not available, will use AsyncStorage
}

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  colors: ColorScheme;
}

interface ColorScheme {
  primary: string;
  secondary: string;
  white: string;
  black: string;
  background: string;
  border: string;
  success: string;
  error: string;
  switchGray: string;
  voteBarOui: string;
  voteBarBlanc: string;
  voteBarNon: string;
  gradientStart: string;
  gradientEnd: string;
  progressActive: string;
  progressInactive: string;
  text: string;
  cardBackground: string;
  icon: string;
  buttonText: string;

  // Semantic feedback (text + tinted surface)
  errorText: string;
  errorBackground: string;
  successText: string;
  successBackground: string;
  warningText: string;
  warningBackground: string;

  // Neutral grays
  textSecondary: string;
  placeholder: string;

  // Overlays
  overlay: string;
  cameraBackdrop: string;

  // MRZ / camera scanner
  scanReticleSuccess: string;
  scanReticleWarning: string;
  scanReticleError: string;
  scanOverlayStrong: string;
  scanOverlayMedium: string;
  scanOverlayWeak: string;
  scanOverlayDim: string;
  scanOverlayText: string;
  scanReticleNeutralBg: string;
  scanReticleSuccessBg: string;
  scanReticleErrorBg: string;
  scanReticleInnerBg: string;
  scanReticleSuccessInnerBg: string;

  // Stats bar palette (home tab)
  chartPalette: readonly string[];
}

export const LightColors: ColorScheme = {
  primary: '#111F84',
  secondary: '#3044DD',
  white: '#FFFFFF',
  black: '#000000',
  background: '#EDEFF9',
  border: '#EDEFF9',
  success: '#48C26D',
  error: '#DD3030',
  switchGray: '#E2E1E7',
  voteBarOui: '#D5DCFF',
  voteBarBlanc: '#BFC4DA',
  voteBarNon: '#FFD2D2',
  gradientStart: 'rgba(255, 255, 255, 0.1)',
  gradientEnd: '#FFFFFF',
  progressActive: '#3044DD',
  progressInactive: 'rgba(48, 68, 221, 0.3)',
  text: '#111F84',
  cardBackground: '#FFFFFF',
  icon: '#111F84',
  buttonText: '#FFFFFF',

  errorText: '#DC2626',
  errorBackground: '#FEF2F2',
  successText: '#059669',
  successBackground: '#F0FDF4',
  warningText: '#92400E',
  warningBackground: '#FEF3C7',

  textSecondary: '#666666',
  placeholder: '#999999',

  overlay: 'rgba(0, 0, 0, 0.5)',
  cameraBackdrop: '#000000',

  scanReticleSuccess: '#10B981',
  scanReticleWarning: '#FBBF24',
  scanReticleError: '#EF4444',
  scanOverlayStrong: 'rgba(255, 255, 255, 0.7)',
  scanOverlayMedium: 'rgba(255, 255, 255, 0.4)',
  scanOverlayWeak: 'rgba(255, 255, 255, 0.6)',
  scanOverlayDim: 'rgba(255, 255, 255, 0.5)',
  scanOverlayText: '#FFFFFF',
  scanReticleNeutralBg: 'rgba(0, 0, 0, 0.25)',
  scanReticleSuccessBg: 'rgba(16, 185, 129, 0.15)',
  scanReticleErrorBg: 'rgba(239, 68, 68, 0.15)',
  scanReticleInnerBg: 'rgba(255, 255, 255, 0.1)',
  scanReticleSuccessInnerBg: 'rgba(16, 185, 129, 0.2)',

  chartPalette: ['#3B82F6', '#EF4444', '#E5E7EB', '#F59E0B', '#22C55E'],
};

export const DarkColors: ColorScheme = {
  primary: '#111F84',
  secondary: '#3044DD',
  white: '#000000', // Swapped
  black: '#FFFFFF', // Swapped
  background: '#1A1A1A', // Dark grey instead of light grey
  border: '#3A3A3A', // Lighter grey for visibility in dark mode
  success: '#48C26D',
  error: '#DD3030',
  switchGray: '#2A2A2A', // Dark grey instead of light grey
  voteBarOui: '#2A3B8F', // Darker version
  voteBarBlanc: '#3F4358', // Darker version
  voteBarNon: '#8F2D2D', // Darker version
  gradientStart: 'rgba(0, 0, 0, 0.1)',
  gradientEnd: '#000000',
  progressActive: '#3044DD',
  progressInactive: 'rgba(48, 68, 221, 0.3)',
  text: '#FFFFFF',
  cardBackground: '#2A2A2A',
  icon: '#FFFFFF',
  buttonText: '#FFFFFF',

  errorText: '#F87171',
  errorBackground: '#3A1F1F',
  successText: '#34D399',
  successBackground: '#1F3A2A',
  warningText: '#FBBF24',
  warningBackground: '#3A2F1F',

  textSecondary: '#A3A3A3',
  placeholder: '#777777',

  overlay: 'rgba(0, 0, 0, 0.7)',
  cameraBackdrop: '#000000',

  scanReticleSuccess: '#34D399',
  scanReticleWarning: '#FBBF24',
  scanReticleError: '#F87171',
  scanOverlayStrong: 'rgba(255, 255, 255, 0.7)',
  scanOverlayMedium: 'rgba(255, 255, 255, 0.4)',
  scanOverlayWeak: 'rgba(255, 255, 255, 0.6)',
  scanOverlayDim: 'rgba(255, 255, 255, 0.5)',
  scanOverlayText: '#FFFFFF',
  scanReticleNeutralBg: 'rgba(0, 0, 0, 0.4)',
  scanReticleSuccessBg: 'rgba(52, 211, 153, 0.18)',
  scanReticleErrorBg: 'rgba(248, 113, 113, 0.18)',
  scanReticleInnerBg: 'rgba(255, 255, 255, 0.1)',
  scanReticleSuccessInnerBg: 'rgba(52, 211, 153, 0.22)',

  chartPalette: ['#60A5FA', '#F87171', '#FFFFFF', '#FBBF24', '#34D399'],
};

const THEME_STORAGE_KEY = '@app_theme';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [theme, setTheme] = useState<Theme>('light');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load theme from storage on mount
  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      let savedTheme: string | null = null;

      if (storage) {
        // Use MMKV
        savedTheme = storage.getString(THEME_STORAGE_KEY) || null;
      } else {
        // Fallback to AsyncStorage
        savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      }

      if (savedTheme === 'light' || savedTheme === 'dark') {
        setTheme(savedTheme);
      }
    } catch (_error) {
      // Failed to load theme, using default
    } finally {
      setIsLoaded(true);
    }
  };

  const toggleTheme = async () => {
    const newTheme: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    try {
      if (storage) {
        // Use MMKV (synchronous)
        storage.set(THEME_STORAGE_KEY, newTheme);
      } else {
        // Fallback to AsyncStorage
        await AsyncStorage.setItem(THEME_STORAGE_KEY, newTheme);
      }
    } catch (_error) {
      // Failed to save theme
    }
  };

  const colors = theme === 'light' ? LightColors : DarkColors;

  // Don't render until theme is loaded
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function useColors() {
  const { colors } = useTheme();
  return colors;
}
