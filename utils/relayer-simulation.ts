/**
 * Dry-run a relayer submission on chain before sending it.
 *
 * The registration relayer answers every failed transaction with an opaque
 * HTTP 500, whether the node was down or the contract reverted — and when it
 * reverts, the reason ("StateKeeper: identity already registered",
 * "SparseMerkleTree: the key already exists", "StateKeeper: certificate is
 * expired") is the single most useful line a report could carry. Nobody saw
 * one for the whole of the 2026-09-05 → 09-08 registration outage; the app
 * said "service temporarily unavailable" throughout.
 *
 * An eth_call of the same calldata, from the relayer's own address, returns
 * that reason for free. A revert here is authoritative — the real transaction
 * would do the same. Anything else (network, timeout, an RPC that refuses
 * the call) is not, and the submission proceeds exactly as before.
 */
import { ethers } from 'ethers';
import {
  RARIME_MAINNET_CONFIG,
  MAINNET_REGISTRATION_RELAYER_EOA,
} from '@/constants/rarime-config';

import { IDENTITY_BOUND_ELSEWHERE, REGISTRATION_REVERT } from '@/utils/registration-sentinels';

// The sentinels this module throws with. Defined in registration-sentinels.ts
// (no imports there) and re-exported so existing callers keep one import.
export { IDENTITY_BOUND_ELSEWHERE, REGISTRATION_REVERT };

const ERROR_STRING_SELECTOR = '0x08c379a0';
const PANIC_SELECTOR = '0x4e487b71';

/**
 * The revert reason carried by an ethers v6 call exception, or null when the
 * error is not a revert at all (transport failure, timeout, bad response).
 * Nodes disagree about where they put it, so every known place is tried.
 */
export function revertReasonOf(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const err = e as {
    code?: unknown;
    data?: unknown;
    info?: { error?: { data?: unknown; message?: unknown } };
    reason?: unknown;
    shortMessage?: unknown;
    message?: unknown;
  };

  // Error(string) payload, wherever the node put it.
  const data = typeof err.data === 'string' ? err.data : err.info?.error?.data;
  if (typeof data === 'string' && data.startsWith(ERROR_STRING_SELECTOR)) {
    try {
      const [reason] = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10));
      return String(reason);
    } catch {
      // Malformed payload — fall through to the text forms.
    }
  }
  // Anything else with a body is a Panic or a custom error, and a custom
  // error is exactly what an UltraPlonk verifier throws on a proof it does
  // not accept (a verification key that does not match the circuit gives one
  // with no string at all). ethers leaves `reason` null for those, and the
  // text forms below would say only "execution reverted" — which is what the
  // report said for a whole outage. The selector is enough to look it up.
  if (typeof data === 'string' && data.length > 2) {
    if (data.startsWith(PANIC_SELECTOR)) {
      try {
        const [code] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + data.slice(10));
        return `panic 0x${BigInt(code).toString(16)}`;
      } catch {
        // Fall through and report the raw selector instead.
      }
    }
    const bytes = Math.floor((data.length - 2) / 2);
    return `custom error ${data.slice(0, 10)} (${bytes} bytes of revert data)`;
  }
  if (typeof err.reason === 'string' && err.reason) return err.reason;

  // Nodes that only put the reason in a message — ethers may then wrap it
  // ("missing revert data"), so every message it carries is tried.
  const messages = [err.shortMessage, err.info?.error?.message, err.message].filter(
    (m): m is string => typeof m === 'string' && m.length > 0,
  );
  for (const message of messages) {
    const reverted = /execution reverted(?::\s*(.*))?$/i.exec(message);
    if (reverted) return (reverted[1] ?? '').trim() || 'execution reverted';
  }
  if (err.code === 'CALL_EXCEPTION') return messages[0] ?? 'call exception';
  return null;
}

export interface SimulatedCall {
  from: string;
  to: string;
  data: string;
}

/** eth_call, injectable so the decision logic is testable without a node. */
export type CallFn = (tx: SimulatedCall) => Promise<string>;

const defaultCall: CallFn = (tx) =>
  new ethers.JsonRpcProvider(RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl).call(tx);

/**
 * Throw, with the on-chain reason, if `calldata` would revert at
 * `destination`. Resolves when the call succeeds — and also when the
 * simulation itself could not run, which is logged and otherwise ignored so
 * a flaky RPC never blocks a registration the relayer would have accepted.
 */
export async function assertWouldNotRevert(
  args: { calldata: string; destination: string; label: string },
  call: CallFn = defaultCall,
): Promise<void> {
  const { calldata, destination, label } = args;
  try {
    await call({ from: MAINNET_REGISTRATION_RELAYER_EOA, to: destination, data: calldata });
    console.log(`[simulate] ${label} would succeed`);
  } catch (e) {
    const reason = revertReasonOf(e);
    if (reason === null) {
      const detail = (e as { message?: string })?.message ?? String(e);
      console.warn(`[simulate] ${label}: could not simulate (${detail}) — submitting anyway`);
      return;
    }
    console.warn(`[simulate] ${label} would revert: ${reason}`);
    if (/identity already registered/i.test(reason)) {
      throw new Error(`${IDENTITY_BOUND_ELSEWHERE} ${reason}`);
    }
    throw new Error(`${REGISTRATION_REVERT} ${reason}`);
  }
}
