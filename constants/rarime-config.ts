/**
 * Centralized Rarime / FreedomTool configuration.
 * Single source of truth — imported by all screens that use the SDK.
 */

export const RARIME_TESTNET_CONFIG = {
  contractsConfiguration: {
    stateKeeperAddress: "0x12883d5F530AF7EC2adD7cEC29Cf84215efCf4D8",
    registerSimpleContractAddress:
      "0x1b6ae4b80F0f26DC53731D1d7aA31fc3996B513B",
    poseidonSmtAddress: "0xb8bAac4C443097d697F87CC35C5d6B06dDe64D60",
  },
  apiConfiguration: {
    jsonRpcEvmUrl: "https://rpc.qtestnet.org",
    rarimeApiUrl: "https://api.orgs.app.stage.rarime.com",
  },
};

export const FREEDOM_TOOL_CONFIG = {
  contracts: {
    proposalStateAddress: "0x4C61d7454653720DAb9e26Ca25dc7B8a5cf7065b",
  },
  api: {
    ipfsUrl: "https://ipfs.rarimo.com",
    votingRelayerUrl: "https://api.stage.freedomtool.org",
    votingRpcUrl: "https://rpc.qtestnet.org",
  },
};

export const PRIVATE_KEY_STORAGE_KEY = "rarime_bjj_private_key";

export const DEFAULT_PROPOSAL_ID = "236";

/**
 * Retry wrapper for flaky RPC calls.
 * Retries up to `maxRetries` times with `delayMs` between attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 2, delayMs = 3000, label = "RPC call", onRetry }: {
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
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) {
      return "Erreur réseau — vérifiez votre connexion et réessayez.";
    }
    if (msg.includes("already registered") || msg.includes("duplicate")) {
      return "Identité déjà enregistrée.";
    }
    if (msg.includes("already voted")) {
      return "Vous avez déjà voté pour cette proposition.";
    }
    if (msg.includes("403") || msg.includes("forbidden")) {
      return "Accès refusé par le serveur. Réessayez plus tard.";
    }
    if (msg.includes("revert") || msg.includes("invalid_proof")) {
      return "La vérification a échoué. Veuillez rescanner votre carte et réessayer.";
    }
    return "Une erreur est survenue. Veuillez réessayer.";
  }
  return "Une erreur inattendue est survenue. Veuillez réessayer.";
}
