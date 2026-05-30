import '@/utils/logger-install';
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
import { ExtraProposalsProvider } from '@/contexts/ExtraProposalsContext';
import { ErrorReportProvider } from '@/contexts/ErrorReportContext';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
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
        <ErrorReportProvider>
          <RootErrorBoundary>
            <CustomThemeProvider>
              <DevModeProvider>
                <NetworkProvider>
                  <TermsProvider>
                    <ExtraProposalsProvider>
                      <RootLayoutNav />
                    </ExtraProposalsProvider>
                  </TermsProvider>
                </NetworkProvider>
              </DevModeProvider>
            </CustomThemeProvider>
          </RootErrorBoundary>
        </ErrorReportProvider>
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
              // iOS: chevron-only back button (see terms-view note below for
              // why `headerBackTitle: ''` isn't enough on React Navigation 7).
              // Android is a no-op.
              headerBackButtonDisplayMode: 'minimal',
            }}
          />
          <Stack.Screen
            name="voting-flow"
            options={{
              // iOS gets a native bottom-sheet modal (slide up from bottom)
              // with the native nav-bar header so we can hang a Fermer button
              // in `headerRight` (configured per-screen in app/voting-flow.tsx).
              // Android keeps the existing card push + no header (unchanged).
              // Gesture-dismiss is disabled on iOS so the Fermer button is
              // the only exit — mirrors the old voting-screen behaviour and
              // prevents accidental dismissal mid-NFC scan.
              headerShown: Platform.OS === 'ios',
              presentation: Platform.OS === 'ios' ? 'modal' : 'card',
              gestureEnabled: Platform.OS !== 'ios',
            }}
          />
          {/* Diagnostic / dev-only screens. Expo Router auto-registers
              every file under `app/` regardless of what's listed here, so
              we can't gate the *route* — we register the Stack.Screen
              unconditionally just for header options. The real barrier
              lives inside each screen component: a `useDevMode()` check
              that calls `router.replace('/')` and renders `null` when
              devMode is off. Anyone deep-linking
              `referendumcitoyen://french-id-test` etc. on a production
              install bounces back to the home tab before the screen
              renders any chip / MRZ internals.
              We previously wrapped these in `{devMode && (...)}` for
              defence-in-depth on the navigation layer, but expo-router's
              Stack iterates children directly and treats every falsy
              expression as a non-Screen child — logging "Layout
              children must be of type Screen…" warnings and surfacing
              as "App entry not found" on reload. The unconditional form
              avoids the warning; the in-component guard is sufficient. */}
          <Stack.Screen
            name="french-id-test"
            options={{
              title: 'Test French ID',
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
              title: t('keyManagement.title'),
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="export-passport"
            options={{
              title: 'Export passeport (dev)',
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="language-select"
            options={{
              title: t('settings.language'),
              headerBackTitle: t('navigation.back'),
            }}
          />
          <Stack.Screen
            name="terms-view"
            options={{
              title: t('settings.termsAndConditions'),
              // iOS: chevron-only back button. `headerBackTitle: ''` isn't
              // enough on React Navigation 7 — iOS falls back to showing the
              // previous screen's title ("Paramètres") as the label. The
              // `'minimal'` display mode is the official escape hatch.
              // Android renders no back-title by default, so this is a no-op
              // on Android.
              headerBackButtonDisplayMode: 'minimal',
            }}
          />
        </Stack>
        )}
      </BottomSheetModalProvider>
    </ThemeProvider>
  );
}
