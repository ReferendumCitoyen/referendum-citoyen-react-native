/**
 * In-app splash, shown for a beat after the native launch screen hands over.
 *
 * The native splash is a static PNG drawn by the OS before any JavaScript
 * runs, so there is nothing to inject a version number into short of baking it
 * into the artwork on every release. This renders the same image with the
 * version on top, which is what makes a tester's "it does this on my phone"
 * report actionable.
 *
 * It replaces the old fixed one-second hold rather than adding to it, so
 * launch does not get slower: app/_layout.tsx now hides the native splash as
 * soon as the fonts are ready and shows this instead.
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { appVersionLabel, appBuildLabel } from '@/utils/app-version';
import { isBetaBuild } from '@/constants/app-flavour';

// One artwork per app, matching app.config.ts `splash` / `splash.backgroundColor`
// for that flavour, so the handover from the native splash to this one is
// invisible: the beta's purple, the store app's white. Both images ship in
// both builds (require() is static); the bundle id picks at runtime.
const BETA = isBetaBuild();
const SPLASH_IMAGE = BETA
  ? require('@/assets/images/splash-beta.png')
  : require('@/assets/images/splash.png');
const SPLASH_BACKGROUND = BETA ? '#633AC4' : '#ffffff';

export default function AppSplash() {
  return (
    <View style={styles.root} pointerEvents="none">
      <Image
        source={SPLASH_IMAGE}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        // No fade: this stands in for the native splash, and a fade-in would
        // read as a flash at the handover.
        fadeDuration={0}
      />
      {/* The version + build stamp is for testers' reports; the store app
          keeps its launch screen clean. */}
      {BETA && (
        <Text style={styles.version} allowFontScaling={false}>
          {`v${appVersionLabel()} (build ${appBuildLabel()})`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BACKGROUND,
    zIndex: 100,
  },
  version: {
    position: 'absolute',
    bottom: 56,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#FFFFFF',
    opacity: 0.85,
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
