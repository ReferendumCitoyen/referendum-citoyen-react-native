/**
 * Build the JSON inputs for the Groth16 `query_identity` circuit used by the
 * Mainnet vote flow (BioPassportVoting.vote(...) on chain).
 *
 * Direct port of `Profile.BuildQueryIdentityInputs` in
 * rarimo/rarime-mobile-identity-sdk/profile.go (the gomobile-bound Go
 * function that the Android app calls via `profile.buildQueryIdentityInputs`).
 *
 * The circuit is `query_identity.dat` (witnesscalc, 1.2 MB, bundled at
 * assets/circuits/query_identity.dat) + `circuit_final.zkey` (Groth16
 * zkey, ~750 MB, downloaded at runtime from
 * https://storage.googleapis.com/rarimo-store/zkey/circuit_final.zkey).
 *
 * This file is the pure data-transformation layer. The Groth16 prove call
 * (witnesscalc → rapidsnark) lives in utils/groth16-vote.ts.
 */

/** SMT inclusion proof as returned by `RegistrationPoseidonSMT.getProof(...)`.
 * The Mainnet leaf for our user's identity is positioned at
 * `Poseidon(passport.passportHash, identityKey)` — see
 * StateKeeper.addBond. The `value` field is the Poseidon-3L hash of
 * (dgCommit, identityReissueCounter, issueTimestamp). */
export interface RegistrationSmtProof {
  /** Bytes32 hex (with or without 0x prefix). */
  root: string;
  /** 80 bytes32 hex entries — the SMT siblings for this leaf. */
  siblings: string[];
}

export interface BuildQueryIdentityInputsArgs {
  /** Raw DG1 bytes — 93 for TD3 passport. */
  dg1: Uint8Array;
  /** SMT inclusion proof for the user's identity in the
   * RegistrationPoseidonSMT (Mainnet `0x479F84502D…`). */
  smtProof: RegistrationSmtProof;
  /** Selector mask from the proposal's `ProposalRules.selector`. */
  selector: string;
  /** Decimal string: the on-chain `passportInfoKey` for this user's
   * passport. For no-AA passports this equals `passport.passportHash`. */
  pkPassportHash: string;
  /** Decimal string: `IdentityInfo.issueTimestamp` from
   * StateKeeper.getPassportInfo(...). */
  issueTimestamp: string;
  /** Decimal string: `PassportInfo.identityReissueCounter`. */
  identityCounter: string;
  /** 0x-prefixed hex: ProposalsState.getProposalEventId(proposalId). */
  eventId: string;
  /** 0x-prefixed hex: profile.calculateVotingEventData(pollResultsJson) —
   * essentially keccak248 of abi.encode(vote[]). */
  eventData: string;
  /** Decimal strings for the time / identity / date bounds. The Android
   * VotingManager computes these from the ProposalRules. */
  timestampLowerbound: string;
  timestampUpperbound: string;
  identityCounterLowerbound: string;
  identityCounterUpperbound: string;
  /** 0x-prefixed hex for the date bounds — strings like "0x303030303030"
   * for "000000". */
  expirationDateLowerbound: string;
  expirationDateUpperbound: string;
  birthDateLowerbound: string;
  birthDateUpperbound: string;
  /** 0x-prefixed hex citizenship mask (per-country bitset). */
  citizenshipMask: string;
  /** BJJ private key as decimal string. The Go SDK uses
   * `p.secretKey.BigInt().String()`. Convert from the 64-char-hex stored
   * in SecureStore via `BigInt('0x' + hex).toString(10)`. */
  skIdentityDecimal: string;
}

/** Encode a byte array as an array of MSB-first bits (0 / 1).
 *
 * Direct port of `ByteArrayToBits` in the Go SDK (utils.go), which returns
 * `[]int64`. The query circuit takes DG1 as a bit array of length 744 (93
 * bytes × 8 bits). The bits MUST be emitted as JSON numbers, not strings —
 * the Rarime witnesscalc fork's JSON parser rejects strings for this signal
 * (the Go SDK marshals as `[0,1,0,…]`). */
export function byteArrayToBits(bytes: Uint8Array): number[] {
  const out: number[] = new Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    for (let j = 0; j < 8; j++) {
      // MSB-first: bit 7 first, then 6, …, then 0.
      out[i * 8 + j] = (b >> (7 - j)) & 1;
    }
  }
  return out;
}

/** Big-endian bytes (no 0x prefix expected) → decimal string of the
 * resulting bigint. Empty input returns "0". */
function bytesHexToDecimal(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0) return '0';
  return BigInt('0x' + clean).toString(10);
}

/**
 * Assemble the JSON object the `query_identity.dat` witnesscalc binary
 * expects. Output keys + types match the Go SDK's `QueryIdentityInputs`
 * struct verbatim, so the resulting JSON.stringify can be handed to the
 * witnesscalc binary unchanged.
 *
 * Pure function — no I/O, deterministic for fixed inputs. Easy to unit
 * test in isolation.
 */
export function buildQueryIdentityInputs(args: BuildQueryIdentityInputsArgs): Record<string, unknown> {
  const idStateRoot = bytesHexToDecimal(args.smtProof.root);
  const idStateSiblings = args.smtProof.siblings.map(bytesHexToDecimal);

  // Current date in YYMMDD hex, matching the Go side which writes:
  //   currentDateHex := "0x" + hex.EncodeToString([]byte(currentDate.Format("060102")))
  // "060102" is Go's ref date for YYMMDD. We compute the equivalent here.
  const now = new Date();
  const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const yymmdd = yy + mm + dd;
  // ASCII bytes of "YYMMDD" → hex string. Each char's ASCII as 2-hex.
  const currentDateHex = '0x' + Array.from(yymmdd)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');

  // Keys MUST match the circom signal names verbatim — witnesscalc looks up
  // each JSON key against the .dat signal table and throws "Signal not found"
  // on any mismatch. The circuit (queryIdentity.circom) uses camelCase
  // throughout, not snake_case. The Go SDK's JSON tags are camelCase too;
  // the snake_case naming was an earlier porting mistake.
  return {
    dg1: byteArrayToBits(args.dg1),
    eventID: args.eventId,
    eventData: args.eventData,
    idStateRoot: idStateRoot,
    idStateSiblings: idStateSiblings,
    pkPassportHash: args.pkPassportHash,
    selector: args.selector,
    skIdentity: args.skIdentityDecimal,
    timestamp: args.issueTimestamp,
    currentDate: currentDateHex,
    identityCounter: args.identityCounter,
    timestampLowerbound: args.timestampLowerbound,
    timestampUpperbound: args.timestampUpperbound,
    identityCounterLowerbound: args.identityCounterLowerbound,
    identityCounterUpperbound: args.identityCounterUpperbound,
    expirationDateLowerbound: args.expirationDateLowerbound,
    expirationDateUpperbound: args.expirationDateUpperbound,
    birthDateLowerbound: args.birthDateLowerbound,
    birthDateUpperbound: args.birthDateUpperbound,
    citizenshipMask: args.citizenshipMask,
  };
}
