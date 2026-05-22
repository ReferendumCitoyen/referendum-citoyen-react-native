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

const ENABLED_KEY = 'extra_proposals_enabled';
const IDS_KEY = 'extra_proposals_ids_v1';

const DEFAULT_IDS = ['48', '47'];

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
        if (enabledRaw === 'true') setExtraEnabledState(true);
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
    setExtraEnabledState(next);
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
