/**
 * Small wrappers the gallery states share.
 */
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setQaNativeScanOverride } from '@/utils/qa-overrides';
import { bigintReplacer } from '@/utils/proposal-cache';
import { scanStandIn, type ScanScript } from './data';
import { FlowFrame, type FlowDims } from './FlowFrame';
import type { GalleryCtx } from './types';

/** Installs a simulated chip read for as long as the state is on screen. */
export function WithScan({ script, children }: { script: ScanScript; children: React.ReactNode }) {
  // Installed during the first render so it is in place before any tap.
  useState(() => setQaNativeScanOverride(scanStandIn(script)));
  useEffect(() => () => void setQaNativeScanOverride(null), []);
  return <>{children}</>;
}

/**
 * Missing-data watchdog the gallery gives the steps that publish a waiting
 * state ("Préparation...", "Vérification en cours...").
 *
 * Those two states are transient in production: step 11 replaces the text
 * after 15 s and step 7 after 30 s, with the "scan your document first"
 * failure. The gallery publishes them as states in their own right, and on a
 * slow simulator the run needs more than that to open the deep link, settle
 * the animation and query the view hierarchy: the iPhone campaign of
 * 2026-09-22 screenshotted the failure on all three combinations while
 * Android, which is faster, caught the waiting text. Ten minutes is longer
 * than any run, so the state the catalogue names is the state on screen. The
 * production defaults are untouched and are what the jest suite exercises.
 */
export const QA_LONG_WATCHDOG_MS = 600_000;

const MAINNET_CACHE_KEY = 'cached_proposals_v1:mainnet';

/**
 * Puts `list` in the home's proposal cache while the state is on screen, and
 * puts back what was there when it leaves. Only the post-vote suggestion card
 * reads it (Step12Success); the home refetches its own list on focus anyway.
 */
export function WithProposalCache({ list, children }: { list: unknown[]; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let previous: string | null = null;
    let cancelled = false;
    (async () => {
      previous = await AsyncStorage.getItem(MAINNET_CACHE_KEY).catch(() => null);
      await AsyncStorage.setItem(MAINNET_CACHE_KEY, JSON.stringify(list, bigintReplacer)).catch(() => {});
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      const restore = previous;
      void (restore === null
        ? AsyncStorage.removeItem(MAINNET_CACHE_KEY)
        : AsyncStorage.setItem(MAINNET_CACHE_KEY, restore)
      ).catch(() => {});
    };
  }, [list]);
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <>{children}</>;
}

/** A step inside the flow chrome, with the chrome's own buttons recorded. */
export function inFlow(
  ctx: GalleryCtx,
  step: number,
  body: (dims: FlowDims) => React.ReactNode,
  next?: string,
) {
  return (
    <FlowFrame
      step={step}
      onClose={ctx.act('close', 'router.back() (Fermer)')}
      onNext={next ? ctx.act('next', next) : undefined}
    >
      {body}
    </FlowFrame>
  );
}
