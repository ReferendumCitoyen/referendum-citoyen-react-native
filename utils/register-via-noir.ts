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
 * a Mainnet registerViaNoir transaction) skips that hosted
 * service entirely. The heavy Noir circuit `registerIdentity_<suite>` proves
 * the slave-cert chain in-zk, the proof is verified on-chain by
 * `Registration2.registerViaNoir(...)`, and the relayer is just a tx
 * submitter (no proof inspection). Result: no light-registrator dependency,
 * no Groth16-vs-Noir schema mismatch.
 *
 * Source of truth for the calldata layout: rarimo/rarime-mobile-identity-sdk
 *   calldata.go::BuildNoirRegisterCalldata + newNoirRegistrationProof.
 *
 * Verified against the on-chain tx — both keccak constants for the TD3
 * French passport suite match byte-for-byte (see CHECK script at the bottom
 * of this file).
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
  type SmtInclusionProof,
} from '@/utils/heavy-noir-inputs';
import { heavyCircuitNameForDg1 } from '@/utils/heavy-circuits';
import { loggableTxHash } from '@/utils/logger';
import { markRegistrationSent } from '@/utils/registration-pending-slot';
import { assertWouldNotRevert } from '@/utils/relayer-simulation';
import { isStorageFullError } from '@/utils/storage-errors';
import {
  PROOF_GENERATION_FAILED,
  REGISTRATION_OUTCOME_UNKNOWN,
  REGISTRATION_REVERT,
} from '@/utils/registration-sentinels';

/** Bound on the registration POST and its body read (dossier 2.0.2, 3 e). */
export const RELAYER_POST_TIMEOUT_MS = 90_000;
import { recordRegistrationArtifact } from '@/utils/vote-artifacts';
import { describeBundledCircuit } from '@/constants/bundled-circuits';

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
//    auth is absent — which is the case for both French documents we support
//    (Gen-2 passport and CNIe; both compile against a `dg15: [u8; 0]` ABI).
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
//    `zkPoints` is the raw UltraPlonk proof bytes — 2144 B for both of our
//    heavy circuits (TD3 and TD1); the two differ in input array sizes, not
//    in proof shape. Both declare circuit_size 2^17 and 5 public inputs.
//
//    NoirCircuitParams.prove() in the SDK already splits the prover output
//    into `{proof, pub_signals: string[]}` where each entry is a 64-char hex
//    string. We just need to know which index is which.
// ---------------------------------------------------------------------------

export interface HeavyNoirProof {
  /** Raw zkPoints, hex without leading 0x. 2144 bytes for both heavy register
   * circuits (TD3 `registerIdentity_1_256_3_5_576_248_NA` and TD1
   * `registerIdentity_1_256_1_6_960_248_NA`) — they differ in their input
   * array sizes, not in their UltraPlonk proof shape. */
  proof: string;
  /** 5 entries, each a 64-char hex string. See layout comment above. */
  pub_signals: string[];
}

/** Inputs that don't come from the proof but are still required to build the
 * Registration2.Passport struct. For both French documents (Gen-2 passport
 * and CNIe) the AA fields are empty; only `circuitName` really varies. */
export interface RegisterIdentityExtras {
  /** PEM-encoded DG15 public key. Empty Uint8Array if the document has no
   * Active Authentication (the case for our French Gen-2 passport and CNIe). */
  aaPubKeyPem: Uint8Array;
  /** Active-Authentication signature read off the chip. Empty if no AA. */
  aaSignature: Uint8Array;
  /** Total length of the SOD's `eContent` in bits (i.e.
   * `encapsulatedContent.length * 8`). Currently only used to pick the right
   * AA dispatcher; ignored when aaPubKeyPem is empty. */
  ecSizeInBits: number;
  /** Full circuit name as compiled into the Noir bytecode — one of the two
   * entries in `HEAVY_CIRCUIT_NAMES` (utils/heavy-circuits.ts): TD3
   * `registerIdentity_1_256_3_5_576_248_NA` or TD1
   * `registerIdentity_1_256_1_6_960_248_NA`. The keccak of the zk-type
   * dispatched on-chain depends on the suffix after the first underscore, so
   * this MUST be the name of the circuit that actually produced `noirProof`
   * — see the drift note at the top of utils/heavy-circuits.ts. */
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
  //
  // This derivation is purely name-driven, so it is already correct for the
  // TD1 circuit — no branch needed. Worth knowing what it produces, though:
  // the TD1 name yields keccak("Z_NOIR_PASSPORT_1_256_1_6_960_248_NA") =
  // 0xe39d0606…8844f8c, and Mainnet Registration2 now HAS a verifier
  // registered under that key — `passportVerifiers(<it>)` returns
  // 0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658 (verified live 2026-08-31 at
  // block 0x108fe). That contract is provably the verifier for the circuit we
  // actually bundle, not some other TD1 build: its runtime bytecode (11236 B,
  // dispatch table headed by the Aztec BaseUltraVerifier selector
  // getVerificationKeyHash()) contains, byte-for-byte, the Verification Key
  // Hash recorded in circuits/registerIdentity_1_256_1_6_960_248_NA.sol:
  //   7415b2b306477c432a1c4ff6839aa9fd96848af2af11b5c629becc6b95e7c43d  // nosec: public verification-key hash of a public circuit artifact
  // The circuit author (Rarimo) confirmed it in writing on 2026-08-31
  // — "This is final TD1 verifier" — and supplied its deployment tx:
  //   0x8ec3056d8df82eb43c8ded0a1fd9ed4c07c74b48e68ebd807d7752c8b74084ae  // nosec: public Rarimo Mainnet deployment tx hash
  //
  // History, because a lot of prose around this repo was written the other way
  // round: that same mapping WAS the zero address when last read on
  // 2026-08-24, so a CNIe submit really did revert by design, and TD1 was
  // routed to Rarimo's light registrator (/registerid) instead — see
  // constants/td1-heavy-register.ts and circuits/README.md. Every CNIe
  // registered SO FAR — not merely up to that read — is therefore bonded by
  // the light registrator: no TD1 registerViaNoir has ever landed on-chain,
  // the flag only changes where the NEXT unregistered card goes. That is
  // not a compatibility problem: both registrars write the same
  // (passportHash, identityKey) pair into StateKeeper, so Step7's
  // getDocumentStatus check reports such a card RegisteredWithThisPk and it
  // never reaches this builder at all.
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
  pendingOwner?: string,
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

  // Dry run first. The relayer's 500 hides the revert reason; an eth_call
  // does not. Throws [IDENTITY_BOUND_ELSEWHERE] / [REGISTRATION_REVERT] with
  // the contract's own words, which Step 7 turns into the user's message.
  await assertWouldNotRevert({
    calldata,
    destination: MAINNET_REGISTRATION_CONTRACT_ADDRESS,
    label: 'registerViaNoir',
  });

  console.log(`[registerViaNoir] POST ${url} (destination=${body.data.destination}, calldataLen=${calldata.length} hex chars)`);
  // Bounded (dossier 2.0.2, item 3 e): one report waited 672 s after this
  // POST. The bound covers the request AND the body read. From here on, any
  // failure to get an answer means "sent, outcome unknown": the request may
  // have reached the relayer, so the caller must never send it again by
  // itself (R3) and goes through the status re-read instead.
  // AV4: the durable trace goes down BEFORE the request leaves.
  // TODO(PROTOCOL-LEAD-B): shape of this marker awaiting Rarimo confirmation
  // (utils/registration-pending-slot.ts, buildSlotRecord). From the next line on the relayer may have it, so a
  // process killed during the 90 s bound must still leave something on disk
  // for the next run to poll instead of proving and sending again. Written
  // here rather than in the caller so every path that POSTs is covered.
  await markRegistrationSent({ network, owner: pendingOwner });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAYER_POST_TIMEOUT_MS);
  let status: number;
  let statusText: string;
  let text: string;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    statusText = response.statusText;
    text = await response.text();
  } catch {
    throw new Error(
      `${REGISTRATION_OUTCOME_UNKNOWN} ` +
        (controller.signal.aborted
          ? `relayer did not answer within ${RELAYER_POST_TIMEOUT_MS / 1000} s`
          : 'relayer answer lost (network)'),
    );
  } finally {
    clearTimeout(timer);
  }

  if (status < 200 || status >= 300) {
    throw new Error(`[registerViaNoir] relayer ${status} ${statusText}: ${text}`);
  }

  // A 2xx whose body cannot be read as the expected shape: the relayer took
  // the request, so this is not a refusal either.
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} relayer answered ${status} with an unreadable body`);
  }
  // Shape: {data: {id, type, attributes: {tx_hash}}, included: [...]}
  const txHash: string | undefined = parsed?.data?.attributes?.tx_hash;
  if (!txHash) {
    throw new Error(`${REGISTRATION_OUTCOME_UNKNOWN} relayer answered ${status} without a tx_hash`);
  }
  // Masked to tx:<hex64> in every log and report, see loggableTxHash.
  console.log(`[registerViaNoir] relayer accepted ${loggableTxHash(txHash)}`);
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
  /**
   * The caller's own pending-slot owner token (armPendingSlot). The durable
   * marker written just before the POST must name the run that is posting:
   * a registration run outlives its screen (R3), so two runs can be in flight
   * and a shared "currently armed" value gave one run's marker the other's
   * name (wave 2a, constat 1). Optional: a caller with no slot writes none.
   */
  pendingOwner?: string;
}

export async function registerIdentityViaNoir(
  args: RegisterIdentityViaNoirArgs,
): Promise<RelayerSubmitResult> {
  const calldata = buildRegisterViaNoirCalldata(args);
  // Kept for the report the tester can send afterwards
  // (utils/vote-artifacts.ts) — recorded before the dry run and the relay,
  // so a registration the chain refuses still carries what it sent.
  recordRegistrationArtifact({
    network: args.network,
    circuitName: args.circuitName,
    zkType: ethers.id(`${ZK_NOIR_TYPE_PREFIX}_${args.circuitName.slice(args.circuitName.indexOf('_') + 1)}`),
    pubSignals: args.noirProof.pub_signals,
    passportHash: args.noirProof.pub_signals[1],
    dgCommit: args.noirProof.pub_signals[2],
    identityKey: args.noirProof.pub_signals[3],
    certificatesRoot: args.noirProof.pub_signals[4],
    proofHex: args.noirProof.proof,
  });
  try {
    return await submitToRegistrationRelayer(args.network, calldata, args.pendingOwner);
  } catch (e) {
    // A revert from the dry run names the contract's reason but not the one
    // fact that decides whether the CIRCUIT is at fault: which verifier
    // Registration2 dispatched this zkType to. A rebuilt circuit whose
    // verifier has not been redeployed (the TD1 case on 2026-09-10) fails
    // exactly here, with a custom error and nothing else. One read puts the
    // bundled build and the on-chain verifier side by side in the report.
    if (e instanceof Error && e.message.startsWith(REGISTRATION_REVERT)) {
      await logOnChainVerifierFor(args.circuitName);
    }
    throw e;
  }
}

async function logOnChainVerifierFor(circuitName: string): Promise<void> {
  try {
    const zkType = ethers.id(`${ZK_NOIR_TYPE_PREFIX}_${circuitName.slice(circuitName.indexOf('_') + 1)}`);
    const registration = new ethers.Contract(
      MAINNET_REGISTRATION_CONTRACT_ADDRESS,
      ['function passportVerifiers(bytes32) view returns (address)'],
      new ethers.JsonRpcProvider(RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl),
    );
    const verifier: string = await registration.passportVerifiers(zkType);
    console.warn(
      `[registerViaNoir] revert context — bundled ${circuitName}: ${describeBundledCircuit(circuitName)}; ` +
        `Registration2.passportVerifiers(${zkType.slice(0, 10)}…) = ${verifier}` +
        (verifier === ethers.ZeroAddress ? ' (NO VERIFIER REGISTERED for this zkType)' : ''),
    );
  } catch (readErr: any) {
    console.warn('[registerViaNoir] could not read the on-chain verifier:', readErr?.message ?? String(readErr));
  }
}

// ---------------------------------------------------------------------------
// 7. Self-check (dev-only): keccak constants must match the on-chain tx.
//    Called from a console.log in voting-flow init so a regression in
//    ethers / dispatch string is caught immediately. Throws if any drift.
// ---------------------------------------------------------------------------
export function assertOnChainConstants(): void {
  // Read off a Mainnet registerViaNoir transaction (see
  // HANDOFF-FRENCH-PASSPORT.md).
  const expectedNoAa = '0x9a0f175c44aa7c405c6ab99fbc9aa9e2cdc8971d1fea806282f7746205e8b807'; // nosec: public keccak("P_NO_AA") dispatch constant
  const expectedZkType = '0xc2be9038dea425da0c44873cf74097e7ed94cfc01c0cc26c130b6542c9a8b575'; // nosec: public TD3 zkType keccak, read off a Mainnet registerViaNoir tx
  // TD1 / CNIe. Not read off a registration tx (no CNIe has registered
  // through registerViaNoir yet), but no longer a bare local derivation
  // either: Registration2.passportVerifiers(<this>) resolves to
  // 0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658 on Mainnet (verified live
  // 2026-08-31 at block 0x108fe), and that verifier's bytecode embeds the
  // Verification Key Hash of circuits/registerIdentity_1_256_1_6_960_248_NA
  // — so this value is confirmed to be the slot a live verifier for our
  // bundled circuit sits in, not just what ethers happens to hash the name
  // to. (It read as the zero address on 2026-08-24; the verifier was deployed
  // between the two reads.) Asserted so that if ethers, the prefix string, or
  // the pinned TD1 circuit name ever drift, the boot log says so — which
  // matters MORE now than it did then: a drifted zkType used to be uniformly
  // dead, whereas today it would dispatch to a different verifier (or to
  // address zero) and surface only as an opaque relayer revert.
  const expectedTd1ZkType = '0xe39d060618707c7996e21efea05e4dd0698ca1fc200d2f7e9b9015a338844f8c'; // nosec: public TD1 zkType keccak, derived from a public circuit name

  const actualNoAa = ethers.id(NO_AA_DATA_TYPE_STRING);
  // Deliberately spelled out as literals rather than fed from
  // HEAVY_CIRCUIT_NAMES: the point of this check is to catch a rename of those
  // constants, so wiring it to them would make it self-fulfilling.
  const actualZkType = ethers.id(`${ZK_NOIR_TYPE_PREFIX}_1_256_3_5_576_248_NA`);
  const actualTd1ZkType = ethers.id(`${ZK_NOIR_TYPE_PREFIX}_1_256_1_6_960_248_NA`);

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
  if (actualTd1ZkType.toLowerCase() !== expectedTd1ZkType.toLowerCase()) {
    throw new Error(
      `[registerViaNoir] Z_NOIR_PASSPORT (TD1) keccak drift: got ${actualTd1ZkType}, expected ${expectedTd1ZkType}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 8. Heavy-circuit proof generation (Stage 2)
//    Orchestrates: SMT lookup → input assembly → Noir prove() against the
//    bundled bytecode for the caller's document type — TD3
//    `registerIdentity_1_256_3_5_576_248_NA` or TD1
//    `registerIdentity_1_256_1_6_960_248_NA`, both registered at boot in
//    app/voting-flow.tsx.
//
//    The result is a HeavyNoirProof ready to feed into
//    `registerIdentityViaNoir({ noirProof, ... })`. Step 7 calls this
//    on the Mainnet branch once the document's NFC scan is complete.
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

/**
 * Progress stages emitted while the slave cert is being resolved against the
 * on-chain SMT. `reproving` is the last one: it fires once the CSCA has landed
 * and the caller can get on with building inputs.
 */
export type SmtResolveStage = 'csca-bootstrap' | 'awaiting-smt' | 'reproving';

/**
 * Resolve a document's slave-certificate inclusion proof against Mainnet's
 * `CertificatesSMT`, bootstrapping its CSCA first if the certificate isn't in
 * the tree yet.
 *
 * Split out of `generateHeavyNoirProof` because it is the entire first half of
 * *any* proof over a French document — every circuit needs the same
 * `icao_root` + 80 `inclusion_branches`, from the same leaf, with the same
 * recovery when the issuing CSCA has never been registered. The alternative was
 * a second copy of `waitForSlaveCertInSmt`, and the note on that function is
 * explicit that two divergent copies of its polling would be a liability.
 *
 * Throws `[CSCA_MISSING]` only if the bootstrap itself doesn't help — the first
 * occurrence is handled internally.
 */
export async function resolveSmtInclusion(
  eDoc: EPassport,
  onStatus?: (stage: SmtResolveStage) => void,
): Promise<SmtInclusionProof> {
  const read = async (): Promise<SmtInclusionProof> => {
    const leafKey = slaveCertSmtLeafKey(eDoc);
    // SECURITY: this leaf is a deterministic hash of the slave cert + chip
    // contents and is stable per-document across sessions. Logging it in
    // release lets logcat readers correlate the same document across
    // attempts. Keep dev-only.
    if (__DEV__) {
      console.log(`[smt] slave SMT leaf: ${leafKey}`);
    }

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
      `[smt] proof: existence=${existence} root=${root} siblings.length=${siblings.length}`,
    );
    if (!existence) {
      // Slave cert isn't in the CertificatesSMT. Two ways this happens:
      // (a) The CSCA chain that signed this document hasn't been registered
      //     on Mainnet yet — someone has to do registerCertificate first
      //     (covered by rarime-app's CSCA registration tx; the French
      //     HSM_DS_1 chain is already registered).
      // (b) Wrong leaf key (algorithm mismatch) — shouldn't happen for
      //     standard RSA documents.
      // Step 7 shows the body verbatim (sentinel stripped) and stays put, so
      // this text is what the user reads when the bootstrap below did not help.
      throw new Error(
        '[CSCA_MISSING] ' +
          i18n.t('voting.errors.cscaNotRegisteredOnMainnet', {
            defaultValue:
              "Certificat non reconnu : le certificat qui signe votre document n'a pas pu être enregistré sur la blockchain. Réessayez plus tard ; si le problème persiste, envoyez-nous un rapport d'erreur.",
          }),
      );
    }
    return { root, siblings };
  };

  try {
    return await read();
  } catch (e: any) {
    // Match on the `[CSCA_MISSING]` sentinel, never the message body — the
    // body is localised, so a substring match would break under a non-fr
    // locale.
    if (!(e?.message ?? '').startsWith('[CSCA_MISSING]')) throw e;

    console.log('[smt] CSCA missing — bootstrapping via registerCertificate');
    onStatus?.('csca-bootstrap');

    // NOTE this submits a REAL Mainnet transaction via the relayer. Same call
    // the rarime-app makes, and it costs the user nothing, but it is a chain
    // write.
    const { registerCscaForSlave } = await import('@/utils/csca-bootstrap');
    const { txHash, dispatcherName } = await registerCscaForSlave(eDoc.sod.slaveCertificate);
    console.log(`[smt] CSCA registration ${loggableTxHash(txHash)} (${dispatcherName})`);

    onStatus?.('awaiting-smt');
    await waitForSlaveCertInSmt(eDoc);

    // Retry. If the bootstrap landed, the slave-cert lookup now succeeds
    // because the slave is insertable under the freshly-added CSCA.
    onStatus?.('reproving');
    return read();
  }
}

/**
 * Generate the heavy Noir register proof for a French passport (TD3) or
 * national ID card (TD1) against Mainnet's CertificatesSMT state.
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
 *
 * `circuitName` is required (no TD3 default) and must be the entry from
 * `HEAVY_CIRCUIT_NAMES` that matches `passport`'s document type. The caller
 * passes the same value to `registerIdentityViaNoir`, so the bytecode that
 * proves and the name the on-chain zkType is derived from cannot drift apart.
 * We re-derive it from the document's own DG1 below and throw on a mismatch.
 */
export async function generateHeavyNoirProof(
  passport: EPassport,
  skIdentityHex: string,
  circuitName: string,
  onStatus?: (stage: SmtResolveStage) => void,
): Promise<HeavyNoirProof> {
  // ---- 0. Circuit / document agreement ----------------------------------
  // Cheap, and the failure it catches is otherwise nasty: the wrong bytecode
  // still *loads* (getBundledCircuit is a plain map lookup with no ABI
  // validation) and only blows up ~20 s later inside the prover, or — worse,
  // if the mismatch is only in the name passed on to the calldata builder —
  // not at all, producing a valid proof carrying the wrong zkType.
  const expectedForDoc = heavyCircuitNameForDg1(passport.dg1Bytes);
  if (expectedForDoc !== circuitName) {
    throw new Error(
      `[registerViaNoir][heavy] circuit/document mismatch: asked for "${circuitName}" but ` +
      `DG1 is ${passport.dg1Bytes.length} bytes, which maps to ` +
      `${expectedForDoc ? `"${expectedForDoc}"` : 'no heavy circuit (expected 93=TD3 or 95=TD1)'}. ` +
      'See utils/heavy-circuits.ts.',
    );
  }

  // ---- 1-2. Slave-cert inclusion proof (+ CSCA bootstrap if needed) ------
  const smtProof = await resolveSmtInclusion(passport, onStatus);

  // ---- 3. Build heavy circuit inputs ------------------------------------
  const inputs = buildHeavyRegisterInputs({
    passport,
    skIdentityHex,
    smtProof,
  });

  // ---- 4. Trusted setup + bundled bytecode ------------------------------
  const { Rarime: RarimeClass, NoirCircuitParams } = await import('@rarimo/rarime-rn-sdk');
  const byteCode = RarimeClass.getBundledCircuit(circuitName);
  if (!byteCode) {
    throw new Error(
      `[registerViaNoir][heavy] bundled bytecode missing for ${circuitName}. ` +
      'Call Rarime.registerBundledCircuit() at app init (see app/voting-flow.tsx).',
    );
  }
  // Which build of the circuit this is — the report needs it, because a
  // circuit that proves the wrong certificate-tree leaf fails right here with
  // a constraint error that says nothing about why.
  console.log(
    `[registerViaNoir][heavy] ${circuitName} bytecode loaded, len=${byteCode.length} chars; ${describeBundledCircuit(circuitName)}`,
  );

  await NoirCircuitParams.downloadTrustedSetup();
  console.log(`[registerViaNoir][heavy] trusted setup ready`);

  // ---- 5. Prove ---------------------------------------------------------
  // `fromName` is a linear search over the SDK's hardcoded
  // `supportedNoirCircuits` array and THROWS on a miss — both heavy circuits
  // are added to it by patches/@rarimo+rarime-rn-sdk+0.3.1.patch, each with
  // pub_signals_count = 5 (that count is what slices the prover output into
  // signals vs. proof, so a wrong value corrupts both silently).
  const circuit = NoirCircuitParams.fromName(circuitName);
  const t0 = Date.now();
  console.log(`[registerViaNoir][heavy] prove() starting — expect ~20s on a phone…`);
  let result: Awaited<ReturnType<typeof circuit.prove>>;
  try {
    result = await circuit.prove(JSON.stringify(inputs), byteCode);
  } catch (e: any) {
    // A device problem is not a circuit problem — let Step 7 keep telling the
    // user to free up space.
    if (isStorageFullError(e)) throw e;
    // Everything else is the prover refusing the witness. Since 2026-09-05 the
    // usual reason is a circuit built for the old certificate-tree leaf being
    // handed siblings from the new tree; say which circuit it was, so a report
    // can be read without a device in hand.
    const detail = e?.message ?? String(e);
    console.error(
      `[registerViaNoir][heavy] prove() FAILED after ${Date.now() - t0}ms — ${circuitName} ` +
        `(${describeBundledCircuit(circuitName)}); dg1=${passport.dg1Bytes.length}B ` +
        `ec=${passport.sod.encapsulatedContent.length}B sa=${passport.sod.signedAttributes.length}B ` +
        `branches=${smtProof.siblings.length}: ${detail}`,
    );
    throw new Error(`${PROOF_GENERATION_FAILED} ${circuitName}: ${detail}`, { cause: e });
  }
  console.log(
    `[registerViaNoir][heavy] prove() OK in ${Date.now() - t0}ms; pub_signals=${result.pub_signals.length} proofLen=${result.proof.length}`,
  );

  const heavyProof: HeavyNoirProof = {
    proof: result.proof,
    pub_signals: result.pub_signals,
  };

  // ---- 6. Dev-only off-chain verification capture ------------------------
  // SECURITY: pub_signals[1] is the passportHash and pub_signals[3] is the BJJ
  // identityKey — both deterministic per document and stable across sessions,
  // so getting them off the device in release would let anyone with the dump
  // (or with logcat access) correlate the same document across registration
  // attempts. `dumpHeavyProof` is a no-op outside __DEV__; the dynamic import
  // keeps expo-sharing / expo-file-system out of this module's graph on the
  // release path. Awaited but never throws — see utils/heavy-proof-dump.ts.
  if (__DEV__) {
    const { dumpHeavyProof } = await import('@/utils/heavy-proof-dump');
    await dumpHeavyProof(heavyProof, circuitName);
  }

  return heavyProof;
}

// ---------------------------------------------------------------------------
// 9. Heavy proof + CSCA bootstrap (Stage 2, recovery wrapper)
// ---------------------------------------------------------------------------

/**
 * `generateHeavyNoirProof`, with the CSCA bootstrap recovery surfaced in the
 * name.
 *
 * The recovery itself now lives in `resolveSmtInclusion`, which every proof
 * over a French document goes through — so this is a pass-through kept for its
 * call sites (Step7, the french-id-test dev screen) and for the fact that the
 * name documents what the call may do: a chip whose issuing CSCA has never been
 * registered triggers `registerCscaForSlave`, which submits a REAL Mainnet
 * transaction via the relayer. Same call the rarime-app makes, and it costs the
 * user nothing, but it is a chain write and worth being able to see at the call
 * site.
 *
 * `onStatus` lets a caller surface progress before the (slow) bootstrap; it is
 * optional and its return value is ignored.
 */
export async function generateHeavyNoirProofWithCscaBootstrap(
  eDoc: EPassport,
  skIdentityHex: string,
  circuitName: string,
  onStatus?: (stage: SmtResolveStage) => void,
): Promise<HeavyNoirProof> {
  return generateHeavyNoirProof(eDoc, skIdentityHex, circuitName, onStatus);
}

/**
 * Poll CertificatesSMT until the document's slave cert becomes insertable.
 *
 * The relayer hands back a bare tx hash rather than a JSON-RPC transaction, so
 * there is nothing to await — polling is the only option. 12 attempts x 2.5 s
 * ≈ 30 s, generous for L2 block times.
 *
 * `existence` is the signal, but it only flips once the master-tree root has
 * updated. `siblings.length` can change before that (root rotation), so it is
 * deliberately NOT used as an early exit.
 *
 * A false return is not fatal and is not thrown on: the caller retries proof
 * generation regardless, and a second `[CSCA_MISSING]` is a clearer end state
 * for the user than a timeout raised from in here.
 */
async function waitForSlaveCertInSmt(eDoc: EPassport): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(
    RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl,
  );
  const leafKey = slaveCertSmtLeafKey(eDoc);
  const smt = new ethers.Contract(
    MAINNET_CERT_POSEIDON_SMT_ADDRESS,
    POSEIDON_SMT_ABI,
    provider,
  );

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const probe = await smt.getProof(leafKey);
      if (probe.existence === true) {
        console.log(`[registerViaNoir][heavy] CSCA landed after ${(i + 1) * 2.5}s`);
        return true;
      }
    } catch (probeErr: any) {
      console.log('[registerViaNoir][heavy] SMT probe err:', probeErr?.message ?? probeErr);
    }
  }
  console.warn('[registerViaNoir][heavy] bootstrap not visible after 30 s — reproving anyway');
  return false;
}
