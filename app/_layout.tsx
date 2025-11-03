import 'react-native-reanimated';
import 'react-native-gesture-handler';
import '@/locales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import NfcManager from 'react-native-nfc-manager';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';


export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    'RethinkSans-Medium': require('../assets/fonts/RethinkSans-Medium.ttf'),
    'RethinkSans-SemiBold': require('../assets/fonts/RethinkSans-SemiBold.ttf'),
    'RethinkSans-Bold': require('../assets/fonts/RethinkSans-Bold.ttf'),
    ...FontAwesome.font,
  });

  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Ensure splash screen shows for at least 1 second
  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded && minTimeElapsed) {
      SplashScreen.hideAsync();
    }
  }, [loaded, minTimeElapsed]);

  // Configure audio mode to allow mixing with other apps' audio
  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  }, []);

  // Initialize NFC Manager
  useEffect(() => {
    NfcManager.start();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <CustomThemeProvider>
        <RootLayoutNav />
      </CustomThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const { theme } = useTheme();

  return (
    <ThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
      <BottomSheetModalProvider>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="nfc-test"
            options={{
              title: 'Test NFC',
              headerBackTitle: 'Retour'
            }}
          />
        </Stack>
      </BottomSheetModalProvider>
    </ThemeProvider>
  );
}
