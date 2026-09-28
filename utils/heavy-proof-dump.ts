/**
 * Dev-only capture of a heavy Noir register proof so it can be verified
 * off-chain on a laptop.
 *
 * Why this exists
 * ---------------
 * To split "did the prover emit a well-formed proof for this circuit" from
 * "did the chain accept it": real document → circuit → proof generates →
 * `bb verify` accepts it against the matching `.vk` in `circuits/`. That means
 * the proof has to physically leave the phone. `generateHeavyNoirProof` calls
 * this for EVERY heavy proof under `__DEV__`, TD3 and TD1 alike, so it is a
 * general prover-side diagnostic and not a TD1 workaround.
 *
 * It is no longer the ONLY success criterion, and this header used to say it
 * was. That claim rested on the TD1 (CNIe) zkType
 * `keccak("Z_NOIR_PASSPORT_1_256_1_6_960_248_NA")` being unregistered in
 * Mainnet `Registration2.passportVerifiers`, which made the `registerViaNoir`
 * submit after proof generation revert by design and left off-chain
 * verification as the only thing that could pass. That read returned the zero
 * address when last taken on 2026-08-24; verified live 2026-08-31 (block
 * 0x108fe) the same mapping resolves to a deployed Aztec verifier at
 * 0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658, whose runtime bytecode embeds
 * the Verification Key Hash of the `.sol` we ship, and which the circuit
 * author has declared final. Provenance in `constants/td1-heavy-register.ts`;
 * the on-chain leg is real for TD1 as it has always been for TD3.
 *
 * So the bar is now end to end — proof → `registerViaNoir` submits → the tx
 * lands on Rarimo L2 → Step7's SMT poll confirms the bond → the card votes —
 * and a passing `bb verify` on its own is not the deliverable. Reach for this
 * dump when an on-chain submit fails and you need to know which half broke.
 * Recipe in `circuits/README.md`.
 *
 * Why not the existing error-report path
 * --------------------------------------
 * It can't carry this. `utils/logger.ts::redact` rewrites `\b[a-f0-9]{64}\b`
 * to `<hex64>` (each pub_signal is exactly that) and `(?:0x)?[a-fA-F0-9]{32,}`
 * to `<hex>` (the proof), and `utils/error-reporter.ts` builds its attachment
 * from that already-redacted ring buffer. A plain `console.log` doesn't work
 * either on the case that matters: the payload is 4608 hex chars and Android's
 * logd truncates a single entry at ~4 KB, so a release build read over
 * `adb logcat` silently loses the tail (Metro-connected dev builds don't, which
 * is what makes it a trap). Hence: write a file, open the share sheet.
 *
 * Note `expo-file-system/legacy`: every
 * call site in this repo uses the legacy surface, because expo-file-system 19's
 * default export is the new File/Directory API where `documentDirectory` /
 * `writeAsStringAsync` don't exist.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { HeavyNoirProof } from '@/utils/register-via-noir';

/**
 * Reassemble the barretenberg proof-file byte layout from the SDK's split.
 *
 * `NoirCircuitParams.prove()` receives ONE hex string from native `provePlonk`
 * and slices it (see the SDK's `src/RnNoirModule.ts`): the first
 * `pub_signals_count * 64` hex chars become `pub_signals`, the remainder is
 * `proof`. So the native output already IS the conventional bb layout
 * `publicInputs (32 B big-endian each) || proofBytes`, and simply
 * re-concatenating in order reproduces it byte-for-byte. Do not reorder and do
 * not add a `0x` prefix.
 *
 * Expected size for both heavy register circuits: 5 * 32 + 2144 = 2304 bytes
 * = 4608 hex chars. The 2144 is the proof length the Aztec verifier `.sol`
 * reads (highest proof calldata offset `add(data_ptr, 0x840)` = 2112, +0x20).
 */
export function toBbProofHex(proof: HeavyNoirProof): string {
  return proof.pub_signals.join('') + proof.proof;
}

const EXPECTED_BB_PROOF_HEX_CHARS = 4608;

/**
 * Write `{circuitName, pub_signals, proof, bbProofHex}` to the app's document
 * directory and offer it to the share sheet.
 *
 * Both forms are emitted on purpose. Which one `bb` wants depends on its
 * version — later releases dropped UltraPlonk and split the proof file into
 * separate `proof` + `public_inputs` files — and re-shaping on a laptop is
 * free, whereas re-capturing costs another NFC session plus ~20 s of prover
 * time. See `circuits/README.md`.
 *
 * No-ops outside `__DEV__`. Never throws: a failed dump must not take down a
 * registration that otherwise succeeded, so every failure is logged and
 * swallowed.
 *
 * `documentDirectory` rather than `cacheDirectory`: Android has been observed
 * reaping the cache dir mid-session (see the note in `utils/groth16-vote.ts`).
 */
export async function dumpHeavyProof(
  proof: HeavyNoirProof,
  circuitName: string,
): Promise<void> {
  if (!__DEV__) return;

  try {
    const bbProofHex = toBbProofHex(proof);
    // Shape check first — a wrong length is the first thing that goes wrong
    // (e.g. a `pub_signals_count` drift in the SDK circuit registry silently
    // mis-slicing the prover output), and it is much easier to spot here than
    // as an opaque `bb verify` rejection an hour later. Warn, don't throw:
    // the dump is still worth having even if the size is unexpected.
    if (bbProofHex.length !== EXPECTED_BB_PROOF_HEX_CHARS) {
      console.warn(
        `[heavy-proof-dump] unexpected payload size: ${bbProofHex.length} hex chars ` +
        `(expected ${EXPECTED_BB_PROOF_HEX_CHARS} = 5 pub_signals * 64 + 2144-byte proof * 2). ` +
        `pub_signals=${proof.pub_signals.length} proofLen=${proof.proof.length}`,
      );
    }

    const payload = JSON.stringify(
      {
        circuitName,
        capturedAt: new Date().toISOString(),
        pub_signals: proof.pub_signals,
        proof: proof.proof,
        bbProofHex,
      },
      null,
      2,
    );

    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!dir) {
      console.warn('[heavy-proof-dump] no writable directory — falling back to chunked log');
      logHeavyProofChunked(proof, circuitName);
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${dir}heavy-proof-${circuitName}-${stamp}.json`;
    await FileSystem.writeAsStringAsync(path, payload);
    console.log(`[heavy-proof-dump] written to ${path} (${payload.length} chars)`);

    if (await Sharing.isAvailableAsync()) {
      // Blocks until the tester dismisses the sheet. That's intentional: this
      // only runs in dev, and the point is to get the file off the phone
      // BEFORE the relayer submit runs, so the prover-side artifact survives
      // whatever the chain then does with it — a submit that reverts or a
      // relayer that 500s is exactly when you want the proof on a laptop.
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: 'Heavy Noir proof (dev)',
        UTI: 'public.json',
      });
    } else {
      console.warn('[heavy-proof-dump] sharing unavailable — falling back to chunked log');
      logHeavyProofChunked(proof, circuitName);
    }
  } catch (e: any) {
    console.error('[heavy-proof-dump] dump failed:', e?.message ?? e);
  }
}

/**
 * Last-resort fallback when the file can't be written or shared.
 *
 * Emitted in 512-char chunks because Android's logd caps one entry at ~4 KB
 * (LOGGER_ENTRY_MAX_PAYLOAD) and the payload is 4608 chars — a single
 * `console.log` would be cut with no indication that it happened.
 *
 * SECURITY: pub_signals[1] is the passportHash and pub_signals[3] is the BJJ
 * identityKey. Both are deterministic per document and stable across sessions,
 * so logging them in release would let anyone reading logcat correlate the same
 * document across registration attempts — the same reasoning as the slave-SMT
 * leaf log in utils/register-via-noir.ts. `dumpHeavyProof` already returns
 * early outside `__DEV__`; the guard is repeated here so this stays safe if it
 * is ever called from somewhere else.
 */
export function logHeavyProofChunked(proof: HeavyNoirProof, circuitName: string): void {
  if (!__DEV__) return;
  const hex = toBbProofHex(proof);
  const CHUNK = 512;
  console.log(
    `[heavy-proof-dump] ${circuitName} bb payload, ${hex.length} hex chars in ` +
    `${Math.ceil(hex.length / CHUNK)} chunks — concatenate in index order:`,
  );
  for (let i = 0; i * CHUNK < hex.length; i++) {
    console.log(`[heavy-proof-dump][${i}] ${hex.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
}
