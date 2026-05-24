/**
 * Centralised Rarime / FreedomTool configuration for both Rarimo Mainnet
 * (chainId 7368, the "production" L2 — https://l2.rarimo.com) and Q-Testnet
 * (chainId 7369, https://rpc.qtestnet.org).
 *
 * Why two networks live side-by-side:
 * - Mainnet is where the rarime-app's own French-passport identity
 *   registration succeeded — the on-chain `registerViaNoir(...)` path on
 *   Registration2 `0x11BB4B14AA…`. CSCA chain for HSM_DS_1 is already
 *   permanently in `CertificatesSMT` `0xA8b350d6…` (block 2329) so any
 *   French passport using HSM_DS_1 can register here.
 * - Q-Testnet still hosts the legacy `RegistrationSimple` light-registrator
 *   flow that the @rarimo/rarime-rn-sdk implements. TD3 passports return 400
 *   from the light-registrator endpoint there (Noir-base64 vs Groth16-JSON
 *   schema mismatch) — see HANDOFF-FRENCH-PASSPORT.md. Kept as a fallback /
 *   playground for the light path while the heavy Noir circuit lands.
 *
 * The active network is chosen via NetworkContext (persisted to
 * AsyncStorage); the home screen, voting flow and Step 7 all read through
 * `getRarimeConfig(network)` / `getFreedomToolConfig(network)` so a switch
 * in Settings propagates without prop drilling.
 */

export type Network = 'testnet' | 'mainnet';

/** Default for fresh installs. Switched to Mainnet on 2026-05-22 once the
 * CNIe registration + voting paths were verified end-to-end. Settings → Dev
 * tools still lets the user flip to Testnet for debugging. */
export const DEFAULT_NETWORK: Network = 'mainnet';

// ---------------------------------------------------------------------------
// Q-Testnet (chainId 7369, light-registrator flow — currently broken for TD3)
// ---------------------------------------------------------------------------
export const RARIME_TESTNET_CONFIG = {
  contractsConfiguration: {
    stateKeeperAddress: '0x12883d5F530AF7EC2adD7cEC29Cf84215efCf4D8',
    registerSimpleContractAddress:
      '0x1b6ae4b80F0f26DC53731D1d7aA31fc3996B513B',
    poseidonSmtAddress: '0xb8bAac4C443097d697F87CC35C5d6B06dDe64D60',
  },
  apiConfiguration: {
    jsonRpcEvmUrl: 'https://rpc.qtestnet.org',
    rarimeApiUrl: 'https://api.orgs.app.stage.rarime.com',
  },
};

export const FREEDOM_TOOL_TESTNET_CONFIG = {
  contracts: {
    proposalStateAddress: '0x4C61d7454653720DAb9e26Ca25dc7B8a5cf7065b',
  },
  api: {
    ipfsUrl: 'https://ipfs.rarimo.com',
    votingRelayerUrl: 'https://api.stage.freedomtool.org',
    votingRpcUrl: 'https://rpc.qtestnet.org',
  },
};

// ---------------------------------------------------------------------------
// Rarimo Mainnet (chainId 7368) — the working Noir / registerViaNoir flow.
// Addresses verified live earlier in the session by reading proxy code length
// at each address; relayer URL matches what the rarime-android-app uses for
// `BaseConfig.MainnetConfig`.
// ---------------------------------------------------------------------------
export const RARIME_MAINNET_CONFIG = {
  contractsConfiguration: {
    stateKeeperAddress: '0x61aa5b68D811884dA4FEC2De4a7AA0464df166E1',
    // RegistrationSimple on Mainnet (NOT Registration2). The SDK's light
    // registerIdentity() path encodes `registerSimpleViaNoir(...)` calldata
    // against this contract's ABI and posts to the registration-relayer with
    // this address as the destination. Source: rarime-android-app
    // BaseConfig.kt::MainnetConfig.REGISTRATION_SIMPLE_CONTRACT_ADRRESS.
    // The heavy registerViaNoir path on Registration2 (0x11BB4B14AA…) is
    // separate and uses MAINNET_REGISTRATION_CONTRACT_ADDRESS below.
    registerSimpleContractAddress:
      '0x497D6957729d3a39D43843BD27E6cbD12310F273',
    // RegistrationPoseidonSMT — used for SMT-based identity inclusion proofs
    // at vote time. CertificatesSMT (the CSCA tree) is separate (see below).
    poseidonSmtAddress: '0x479F84502Db545FA8d2275372E0582425204A879',
  },
  apiConfiguration: {
    jsonRpcEvmUrl: 'https://l2.rarimo.com',
    // The Mainnet relayer base. Hosts both:
    //   /integrations/registration-relayer/v1/register — submits any signed
    //     calldata (heavy path)
    //   /integrations/incognito-light-registrator/v1/register — light
    //     path: server-side SOD/CSCA verification + signs the proof so
    //     RegistrationSimple.registerSimpleViaNoir can accept it
    rarimeApiUrl: 'https://api.app.rarime.com',
  },
};

export const FREEDOM_TOOL_MAINNET_CONFIG = {
  contracts: {
    proposalStateAddress: '0x9C4b84a940C9D3140a1F40859b3d4367DC8d099a',
  },
  api: {
    ipfsUrl: 'https://ipfs.rarimo.com',
    // proof-verification-relayer is hosted on a SEPARATE domain from the
    // registration relayer on Mainnet (a previous version of this file
    // incorrectly assumed they shared `api.app.rarime.com` — that 404s the
    // /v2/vote endpoint). Source of truth: rarime-android-app
    // BaseConfig.kt::MainnetConfig.VOTING_RELAYER_URL.
    votingRelayerUrl: 'https://api.freedomtool.org',
    votingRpcUrl: 'https://l2.rarimo.com',
  },
};

// ---------------------------------------------------------------------------
// Mainnet-only constants used by the registerViaNoir path (utils/register-via-noir.ts).
// On testnet we don't have a working heavy-path equivalent yet — the helper
// throws on testnet rather than silently switching.
// ---------------------------------------------------------------------------
export const MAINNET_REGISTRATION_CONTRACT_ADDRESS =
  '0x11BB4B14AA6e4b836580F3DBBa741dD89423B971'; // Registration2
export const MAINNET_CERT_POSEIDON_SMT_ADDRESS =
  '0xA8b350d699632569D5351B20ffC1b31202AcEDD8'; // CertificatesSMT (CSCA tree root)

// ---------------------------------------------------------------------------
// Per-network getters. These are the only things callers should reach for —
// the *_CONFIG constants above are implementation detail.
// ---------------------------------------------------------------------------
export const getRarimeConfig = (network: Network) =>
  network === 'mainnet' ? RARIME_MAINNET_CONFIG : RARIME_TESTNET_CONFIG;

export const getFreedomToolConfig = (network: Network) =>
  network === 'mainnet' ? FREEDOM_TOOL_MAINNET_CONFIG : FREEDOM_TOOL_TESTNET_CONFIG;

/** Block explorer base URL for the active network — used to deep-link a tx
 * hash in the verifier tab and in success screens. */
export const getExplorerTxBaseUrl = (network: Network) =>
  network === 'mainnet'
    ? 'https://scan.rarimo.com/tx/'
    : 'https://scan.qtestnet.org/tx/';

/** Default proposal to load on the home screen when no specific one is
 * requested. Mainnet & testnet maintain independent proposal-id spaces; the
 * testnet id `236` was the QA one, mainnet's value comes from the FreedomTool
 * deployment. Either side may be overridden by a deep link param. */
export const getDefaultProposalId = (network: Network) =>
  network === 'mainnet' ? '1' : '236';

// Kept for legacy callers that still import the old name. New code should use
// getDefaultProposalId(network).
export const DEFAULT_PROPOSAL_ID = '236';

// Legacy alias kept so existing imports don't break in this PR — points to
// testnet. New code should use getExplorerTxBaseUrl(network).
export const EXPLORER_TX_BASE_URL = 'https://scan.qtestnet.org/tx/';

// Legacy alias for the testnet FreedomTool config (kept until call sites are
// migrated to getFreedomToolConfig(network)).
export const FREEDOM_TOOL_CONFIG = FREEDOM_TOOL_TESTNET_CONFIG;

export const PRIVATE_KEY_STORAGE_KEY = 'rarime_bjj_private_key';

/**
 * Retry wrapper for flaky RPC calls.
 * Retries up to `maxRetries` times with `delayMs` between attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 2, delayMs = 3000, label = 'RPC call', onRetry }: {
    maxRetries?: number;
    delayMs?: number;
    label?: string;
    onRetry?: (attempt: number, maxAttempts: number, error: unknown) => void;
  } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        console.warn(
          `[withRetry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`,
          err
        );
        onRetry?.(attempt + 1, maxRetries + 1, err);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Formats an unknown error into a user-facing message.
 */
export function formatRpcError(err: unknown): string {
  // Lazy-require i18n so this file stays safe to import in test contexts
  // where i18next isn't initialised. Each branch supplies a defaultValue
  // so the result is still correct if the key is missing or i18n isn't up.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18nMod = require('i18next');
  const i18n = i18nMod.default ?? i18nMod;
  const t = (key: string, defaultValue: string) =>
    typeof i18n?.t === 'function' ? i18n.t(key, { defaultValue }) : defaultValue;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
      return t('voting.errors.network', 'Erreur réseau — vérifiez votre connexion et réessayez.');
    }
    if (msg.includes('already registered') || msg.includes('duplicate')) {
      return t('voting.errors.alreadyRegistered', 'Identité déjà enregistrée.');
    }
    if (msg.includes('already voted')) {
      return t('voting.errors.alreadyVoted', 'Vous avez déjà voté pour cette proposition.');
    }
    if (msg.includes('403') || msg.includes('forbidden')) {
      return t('voting.errors.forbidden', 'Accès refusé par le serveur. Réessayez plus tard.');
    }
    if (msg.includes('revert') || msg.includes('invalid_proof')) {
      return t('voting.errors.verificationFailed', 'La vérification a échoué. Veuillez rescanner votre carte et réessayer.');
    }
    return t('voting.errors.generic', 'Une erreur est survenue. Veuillez réessayer.');
  }
  return t('voting.errors.unexpected', 'Une erreur inattendue est survenue. Veuillez réessayer.');
}
