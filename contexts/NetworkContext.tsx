import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_NETWORK, Network } from '@/constants/rarime-config';

/**
 * Active-network context.
 *
 * - The selected network (`testnet` | `mainnet`) is persisted to AsyncStorage
 *   under NETWORK_STORAGE_KEY so it survives app restarts.
 * - On boot we render with DEFAULT_NETWORK first and then hydrate from storage
 *   in an effect — the `hydrated` flag lets screens that *only* render after
 *   network is known (e.g. home screen that fires RPC calls in useEffect)
 *   wait until persistence has resolved. Most call sites can ignore it; the
 *   default value is correct for first installs.
 * - Changing the network mid-session invalidates the BJJ-identity / proposal
 *   cache stored against the previous network. We don't wipe those caches
 *   here (cheap to refetch + the user expects re-init), but consumers should
 *   re-create their Rarime/FreedomTool instances when `network` changes.
 *   See voting-flow.tsx: the SDK refs are nulled out on network change so the
 *   next entry into Step 7 re-initialises against the new addresses.
 */

const NETWORK_STORAGE_KEY = '@referendum/network';

interface NetworkContextType {
  network: Network;
  setNetwork: (n: Network) => void;
  /** True once the persisted preference has been loaded from AsyncStorage. */
  hydrated: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<Network>(DEFAULT_NETWORK);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(NETWORK_STORAGE_KEY);
        if (stored === 'mainnet' || stored === 'testnet') {
          setNetworkState(stored);
        }
      } catch (e) {
        // Storage read failure isn't fatal — fall back to DEFAULT_NETWORK.
        // We log so the dev sees it; user impact is none (just a non-sticky
        // preference for this run).
        console.warn('[NetworkContext] hydrate failed:', e);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const setNetwork = useCallback((n: Network) => {
    setNetworkState(n);
    // Fire-and-forget — the in-memory state is the source of truth for the
    // current session, the write just persists for next launch. We don't
    // gate the UI on the write completing.
    AsyncStorage.setItem(NETWORK_STORAGE_KEY, n).catch((e) => {
      console.warn('[NetworkContext] persist failed:', e);
    });
  }, []);

  return (
    <NetworkContext.Provider value={{ network, setNetwork, hydrated }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within a NetworkProvider');
  return ctx;
}
