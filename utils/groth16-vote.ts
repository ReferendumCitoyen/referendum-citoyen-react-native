/**
 * Orchestrator for the Mainnet vote step's Groth16 query proof.
 *
 * Sequence (mirrors rarime-android-app's VotingManager.generateVoteProof):
 *
 *   1. Build the inputs JSON via utils/query-identity-inputs.ts.
 *   2. Load the bundled .dat (assets/circuits/query_identity.dat).
 *   3. Ensure the 757 MB circuit_final.zkey is on local FS — download on
 *      first run from the public Rarimo GCS bucket, cache forever.
 *   4. Run witnesscalc via WitnesscalculatorModule.calcWtnsQueryIdentity()
 *      (our custom JNI shim → libwitnesscalc_queryIdentity.so).
 *   5. Run rapidsnark via RapidsnarkWrpModule.groth16ProveWithZKeyFilePath()
 *      against the local zkey file.
 *   6. Parse the prover JSON into a typed Groth16Proof.
 *
 * Output shape matches what the Mainnet `BioPassportVoting.vote(...)`
 * function expects for its `zkPoints_` argument:
 *   { a: [uint256, uint256],
 *     b: [[uint256, uint256], [uint256, uint256]],
 *     c: [uint256, uint256],
 *     pub_signals: bigint[] }
 *
 * The pub_signals are needed by the calldata builder to extract
 * registration root, current date, nullifier, etc. — see utils/vote-calldata.ts.
 *
 * Where it lives: this file does *only* the proof generation. Calldata
 * encoding + relayer POST are in utils/vote-calldata.ts so each piece can
 * be unit-tested in isolation.
 */

import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
// Native modules — the witnesscalc binding for queryIdentity ships with this
// repo (modules/witnesscalculator/android/src/main/cpp/queryIdentity.cpp,
// jniLibs/<ABI>/libwitnesscalc_queryIdentity.so); the rapidsnark prover comes
// from the inid-passport-debug port (modules/rapidsnark-wrp).
import WitnesscalculatorModule from '@modules/witnesscalculator/src/WitnesscalculatorModule';
import { groth16ProveWithZKeyFilePath } from '@modules/rapidsnark-wrp';

/** The query_identity Groth16 zkey is 14.5 MB — small enough to bundle. The
 * GCS `storage.googleapis.com/rarimo-store/zkey/circuit_final.zkey` URL hosts
 * the FACE_REGISTRY zkey (~757 MB, 1.1M-witness circuit), not query_identity,
 * which caused `RapidsnarkProverError$InvalidWitnessLength: Circuit: 1111652,
 * witness: 24270`. The real query_identity zkey lives in the iOS Rarime app
 * bundle at `Rarime/Resources/Assets.xcassets/Circuits/queryIdentityZkey.dataset/circuit_final.zkey`;
 * we ship the same bytes (sha256 754b2bd2…b72b) bundled at
 * `assets/circuits/query_identity.zkey`. */

/** Standard Groth16 proof points + pub signals shape, matching rapidsnark's
 * JSON output. `b` is row-major: [[b00, b01], [b10, b11]]. */
export interface Groth16Proof {
  proof: {
    pi_a: [string, string, string]; // 3 strings — z coord is 1 by convention
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: 'groth16';
    curve?: string;
  };
  pub_signals: string[];
}

/**
 * Read the bundled query_identity.dat into memory.
 *
 * Uses Expo Asset to materialise the require()'d file from the bundle into
 * a readable URI, then loads bytes. The .dat is ~1.2 MB — small enough to
 * load synchronously into JS memory before calling the native witnesscalc.
 */
async function loadQueryIdentityDat(): Promise<Uint8Array> {
  // require() returns an opaque module number which Asset.fromModule
  // resolves to an Asset with a downloadable URI (in dev mode Metro serves
  // it over HTTP; in release the file is unpacked from the APK).
  const asset = Asset.fromModule(require('@/assets/circuits/query_identity.dat'));
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  if (!asset.localUri) {
    throw new Error('[groth16-vote] failed to materialise query_identity.dat');
  }
  const base64 = await FileSystem.readAsStringAsync(asset.localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** Kept in the public API for callers that still wire a progress callback
 * (e.g., Step11's `setStatusText`). With the bundled zkey we never actually
 * download, so the callback is never invoked — but the type stays around so
 * removing it doesn't ripple. */
export interface ZkeyDownloadProgress {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
}

/**
 * Materialise the bundled `assets/circuits/query_identity.zkey` into the app
 * sandbox and return the plain absolute path (no `file://` prefix) ready to
 * hand to rapidsnark.
 *
 * Expo Asset.fromModule resolves `require(...)` of a bundled binary into an
 * URI. In dev that's a Metro HTTP URL; in release the asset is unpacked from
 * the APK to a cache dir on first access. Calling downloadAsync() forces the
 * unpack so we have a real local file. After the first run the file is
 * already on disk and downloadAsync() is a no-op.
 */
export async function ensureZkey(_onProgress?: (p: ZkeyDownloadProgress) => void): Promise<string> {
  // The file is named `query_identity_zkey.zkey` (not just `.zkey`) to avoid
  // colliding with `query_identity.dat` in Android's `res/raw/`, which
  // packs both under the same resource id (extension is stripped, so
  // `query_identity.dat` and `query_identity.zkey` both want
  // `raw/query_identity`).
  const asset = Asset.fromModule(require('@/assets/circuits/query_identity_zkey.zkey'));
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  if (!asset.localUri) {
    throw new Error('[groth16-vote] failed to materialise query_identity.zkey from bundle');
  }
  console.log(`[groth16-vote] zkey ready at ${asset.localUri}`);
  // strip file:// prefix because rapidsnark wants a plain absolute path
  return asset.localUri.replace(/^file:\/\//, '');
}

export interface GenerateQueryProofArgs {
  /** Inputs JSON object from utils/query-identity-inputs.ts. */
  inputs: Record<string, unknown>;
  /** Optional download progress callback for the first-run zkey fetch. */
  onZkeyProgress?: (p: ZkeyDownloadProgress) => void;
}

/**
 * End-to-end Groth16 query proof generation. Loads inputs, runs witnesscalc
 * + rapidsnark, and returns the typed proof object.
 *
 * Expected runtime on a phone is dominated by rapidsnark — historical
 * numbers from the Android app suggest 8–15 s for a 2048-bit RSA passport
 * on a midrange device. Witnesscalc itself is a couple of seconds at most.
 */
export async function generateQueryGroth16Proof(args: GenerateQueryProofArgs): Promise<Groth16Proof> {
  const t0 = Date.now();
  const datBytes = await loadQueryIdentityDat();
  console.log(`[groth16-vote] dat loaded: ${datBytes.length} bytes`);

  const zkeyPath = await ensureZkey(args.onZkeyProgress);
  console.log(`[groth16-vote] zkey ready at ${zkeyPath}`);

  const inputsJson = JSON.stringify(args.inputs);
  const inputsBytes = new Uint8Array(Buffer.from(inputsJson, 'utf8'));

  // SECURITY: the inputs dump and the SMT-leaf pre-compute below both log
  // identity-correlating bytes (skIdentity, pkPassportHash, eventId, leaf
  // hashes, SMT siblings). They were left in for one-shot witnesscalc
  // shape debugging; gating them out of release prevents the ring buffer
  // from holding those per-passport identifiers in error reports. The
  // hardcoded chain-leaf at the end of the smtcheck block was a single
  // dev-session reference and would mislead future log readers if shown
  // alongside someone else's computed leaf.
  if (__DEV__) {
    // Dump per-key type + size — witnesscalc errors with "Error loading
    // signal X / assert failed" are almost always a shape mismatch
    // (scalar vs array, or wrong array length). Printing the structure
    // makes those obvious from a single logcat dump.
    for (const [k, v] of Object.entries(args.inputs)) {
      if (Array.isArray(v)) {
        console.log(`[groth16-vote][inputs] ${k}: array[${v.length}] sample=${JSON.stringify(v.slice(0, 2))}`);
      } else {
        console.log(`[groth16-vote][inputs] ${k}: ${typeof v} value=${JSON.stringify(v)}`);
      }
    }

    // Locally compute the SMT leaf the circuit will derive from
    // dg1/skIdentity/identityCounter/timestamp. The on-chain SMT proof
    // has a fixed leaf value at our index; if our computed leaf doesn't
    // match, the circuit's `smtVerifier.isVerified === 1` will fail
    // with "assert failed" — which is exactly what we were seeing.
    // Witnesscalc reports the last-set signal name (timestampUpperbound,
    // alphabetically last) so the error is misleading.
    try {
      const { Poseidon } = await import('@iden3/js-crypto');
      const inp = args.inputs as any;
      const dg1Bits: number[] = inp.dg1;
      // The circuit splits dg1 into 4 chunks of 186 bits and uses
      // Bits2Num (in[k] * 2^k → LSB-first). Replicate that exactly.
      const chunks: bigint[] = [0n, 0n, 0n, 0n];
      for (let c = 0; c < 4; c++) {
        let acc = 0n;
        for (let k = 0; k < 186; k++) {
          if (dg1Bits[c * 186 + k]) acc |= 1n << BigInt(k);
        }
        chunks[c] = acc;
      }
      const skIdentity = BigInt(inp.skIdentity);
      const skHash = Poseidon.hash([skIdentity]);
      const dgCommit = Poseidon.hash([chunks[0], chunks[1], chunks[2], chunks[3], skHash]);
      const identityCounter = BigInt(inp.identityCounter);
      const timestamp = BigInt(inp.timestamp);
      const leaf = Poseidon.hash([dgCommit, identityCounter, timestamp]);
      const hex = (b: bigint) => '0x' + b.toString(16).padStart(64, '0');
      console.log(`[groth16-vote][smtcheck] computed dgCommit=${hex(dgCommit)}`);
      console.log(`[groth16-vote][smtcheck] computed leaf   =${hex(leaf)}`);
    } catch (e: any) {
      console.log('[groth16-vote][smtcheck] failed to pre-compute leaf:', e?.message ?? e);
    }
  }

  // Witnesscalc: dat + inputs → wtns. Native call, ~1–3 s on a phone.
  console.log('[groth16-vote] witnesscalc starting…');
  const t1 = Date.now();
  const wtns: Uint8Array = await (WitnesscalculatorModule as any).calcWtnsQueryIdentity(
    datBytes,
    inputsBytes,
  );
  console.log(`[groth16-vote] witnesscalc OK in ${Date.now() - t1}ms; wtns=${wtns.length} bytes`);

  // Rapidsnark: wtns + zkey path → Groth16 proof JSON (utf8 bytes). ~8–15s.
  console.log('[groth16-vote] rapidsnark starting…');
  const t2 = Date.now();
  const proofBytes = await groth16ProveWithZKeyFilePath(wtns, zkeyPath);
  console.log(`[groth16-vote] rapidsnark OK in ${Date.now() - t2}ms; proof JSON=${proofBytes.length} bytes`);

  const proofJsonStr = Buffer.from(proofBytes).toString('utf8');
  // The prover output combines proof + pub signals in a single JSON object
  // shaped { pi_a, pi_b, pi_c, protocol, pub_signals }. Some rapidsnark
  // variants split them into two roots — we handle either by re-nesting
  // into the consumer-friendly { proof, pub_signals } shape.
  const parsed = JSON.parse(proofJsonStr);
  const proof: Groth16Proof['proof'] =
    parsed.proof ?? {
      pi_a: parsed.pi_a,
      pi_b: parsed.pi_b,
      pi_c: parsed.pi_c,
      protocol: parsed.protocol,
      curve: parsed.curve,
    };
  const pub_signals: string[] = parsed.pub_signals ?? parsed.publicSignals ?? [];

  console.log(
    `[groth16-vote] total elapsed=${Date.now() - t0}ms pub_signals=${pub_signals.length}`,
  );
  return { proof, pub_signals };
}
