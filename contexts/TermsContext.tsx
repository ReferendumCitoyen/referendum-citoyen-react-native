/**
 * Terms-acceptance context.
 *
 * Persists the last-accepted CGU version in AsyncStorage. The root layout
 * uses `acceptedVersion !== TERMS_VERSION` (once `hydrated` is true) to
 * decide whether to render the `<TermsGate />` modal over the rest of the
 * app. To force a re-acceptance after a CGU change, bump TERMS_VERSION
 * in constants/terms.ts.
 *
 * The `clear()` action is exposed for the dev-tools "Tout supprimer" flow
 * so wiping app state also resets the CGU acceptance.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TERMS_VERSION } from '@/constants/terms';

const STORAGE_KEY = 'terms_accepted_version';

interface TermsContextType {
  /** Last version the user tapped "J'accepte" on. null = never accepted. */
  acceptedVersion: string | null;
  /** Whether the initial AsyncStorage read has resolved. Renders that depend
   * on `acceptedVersion` should wait for this to avoid flashing the gate
   * during the first ~50ms of app startup. */
  hydrated: boolean;
  /** Persist the current TERMS_VERSION as accepted. */
  accept: () => Promise<void>;
  /** Forget the stored acceptance — used by "Tout supprimer". */
  clear: () => Promise<void>;
}

const TermsContext = createContext<TermsContextType | undefined>(undefined);

export function TermsProvider({ children }: { children: React.ReactNode }) {
  const [acceptedVersion, setAcceptedVersion] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled) setAcceptedVersion(stored);
      } catch (e) {
        console.warn('[TermsContext] hydrate failed:', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const accept = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, TERMS_VERSION);
      setAcceptedVersion(TERMS_VERSION);
    } catch (e) {
      console.warn('[TermsContext] accept persist failed:', e);
      // Still update local state so the UI moves forward — re-prompt on
      // next launch is a tolerable degradation versus blocking the user
      // because of a storage hiccup.
      setAcceptedVersion(TERMS_VERSION);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[TermsContext] clear failed:', e);
    }
    setAcceptedVersion(null);
  }, []);

  return (
    <TermsContext.Provider value={{ acceptedVersion, hydrated, accept, clear }}>
      {children}
    </TermsContext.Provider>
  );
}

export function useTerms(): TermsContextType {
  const ctx = useContext(TermsContext);
  if (!ctx) throw new Error('useTerms must be used within TermsProvider');
  return ctx;
}
