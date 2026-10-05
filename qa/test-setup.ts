/**
 * Module mocks shared by the QA suites (qa/*.test.ts[x]). Imported FIRST by
 * each suite: jest.mock calls made while this module loads apply to every
 * module required after it.
 *
 * Only what has no JS implementation under jest is mocked (native modules,
 * navigation, the mail/share/clipboard side effects). The components, the
 * translations, the error mapping and the vote-error table are the real ones.
 * Side effects are routed to the gallery's action recorder so the suites can
 * assert what a button did.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
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
jest.mock('lottie-react-native', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => null }));
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: true, requestPermission: jest.fn(async () => true) }),
}));
jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(() => Promise.resolve()),
    isEnabled: jest.fn(() => Promise.resolve(true)),
    isSupported: jest.fn(() => Promise.resolve(true)),
  },
}));
jest.mock('expo-crypto', () => ({ getRandomValues: (a: Uint8Array) => a }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: async () => undefined, deactivateKeepAwake: () => undefined }));

// The build: `QA_FLAVOUR=store` makes the suite behave as the store app.
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '2.0.2',
  nativeBuildVersion: '1',
  get applicationId() {
    return (global as { __QA_APP_ID__?: string }).__QA_APP_ID__ ?? 'app.referendumcitoyen.fr.beta';
  },
}));

// The native NFC module. The real modules/e-document/index.ts runs (its French
// rewrite is part of what the states show); only the native object is fake,
// and the QA seam (utils/qa-overrides.ts) replaces its scanDocument.
jest.mock('@/modules/e-document/src/EDocumentModule', () => ({
  __esModule: true,
  default: {
    scanDocument: jest.fn(() => Promise.reject(new Error('native scan must not be reached in QA'))),
    cancelScan: jest.fn(async () => undefined),
    disableScan: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: () => undefined })),
    removeListeners: jest.fn(),
  },
}));
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  class EventEmitter {
    addListener() {
      return { remove: () => undefined };
    }
    removeAllListeners() {}
  }
  return { ...actual, EventEmitter };
});

// Navigation: every call is recorded as `router.<method>:<path>`.
jest.mock('expo-router', () => {
  const React = require('react');
  const { recordAction } = require('@/qa/fixtures/recorder');
  const path = (to: unknown) =>
    typeof to === 'string' ? to : String((to as { pathname?: string } | null)?.pathname ?? '?');
  const router = {
    push: (to: unknown) => recordAction(`router.push:${path(to)}`),
    replace: (to: unknown) => recordAction(`router.replace:${path(to)}`),
    back: () => recordAction('router.back'),
    canGoBack: () => true,
    navigate: (to: unknown) => recordAction(`router.navigate:${path(to)}`),
  };
  const Screen = () => null;
  const Stack = Object.assign(() => null, { Screen });
  return {
    __esModule: true,
    useRouter: () => router,
    router,
    Stack,
    Redirect: ({ href }: { href: string }) => {
      recordAction(`redirect:${href}`);
      return React.createElement('View', { testID: `redirect-${href}` });
    },
    useLocalSearchParams: () => (global as { __QA_PARAMS__?: Record<string, string> }).__QA_PARAMS__ ?? {},
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []),
    Link: ({ children }: { children: unknown }) => children,
  };
});

// Side effects a button can have, recorded instead of performed.
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => {
    require('@/qa/fixtures/recorder').recordAction('clipboard');
    return true;
  }),
  getStringAsync: jest.fn(async () => ''),
}));
jest.mock('@/utils/open-contact-email', () => ({
  openContactEmail: jest.fn(() => require('@/qa/fixtures/recorder').recordAction('mail')),
}));
jest.mock('@/utils/error-reporter', () => {
  const actual = jest.requireActual('@/utils/error-reporter');
  const { recordAction } = require('@/qa/fixtures/recorder');
  return {
    ...actual,
    prepareErrorReport: jest.fn(async () => ({ uri: 'file:///qa.txt', errorMessage: 'qa', attachments: ['file:///qa.txt'], kind: 'error' })),
    sendErrorReport: jest.fn(async () => {
      recordAction('report');
      return false;
    }),
    prepareSuccessReport: jest.fn(async () => ({ uri: 'file:///qa.txt', errorMessage: '', attachments: ['file:///qa.txt', 'file:///qa.json'], kind: 'success' })),
    sendPreviousSessionReport: jest.fn(async () => {
      recordAction('previous-session');
      return 'cancelled';
    }),
  };
});
jest.mock('@/utils/logger', () => {
  const actual = jest.requireActual('@/utils/logger');
  return {
    ...actual,
    readPreviousSessionLog: jest.fn(async () => (global as { __QA_PREVIOUS_LOG__?: string | null }).__QA_PREVIOUS_LOG__ ?? null),
    purgeVoteTrace: jest.fn(async () => undefined),
  };
});
// Step 7 and Step 11's heavy imports (prover, certificate parsing): never
// reached by a gallery state, and their ESM dependencies do not load in jest.
jest.mock('@/utils/register-via-noir', () => ({
  registerIdentityViaNoir: jest.fn(),
  generateHeavyNoirProofWithCscaBootstrap: jest.fn(),
  assertOnChainConstants: jest.fn(),
}));
jest.mock('@/utils/e-document/e-document', () => ({ EPassport: class {} }));
jest.mock('@/utils/mainnet-vote-flow', () => ({}));
jest.mock('@/utils/circuit-preload', () => ({ ensureCircuitsReady: async () => undefined }));
jest.mock('@/constants/mock-backend', () => ({
  isMockBackend: () => false,
  mockDelay: async () => undefined,
  mockTxHash: () => '0x0',
  hydrateMockBackendOverride: async () => undefined,
  mockBackendOverride: () => null,
  setMockBackendOverride: async () => undefined,
  MOCK_BACKEND_BUILD_DEFAULT: false,
}));

export {};
