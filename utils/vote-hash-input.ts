import { closedCode } from './logger';

/**
 * The Vérifier field: a vote's serial number is its transaction hash, 0x and
 * 64 hex characters. Anything else is refused BEFORE a request is made.
 *
 * Why: the page used to hand whatever was typed straight to the RPC
 * (provider.getTransaction) and then log the ethers error, which quotes the
 * value it was given. A person pasting the wrong thing (their CAN, a
 * sentence, an address) sent it to a third-party node and wrote it into the
 * log a report carries.
 *
 * Returns the hash to look up (trimmed, lower-cased), or null.
 */
export function parseVoteTxHash(input: string): string | null {
  const v = input.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : null;
}

const LOOKUP_ERROR_CODES = [
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVER_ERROR',
  'BAD_DATA',
  'CALL_EXCEPTION',
  'UNKNOWN_ERROR',
  'INVALID_ARGUMENT',
] as const;

/** What the Vérifier may log about a failed lookup: the ethers error code
 *  from a closed list, never the message (it quotes the request). */
export function lookupErrorCode(err: unknown): string {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return closedCode(code, LOOKUP_ERROR_CODES);
}
