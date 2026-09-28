/**
 * Dev-only context controlling an "extras" list of proposal IDs that the
 * home screen renders alongside the main allowlist. Two pieces of state:
 *
 *   - `extraEnabled`: boolean toggle (default false). When false, the
 *     home screen ignores `extraIds` entirely.
 *   - `extraIds`: editable string[] of proposal IDs, defaults to
 *     ['48', '47']. Each entry is a numeric string — validation lives
 *     in the Settings input layer (parametres.tsx), this context just
 *     stores whatever the caller passes.
 *
 * Both are persisted in AsyncStorage so the user's choice survives app
 * restarts. Used by `app/(tabs)/index.tsx` (the home screen merges
 * `extraIds` into the fetched proposal list when enabled) and
 * `app/parametres.tsx` (the dev-tools section exposes the toggle + a
 * text input bound to `extraIds`).
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isBetaBuild } from '@/constants/app-flavour';

const ENABLED_KEY = 'extra_proposals_enabled';
const IDS_KEY = 'extra_proposals_ids_v1';

const DEFAULT_IDS = ['48', '47'];

/**
 * Extras are a beta-only tool, decided by the flavour and not by dev mode.
 *
 * `extraEnabled` is persisted, and the store app before 2026-09-15 had no
 * flavour check on dev mode — seven taps on the version line worked there too.
 * So a switch flipped on that build survived the update into 2.0.0, where the
 * dev-tools section that would turn it off again is unreachable: the home
 * screen went on merging DEFAULT_IDS into the production list, and #47 ("Le
 * ciel doit il etre bleu", live until December, on the passport contract)
 * showed as a second "Vote en cours" on a store install.
 *
 * Gated here rather than at the call site so a persisted value cannot reach
 * ANY consumer — the home list, the Settings row, or whatever is added next.
 * Same shape as DEV_MODE_AVAILABLE in contexts/DevModeContext.tsx.
 */
const EXTRAS_AVAILABLE = isBetaBuild();

interface ExtraProposalsContextType {
  extraEnabled: boolean;
  setExtraEnabled: (next: boolean) => void;
  extraIds: string[];
  /** Replace the entire list. Caller is responsible for de-duping and
   * for ensuring each entry parses as a positive integer (the home
   * screen and SDK call sites will throw on garbage). */
  setExtraIds: (next: string[]) => void;
  hydrated: boolean;
}

const ExtraProposalsContext = createContext<ExtraProposalsContextType | undefined>(undefined);

export function ExtraProposalsProvider({ children }: { children: React.ReactNode }) {
  const [extraEnabled, setExtraEnabledState] = useState(false);
  const [extraIds, setExtraIdsState] = useState<string[]>(DEFAULT_IDS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [enabledRaw, idsRaw] = await Promise.all([
          AsyncStorage.getItem(ENABLED_KEY),
          AsyncStorage.getItem(IDS_KEY),
        ]);
        if (cancelled) return;
        if (EXTRAS_AVAILABLE && enabledRaw === 'true') setExtraEnabledState(true);
        if (idsRaw) {
          try {
            const parsed = JSON.parse(idsRaw);
            if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
              setExtraIdsState(parsed);
            }
          } catch {
            // Malformed value (corrupted by a previous bad write?) —
            // fall through to the in-memory default; on next setExtraIds
            // call we'll overwrite with a well-formed JSON array.
          }
        }
      } catch (e) {
        console.warn('[ExtraProposalsContext] hydrate failed:', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setExtraEnabled = useCallback((next: boolean) => {
    setExtraEnabledState(EXTRAS_AVAILABLE && next);
    AsyncStorage.setItem(ENABLED_KEY, next ? 'true' : 'false').catch((e) => {
      console.warn('[ExtraProposalsContext] persist enabled failed:', e);
    });
  }, []);

  const setExtraIds = useCallback((next: string[]) => {
    setExtraIdsState(next);
    AsyncStorage.setItem(IDS_KEY, JSON.stringify(next)).catch((e) => {
      console.warn('[ExtraProposalsContext] persist ids failed:', e);
    });
  }, []);

  return (
    <ExtraProposalsContext.Provider value={{ extraEnabled, setExtraEnabled, extraIds, setExtraIds, hydrated }}>
      {children}
    </ExtraProposalsContext.Provider>
  );
}

export function useExtraProposals(): ExtraProposalsContextType {
  const ctx = useContext(ExtraProposalsContext);
  if (!ctx) throw new Error('useExtraProposals must be used within ExtraProposalsProvider');
  return ctx;
}
