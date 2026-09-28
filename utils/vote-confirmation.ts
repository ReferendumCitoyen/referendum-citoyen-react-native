/**
 * On-chain confirmation of a submitted vote.
 *
 * Why this exists
 * ---------------
 * The Rarimo vote relayer (`/v2/vote`) returns a tx hash the moment it
 * *broadcasts* the transaction — NOT when the tx is mined. A transaction that
 * later reverts on-chain (e.g. an identity registered after the proposal's
 * `identityCreationTimestampUpperBound`, a failed Groth16 verification, or a
 * used nullifier) still has a valid hash and decodable `vote(...)` calldata.
 *
 * Treating "relayer accepted" or "tx exists" as "vote counted" is the bug this
 * module fixes: both the post-vote success screen and the verifier tab must
 * gate on the on-chain receipt's `status === 1`. A reverted tx
 * (`status === 0`) means the vote was NOT registered and must surface as an
 * error, not a green success.
 */

export type VoteTxStatus = 'success' | 'reverted' | 'pending';

interface ReceiptLike {
  /** ethers v6 returns `number | null`; some providers/decoders surface a
   * bigint. Accept both. `null`/absent ⇒ not yet mined. */
  status?: number | bigint | null;
}

interface ReceiptProvider {
  getTransactionReceipt(hash: string): Promise<ReceiptLike | null>;
}

/**
 * Pure classification of a transaction receipt.
 * - no receipt (null/undefined)        → 'pending' (not yet mined)
 * - receipt with status === 1          → 'success'
 * - receipt with status === 0          → 'reverted'
 * - receipt with null/undefined status → 'pending' (status unknown)
 */
export function classifyReceipt(receipt: ReceiptLike | null | undefined): VoteTxStatus {
  if (!receipt) return 'pending';
  const s = receipt.status;
  if (s === null || s === undefined) return 'pending';
  const ok = typeof s === 'bigint' ? s === 1n : Number(s) === 1;
  return ok ? 'success' : 'reverted';
}

/**
 * Poll the voting RPC for the tx receipt until it is mined (status known) or
 * the timeout elapses. Mirrors the registration confirmation poll in
 * `components/voting-modal/Step7.tsx`. Returns:
 *   'success'  — mined, status 1 (vote counted)
 *   'reverted' — mined, status 0 (vote NOT counted)
 *   'pending'  — still not mined when the timeout elapsed
 *
 * Transient RPC errors during polling are swallowed and treated as 'pending'
 * so a flaky read doesn't masquerade as a revert.
 */
export async function waitForVoteReceipt(
  provider: ReceiptProvider,
  txHash: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<VoteTxStatus> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 2_500;
  const start = Date.now();

  for (;;) {
    let receipt: ReceiptLike | null = null;
    try {
      receipt = await provider.getTransactionReceipt(txHash);
    } catch {
      // Transient RPC hiccup — keep polling, don't misreport as reverted.
    }
    const status = classifyReceipt(receipt);
    if (status !== 'pending') return status;
    if (Date.now() - start >= timeoutMs) return 'pending';
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
