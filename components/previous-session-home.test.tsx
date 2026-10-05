import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import Home from '@/app/(tabs)/index';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { claimPreviousSessionOffer, clearPreviousSessionLog } from '@/utils/logger';
import { sendPreviousSessionReport } from '@/utils/error-reporter';
import { getProposalIndex } from '@/utils/proposal-index';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() {
      return undefined;
    }
    getBoolean() {
      return undefined;
    }
    set() {}
    delete() {}
  },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, []),
}));
jest.mock('@/contexts/DevModeContext', () => ({ useDevMode: () => ({ devMode: false }) }));
jest.mock('@/contexts/NetworkContext', () => ({ useNetwork: () => ({ network: 'mainnet' }) }));
jest.mock('@/contexts/ExtraProposalsContext', () => {
  const state = { extraEnabled: false, extraIds: [] };
  return { useExtraProposals: () => state };
});
jest.mock('@/utils/logger', () => ({
  claimPreviousSessionOffer: jest.fn(async () => true),
  readPreviousSessionLog: jest.fn(async () => 'LOCAL-LOG-CONTENT'),
  clearPreviousSessionLog: jest.fn(async () => {}),
}));
jest.mock('@/utils/error-reporter', () => ({
  sendPreviousSessionReport: jest.fn(async () => 'sent'),
}));
jest.mock('@/utils/proposal-index', () => ({
  readCachedIndex: async () => null,
  getProposalIndex: jest.fn(),
  idsForNetwork: () => [],
  twinsForNetwork: () => ({}),
  closedForNetwork: () => new Set(),
  pagesForNetwork: () => ({}),
}));
jest.mock('@/utils/proposal-cache', () => ({
  migrateLegacyCache: jest.fn(),
  readCachedProposals: async () => [],
  writeCachedProposals: async () => {},
}));
jest.mock('@/utils/device-support', () => ({
  useUnsupportedPhone: () => false,
  runNoirProbeOnce: async () => 'missing',
}));
jest.mock('@/utils/circuit-preload', () => ({
  preloadCircuits: jest.fn(),
  subscribeCircuitPreload: () => () => {},
}));
jest.mock('@rarimo/rarime-rn-sdk', () => ({ FreedomTool: class {} }));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('offers the previous session on home before loading finishes, and keeps it afterwards', async () => {
  let loaded!: (value: any) => void;
  jest.mocked(getProposalIndex).mockReturnValue(
    new Promise((resolve) => {
      loaded = resolve;
    })
  );
  const screen = render(
    <ThemeProvider>
      <Home />
    </ThemeProvider>
  );
  await flush();
  expect(screen.getByText('home.loading')).toBeTruthy();
  expect(screen.getByText('settings.sendPreviousLog')).toBeTruthy();
  expect(screen.queryByText('LOCAL-LOG-CONTENT')).toBeNull();
  expect(sendPreviousSessionReport).not.toHaveBeenCalled();
  await act(async () => loaded({ mainnet: { active: [] } }));
  await flush();
  expect(screen.getByText('settings.sendPreviousLog')).toBeTruthy();
  expect(claimPreviousSessionOffer).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('errorReport.previousSessionDecline'));
  await flush();
  expect(screen.queryByText('settings.sendPreviousLog')).toBeNull();
  expect(clearPreviousSessionLog).toHaveBeenCalledTimes(1);
  expect(sendPreviousSessionReport).not.toHaveBeenCalled();
});
