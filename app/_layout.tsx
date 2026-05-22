import '@/polyfills';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import '@/locales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import NfcManager from 'react-native-nfc-manager';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { DevModeProvider } from '@/contexts/DevModeContext';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { TermsProvider, useTerms } from '@/contexts/TermsContext';
import { TERMS_VERSION } from '@/constants/terms';
import TermsGate from './terms-gate';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';


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
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <CustomThemeProvider>
          <DevModeProvider>
            <NetworkProvider>
              <TermsProvider>
                <RootLayoutNav />
              </TermsProvider>
            </NetworkProvider>
          </DevModeProvider>
        </CustomThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function RootLayoutNav() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { acceptedVersion, hydrated } = useTerms();

  // Block the entire app behind the CGU gate until the user has accepted
  // the current TERMS_VERSION. While AsyncStorage is still hydrating we
  // render nothing — avoids a 1-frame flash of the home tab before the
  // gate appears for users who already accepted on an earlier launch.
  const needsTerms = hydrated && acceptedVersion !== TERMS_VERSION;

  return (
    <ThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
      <BottomSheetModalProvider>
        <StatusBar
          style={theme === 'dark' ? 'light' : 'dark'}
          translucent={Platform.OS === 'ios'}
        />
        {!hydrated ? null : needsTerms ? (
          <TermsGate />
        ) : (
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="nfc-scan-modal"
            options={{
              title: t('navigation.nfcScan'),
              headerBackTitle: t('navigation.back'),
              presentation: 'modal'
            }}
          />
          <Stack.Screen
            name="parametres"
            options={{
              title: t('settings.title'),
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="diagnostics"
            options={{
              title: 'Diagnostic NFC (CNIe)',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="diagnostics-passport"
            options={{
              title: 'Diagnostic Passeport',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="voting-flow"
            options={{
              headerShown: false,
              presentation: 'card'
            }}
          />
          <Stack.Screen
            name="voting-screen"
            options={{
              presentation: 'modal',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="french-id-test"
            options={{
              title: 'Test French ID',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="id-test"
            options={{
              title: 'Test ID',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="passport-test"
            options={{
              title: 'Test Passport',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="can-scan"
            options={{
              title: 'Scan CAN',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="key-management"
            options={{
              title: 'Sauvegarde / Restauration de clé',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="terms-view"
            options={{
              title: t('settings.termsAndConditions'),
              headerBackTitle: t('navigation.back'),
            }}
          />
        </Stack>
        )}
      </BottomSheetModalProvider>
    </ThemeProvider>
  );
}
