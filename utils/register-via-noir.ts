/**
 * Build calldata for `Registration2.registerViaNoir(...)` and submit it to
 * Rarimo's `/integrations/registration-relayer/v1/register` endpoint.
 *
 * Why this exists
 * ---------------
 * `@rarimo/rarime-rn-sdk@0.3.1`'s `Rarime.registerIdentity()` runs a *light*
 * Noir circuit (`register_light_<n>`) and posts the resulting proof to
 * `incognito-light-registrator/v1/registerid` for the server to do the
 * CSCA/slave-cert verification off-chain. That endpoint currently returns
 * HTTP 400 for TD3 passports (see HANDOFF-FRENCH-PASSPORT.md) — the schema
 * accepts Groth16 proofs but the SDK sends Noir base64.
 *
 * The *heavy* path used by the production rarime-iOS-app (and decoded from
 * the user's own successful Mainnet tx at block 2330) skips that hosted
 * service entirely. The heavy Noir circuit `registerIdentity_<suite>` proves
 * the slave-cert chain in-zk, the proof is verified on-chain by
 * `Registration2.registerViaNoir(...)`, and the relayer is just a tx
 * submitter (no proof inspection). Result: no light-registrator dependency,
 * no Groth16-vs-Noir schema mismatch.
 *
 * Source of truth for the calldata layout: rarimo/rarime-mobile-identity-sdk
 *   calldata.go::BuildNoirRegisterCalldata + newNoirRegistrationProof.
 *
 * Verified against the on-chain tx — both keccak constants for our French
 * passport match byte-for-byte (see CHECK script at the bottom of this file).
 */

import { ethers } from 'ethers';
import i18n from 'i18next';
import {
  Network,
  MAINNET_REGISTRATION_CONTRACT_ADDRESS,
  MAINNET_CERT_POSEIDON_SMT_ADDRESS,
  RARIME_MAINNET_CONFIG,
} from '@/constants/rarime-config';
import { EPassport } from '@/utils/e-document/e-document';
import {
  buildHeavyRegisterInputs,
  slaveCertSmtLeafKey,
} from '@/utils/heavy-noir-inputs';

// ---------------------------------------------------------------------------
// 1. ABI fragment for registerViaNoir
//    Extracted from rarime-mobile-identity-sdk/calldata.go (RegistrationMetaData
//    ABI string, function "registerViaNoir"). Keeping just the one function we
//    need so the bundle stays small and we don't accidentally encode against
//    the deprecated `registerSimple` shape.
// ---------------------------------------------------------------------------
const REGISTRATION_ABI = [
  'function registerViaNoir(' +
    'bytes32 certificatesRoot_,' +
    'uint256 identityKey_,' +
    'uint256 dgCommit_,' +
    '(bytes32 dataType, bytes32 zkType, bytes signature, bytes publicKey, bytes32 passportHash) passport_,' +
    'bytes zkPoints_' +
    ')',
];

// ---------------------------------------------------------------------------
// 2. zk-type / data-type string prefixes
//    The on-chain Registration2 contract dispatches verification to a circuit
//    verifier keyed by keccak256(zkType string). For our Noir register
//    circuits the prefix is "Z_NOIR_PASSPORT" (NOT "Z_PER_PASSPORT", which is
//    the Groth16 path). The suffix is the circuit name minus its
//    "registerIdentity_" prefix.
//    Likewise the AA dispatcher key is keccak256("P_NO_AA") when DG15 / active
//    auth is absent — which is the case for French passports.
// ---------------------------------------------------------------------------
const ZK_NOIR_TYPE_PREFIX = 'Z_NOIR_PASSPORT';
const NO_AA_DATA_TYPE_STRING = 'P_NO_AA';

// ---------------------------------------------------------------------------
// 3. Public-signal layout of the heavy Noir register proof
//    The `prove()` step returns 5 pub_signals + the zkPoints. They are
//    emitted in *this* order (matches calldata.go::newNoirRegistrationProof):
//
//      pub_signals[0] = passportKey       (uint256)
//      pub_signals[1] = passportHash      (uint256)
//      pub_signals[2] = dgCommit          (uint256)
//      pub_signals[3] = identityKey       (uint256) — BJJ profile-key derived
//      pub_signals[4] = certificatesRoot  (bytes32) — CSCA SMT root at proof time
//
//    `zkPoints` is the raw UltraPlonk proof bytes (2144 B for our French
//    passport circuit).
//
//    NoirCircuitParams.prove() in the SDK already splits the prover output
//    into `{proof, pub_signals: string[]}` where each entry is a 64-char hex
//    string. We just need to know which index is which.
// ---------------------------------------------------------------------------

export interface HeavyNoirProof {
  /** Raw zkPoints, hex without leading 0x. 2144 bytes for the French
   * registerIdentity_1_256_3_5_576_248_NA circuit. */
  proof: string;
  /** 5 entries, each a 64-char hex string. See layout comment above. */
  pub_signals: string[];
}

/** Inputs that don't come from the proof but are still required to build the
 * Registration2.Passport struct. For a French passport these are all empty. */
export interface RegisterIdentityExtras {
  /** PEM-encoded DG15 public key. Empty Uint8Array if the passport has no
   * Active Authentication (the case for our French Gen-2 passport). */
  aaPubKeyPem: Uint8Array;
  /** Active-Authentication signature read off the chip. Empty if no AA. */
  aaSignature: Uint8Array;
  /** Total length of the SOD's `eContent` in bits (i.e.
   * `encapsulatedContent.length * 8`). Currently only used to pick the right
   * AA dispatcher; ignored when aaPubKeyPem is empty. */
  ecSizeInBits: number;
  /** Full circuit name as compiled into the Noir bytecode, e.g.
   * `registerIdentity_1_256_3_5_576_248_NA`. The keccak of the zk-type
   * dispatched on-chain depends on the suffix after the first underscore. */
  circuitName: string;
}

// ---------------------------------------------------------------------------
// 4. Calldata builder
//    Pure function — no I/O, no native calls. Safe to unit-test.
// ---------------------------------------------------------------------------

export interface BuildRegisterViaNoirArgs extends RegisterIdentityExtras {
  /** The 5 pub_signals + zkPoints produced by the heavy Noir circuit. */
  noirProof: HeavyNoirProof;
}

export function buildRegisterViaNoirCalldata(args: BuildRegisterViaNoirArgs): string {
  const { noirProof, aaPubKeyPem, aaSignature, circuitName } = args;

  if (noirProof.pub_signals.length !== 5) {
    throw new Error(
      `[registerViaNoir] expected 5 pub_signals from the heavy register circuit, got ${noirProof.pub_signals.length}. ` +
      `This usually means a light register circuit was used by mistake — check that the bundled ` +
      `bytecode matches the circuit name "${circuitName}".`,
    );
  }

  // ---- Pub-signal split ----------------------------------------------------
  // ethers.toBigInt accepts a "0x"-prefixed hex string. NoirCircuitParams emits
  // the signals as bare 64-char hex (no 0x), so we prepend.
  const hex = (s: string) => (s.startsWith('0x') ? s : '0x' + s);
  const passportHashBytes32 = ethers.zeroPadValue(hex(noirProof.pub_signals[1]), 32);
  const dgCommit = ethers.toBigInt(hex(noirProof.pub_signals[2]));
  const identityKey = ethers.toBigInt(hex(noirProof.pub_signals[3]));
  const certificatesRoot = ethers.zeroPadValue(hex(noirProof.pub_signals[4]), 32);

  // ---- dataType + zkType ---------------------------------------------------
  // dataType: when there's no Active Auth, the Go SDK hard-codes the dispatcher
  // string to "P_NO_AA" (calldata.go::retriveRegistrationPassportData, line
  // ~544). The French passport hits this path because DG15 is absent.
  //
  // When AA *is* present, the dispatcher is `P_RSA_<HASH>_<ecSizeInBits>` or
  // `P_ECDSA_SHA1_<ecSizeInBits>` depending on the AA key type — see the Go
  // SDK for the full table. We deliberately don't implement that branch here
  // until we have a passport to test it against; the throw below makes the
  // unsupported case loud rather than silently sending the wrong dispatcher
  // and getting a revert from the on-chain verifier.
  if (aaPubKeyPem.length > 0 || aaSignature.length > 0) {
    throw new Error(
      '[registerViaNoir] Active Authentication is not yet supported by this builder. ' +
      'Set aaPubKeyPem and aaSignature to empty arrays for passports without DG15, ' +
      'or extend retriveRegistrationPassportData() from calldata.go to add the ' +
      'P_RSA_* / P_ECDSA_* dispatcher mapping here.',
    );
  }
  const dataType = ethers.id(NO_AA_DATA_TYPE_STRING);

  // zkType: keccak("Z_NOIR_PASSPORT_<suffix>") where suffix is everything
  // after the first underscore in the circuit name.
  // Example: "registerIdentity_1_256_3_5_576_248_NA"
  //   -> first underscore at index 16
  //   -> suffix "1_256_3_5_576_248_NA"
  //   -> zkType = keccak("Z_NOIR_PASSPORT_1_256_3_5_576_248_NA")
  // Matches Go: strings.Cut(circuitName, "_") + Sprintf("%v_%v", prefix, suffix).
  const firstUnderscore = circuitName.indexOf('_');
  if (firstUnderscore < 0) {
    throw new Error(`[registerViaNoir] circuit name has no underscore: ${circuitName}`);
  }
  const zkTypeSuffix = circuitName.slice(firstUnderscore + 1);
  const zkType = ethers.id(`${ZK_NOIR_TYPE_PREFIX}_${zkTypeSuffix}`);

  // ---- Encode --------------------------------------------------------------
  const iface = new ethers.Interface(REGISTRATION_ABI);
  return iface.encodeFunctionData('registerViaNoir', [
    certificatesRoot,
    identityKey,
    dgCommit,
    {
      dataType,
      zkType,
      // For no-AA: both bytes fields are empty. The on-chain verifier reads
      // the dataType keccak as the AA dispatcher key — when it resolves to
      // keccak("P_NO_AA") the contract knows to skip AA verification.
      signature: '0x',
      publicKey: '0x',
      passportHash: passportHashBytes32,
    },
    '0x' + noirProof.proof,
  ]);
}

// ---------------------------------------------------------------------------
// 5. Relayer submission
//    The registration relayer accepts {tx_data, destination, no_send} as a
//    JSON:API "data" wrapper and returns {data: {attributes: {tx_hash}}} on
//    success. It does no proof inspection — its job is just to sign and
//    broadcast the tx, which is why this path sidesteps the broken
//    light-registrator service entirely.
//
//    On a 4xx we surface the relayer's error body verbatim because the
//    failure modes are user-meaningful — "already registered", "invalid
//    proof", "cert root mismatch", etc.
// ---------------------------------------------------------------------------

export interface RelayerSubmitResult {
  txHash: string;
}

export async function submitToRegistrationRelayer(
  network: Network,
  calldata: string,
): Promise<RelayerSubmitResult> {
  if (network !== 'mainnet') {
    // We don't have a working `registerViaNoir` deployment on Q-testnet — the
    // Registration2 contract address there is either absent or stale. Refusing
    // here surfaces the issue at the point of attempt rather than letting the
    // relayer return a confusing 5xx.
    throw new Error(
      '[registerViaNoir] heavy registration is only wired for mainnet. ' +
      i18n.t('voting.errors.switchToMainnet', {
        defaultValue: 'Changez de réseau dans Paramètres → Réseau.',
      }),
    );
  }

  const url =
    RARIME_MAINNET_CONFIG.apiConfiguration.rarimeApiUrl +
    '/integrations/registration-relayer/v1/register';

  const body = {
    data: {
      tx_data: calldata,
      destination: MAINNET_REGISTRATION_CONTRACT_ADDRESS,
      no_send: false,
    },
  };

  console.log(`[registerViaNoir] POST ${url} (destination=${body.data.destination}, calldataLen=${calldata.length} hex chars)`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `[registerViaNoir] relayer ${response.status} ${response.statusText}: ${errBody}`,
    );
  }

  const parsed = await response.json();
  // Shape: {data: {id, type, attributes: {tx_hash}}, included: [...]}
  const txHash: string | undefined = parsed?.data?.attributes?.tx_hash;
  if (!txHash) {
    throw new Error(
      `[registerViaNoir] relayer response missing tx_hash: ${JSON.stringify(parsed)}`,
    );
  }
  console.log(`[registerViaNoir] relayer accepted: tx_hash=${txHash}`);
  return { txHash };
}

// ---------------------------------------------------------------------------
// 6. End-to-end helper
//    Composes (4) and (5). The caller is responsible for generating the
//    `noirProof` — see the comment block in Step 7 about the heavy circuit
//    bundle dependency.
// ---------------------------------------------------------------------------

export interface RegisterIdentityViaNoirArgs extends RegisterIdentityExtras {
  network: Network;
  noirProof: HeavyNoirProof;
}

export async function registerIdentityViaNoir(
  args: RegisterIdentityViaNoirArgs,
): Promise<RelayerSubmitResult> {
  const calldata = buildRegisterViaNoirCalldata(args);
  return submitToRegistrationRelayer(args.network, calldata);
}

// ---------------------------------------------------------------------------
// 7. Self-check (dev-only): keccak constants must match the on-chain tx.
//    Called from a console.log in voting-flow init so a regression in
//    ethers / dispatch string is caught immediately. Throws if any drift.
// ---------------------------------------------------------------------------
export function assertOnChainConstants(): void {
  // From the user's Mainnet tx at block 2330 (see HANDOFF-FRENCH-PASSPORT.md).
  const expectedNoAa = '0x9a0f175c44aa7c405c6ab99fbc9aa9e2cdc8971d1fea806282f7746205e8b807';
  const expectedZkType = '0xc2be9038dea425da0c44873cf74097e7ed94cfc01c0cc26c130b6542c9a8b575';

  const actualNoAa = ethers.id(NO_AA_DATA_TYPE_STRING);
  const actualZkType = ethers.id(`${ZK_NOIR_TYPE_PREFIX}_1_256_3_5_576_248_NA`);

  if (actualNoAa.toLowerCase() !== expectedNoAa.toLowerCase()) {
    throw new Error(
      `[registerViaNoir] P_NO_AA keccak drift: got ${actualNoAa}, expected ${expectedNoAa}`,
    );
  }
  if (actualZkType.toLowerCase() !== expectedZkType.toLowerCase()) {
    throw new Error(
      `[registerViaNoir] Z_NOIR_PASSPORT keccak drift: got ${actualZkType}, expected ${expectedZkType}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 8. Heavy-circuit proof generation (Stage 2)
//    Orchestrates: SMT lookup → input assembly → Noir prove() against the
//    bundled `registerIdentity_1_256_3_5_576_248_NA` bytecode.
//
//    The result is a HeavyNoirProof ready to feed into
//    `registerIdentityViaNoir({ noirProof, ... })`. Step 7 calls this
//    on the Mainnet branch once the passport's NFC scan is complete.
// ---------------------------------------------------------------------------

/**
 * Minimal ABI fragment for the CertificatesSMT contract. The PoseidonSMT
 * contract exposes `getProof(bytes32)` returning a SparseMerkleTree.Proof
 * struct — we only consume `root` and `siblings`, but we declare the full
 * struct so ethers can decode the return value cleanly.
 *
 * Matches @rarimo/rarime-rn-sdk's internal PoseidonSMT__factory ABI — kept
 * inline here so we don't reach into SDK internals.
 */
const POSEIDON_SMT_ABI = [
  'function getProof(bytes32 key_) view returns (tuple(bytes32 root, bytes32[] siblings, bool existence, bytes32 key, bytes32 value, bool auxExistence, bytes32 auxKey, bytes32 auxValue))',
];

const HEAVY_CIRCUIT_NAME = 'registerIdentity_1_256_3_5_576_248_NA';

/**
 * Generate the heavy Noir register proof for a French passport against
 * Mainnet's CertificatesSMT state.
 *
 * Sequence:
 *   1. Compute the SMT leaf key from the slave cert (Poseidon of the
 *      packed RSA modulus — see hashPacked in e-document/helpers/crypto.ts).
 *   2. RPC call to CertificatesSMT.getProof(leaf) on Mainnet L2 — fetches
 *      the current root + 80-deep Merkle siblings. If `existence === false`
 *      the slave cert was never registered (CSCA chain not yet on-chain),
 *      we throw early so the user gets a clear error instead of a confusing
 *      "proof failed verification" later.
 *   3. Build the Noir-format input JSON.
 *   4. Download trusted setup (cached after first use; ~150 MB only on
 *      first call).
 *   5. Call NoirCircuitParams.prove() — this is the slow step (~20 s on
 *      the Volla Phone X23). Outputs 5 pub_signals + the zkPoints.
 *
 * The skIdentity is read from SecureStore by the caller and passed in as
 * a "0x"-prefixed hex string. We don't pull it ourselves here so this
 * helper stays unit-test-friendly (no native module deps in the hot
 * path).
 */
export async function generateHeavyNoirProof(
  passport: EPassport,
  skIdentityHex: string,
): Promise<HeavyNoirProof> {
  // ---- 1. SMT leaf key --------------------------------------------------
  const leafKey = slaveCertSmtLeafKey(passport);
  // SECURITY: this leaf is a deterministic hash of the slave cert + chip
  // contents and is stable per-passport across sessions. Logging it in
  // release lets logcat readers correlate the same passport across
  // registration attempts. Keep dev-only.
  if (__DEV__) {
    console.log(`[registerViaNoir][heavy] slave SMT leaf: ${leafKey}`);
  }

  // ---- 2. CertificatesSMT.getProof --------------------------------------
  const provider = new ethers.JsonRpcProvider(
    RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl,
  );
  const smt = new ethers.Contract(
    MAINNET_CERT_POSEIDON_SMT_ADDRESS,
    POSEIDON_SMT_ABI,
    provider,
  );
  const proof = await smt.getProof(leafKey);
  // Ethers v6 returns a Result tuple; access by name (typed via ABI).
  const root: string = proof.root;
  const siblings: string[] = Array.from(proof.siblings as readonly string[]);
  const existence: boolean = proof.existence;
  console.log(
    `[registerViaNoir][heavy] SMT proof: existence=${existence} root=${root} siblings.length=${siblings.length}`,
  );
  if (!existence) {
    // Slave cert isn't in the CertificatesSMT. Two ways this happens:
    // (a) The CSCA chain that signed this passport hasn't been
    //     registered on Mainnet yet — someone has to do registerCertificate
    //     first (covered by rarime-app's CSCA registration tx, the user's
    //     French HSM_DS_1 chain landed at block 2329 already).
    // (b) Wrong leaf key (algorithm mismatch) — shouldn't happen for
    //     standard RSA passports.
    throw new Error(
      '[CSCA_MISSING] ' +
        i18n.t('voting.errors.cscaNotRegisteredOnMainnet', {
          defaultValue:
            "Le certificat racine de votre passeport n'est pas encore enregistré sur Mainnet. Réessayez plus tard ou contactez le support.",
        }),
    );
  }

  // ---- 3. Build heavy circuit inputs ------------------------------------
  const inputs = buildHeavyRegisterInputs({
    passport,
    skIdentityHex,
    smtProof: { root, siblings },
  });

  // ---- 4. Trusted setup + bundled bytecode ------------------------------
  const { Rarime: RarimeClass, NoirCircuitParams } = await import('@rarimo/rarime-rn-sdk');
  const byteCode = RarimeClass.getBundledCircuit(HEAVY_CIRCUIT_NAME);
  if (!byteCode) {
    throw new Error(
      `[registerViaNoir][heavy] bundled bytecode missing for ${HEAVY_CIRCUIT_NAME}. ` +
      'Call Rarime.registerBundledCircuit() at app init (see app/voting-flow.tsx).',
    );
  }
  console.log(`[registerViaNoir][heavy] bytecode loaded, len=${byteCode.length} chars`);

  await NoirCircuitParams.downloadTrustedSetup();
  console.log(`[registerViaNoir][heavy] trusted setup ready`);

  // ---- 5. Prove ---------------------------------------------------------
  const circuit = NoirCircuitParams.fromName(HEAVY_CIRCUIT_NAME);
  const t0 = Date.now();
  console.log(`[registerViaNoir][heavy] prove() starting — expect ~20s on a phone…`);
  const result = await circuit.prove(JSON.stringify(inputs), byteCode);
  console.log(
    `[registerViaNoir][heavy] prove() OK in ${Date.now() - t0}ms; pub_signals=${result.pub_signals.length} proofLen=${result.proof.length}`,
  );

  return {
    proof: result.proof,
    pub_signals: result.pub_signals,
  };
}
