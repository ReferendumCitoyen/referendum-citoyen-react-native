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
