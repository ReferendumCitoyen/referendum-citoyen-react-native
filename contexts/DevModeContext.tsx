import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { isBetaBuild } from '@/constants/app-flavour';

interface DevModeContextType {
  devMode: boolean;
  setDevMode: (value: boolean) => void;
  handleVersionTap: () => void;
}

const DevModeContext = createContext<DevModeContextType | undefined>(undefined);

// Dev mode exists on the beta only. On the store app the seven taps on the
// version do nothing and the switch cannot be set: the test screens, the
// testnet toggle, the mock backend and the age/expiry bypasses all sit
// behind it, and none of them belongs on a voter's phone. Decided on the
// launch call of 2026-09-15.
const DEV_MODE_AVAILABLE = isBetaBuild();

export function DevModeProvider({ children }: { children: React.ReactNode }) {
  const [devMode, setDevModeState] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDevMode = useCallback((value: boolean) => {
    setDevModeState(DEV_MODE_AVAILABLE && value);
  }, []);

  const handleVersionTap = useCallback(() => {
    if (!DEV_MODE_AVAILABLE) return;
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 7) {
      tapCountRef.current = 0;
      setDevModeState(true);
    } else {
      tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 2000);
    }
  }, []);

  return (
    <DevModeContext.Provider value={{ devMode, setDevMode, handleVersionTap }}>
      {children}
    </DevModeContext.Provider>
  );
}

export function useDevMode() {
  const context = useContext(DevModeContext);
  if (context === undefined) {
    throw new Error('useDevMode must be used within a DevModeProvider');
  }
  return context;
}
