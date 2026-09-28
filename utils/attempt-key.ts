/**
 * The key of one voting attempt (dossier 2.0.2, R2 / item 14 a, f, g).
 *
 * TODO(DECISION-D3): items 14 f to h (this capture) and 16 (proof bound to
 * its root) ship only after the protocol partner's validation (protocol
 * lead).
 *
 * Resolved once for the scanned document (voting-flow handleNFCSuccess), then
 * passed as a VALUE to the SDK instance, the Step 7 status read, the
 * one-document checks, the heavy registration proof and the passport vote.
 * None of them re-reads the global legacy slot, which a later scan of another
 * document rewrites: that re-read is how a surviving run for card X could
 * register X on chain with card Y's key, irreversibly.
 *
 * In memory only. Never logged, never persisted, never put in a report: the
 * only thing about it that is ever logged is `keySource`.
 */
import type { ResolvedPassportKey } from '@/utils/identity';

export type KeySourceLabel = 'per-document' | 'legacy-fallback';

export interface AttemptKey {
  /** 64-hex BJJ private key bound to this document. */
  privateKey: string;
  /** SHA-256(DG1 ‖ SOD) of the document it was resolved for. */
  passportHash: string;
  keySource: KeySourceLabel;
}

/**
 * Resolve the attempt's key for one scanned document. A failure propagates
 * to the caller, which stops the attempt (dossier 2.0.2, item 14 f): there is
 * deliberately no fallback to "whatever the global slot holds", since proving
 * or registering with another document's key is irreversible.
 */
export async function resolveAttemptKey(doc: {
  dg1: Uint8Array;
  sod: Uint8Array;
  dg11?: Uint8Array;
}): Promise<{ key: AttemptKey; resolved: ResolvedPassportKey }> {
  const { getOrCreateKeyForPassport } = await import('@/utils/identity');
  const resolved = await getOrCreateKeyForPassport(doc);
  return {
    resolved,
    key: {
      privateKey: resolved.privateKey,
      passportHash: resolved.passportHash,
      // "legacy-fallback": the document had no row and adopted the key of
      // the pre-DB single slot (identity.ts migration path).
      keySource: resolved.migratedFromLegacy ? 'legacy-fallback' : 'per-document',
    },
  };
}
