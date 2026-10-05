import { ethers } from 'ethers';
import { HEAVY_CIRCUIT_NAMES, heavyCircuitNameForDg1 } from './heavy-circuits';
import { assertOnChainConstants, buildRegisterViaNoirCalldata } from './register-via-noir';

// heavy-circuits reaches docTypeFromDg1 through passport-key-db, which imports
// expo-secure-store at module scope. Same in-memory stub the passport-key-db
// tests use, so this suite runs under jest-expo without a native bridge. None
// of the assertions below touch storage.
// register-via-noir now writes the pending marker before its POST (AV4), so
// it reaches AsyncStorage at module scope.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// register-via-noir's proof-generation half imports heavy-noir-inputs, which
// imports @iden3/js-crypto — an ESM-only package jest-expo's CommonJS runtime
// can't resolve. (Same reason heavy-noir-inputs.test.ts only ever covers the
// `-math` split-out.) buildRegisterViaNoirCalldata is pure and calls neither
// helper, so stubbing the module keeps the calldata assertions reachable
// without pulling the native/crypto graph into the test.
jest.mock('./heavy-noir-inputs', () => ({
  buildHeavyRegisterInputs: jest.fn(),
  slaveCertSmtLeafKey: jest.fn(),
}));

describe('heavyCircuitNameForDg1', () => {
  it('maps a 95-byte DG1 (TD1 / CNIe) to the TD1 circuit', () => {
    expect(heavyCircuitNameForDg1(new Uint8Array(95))).toBe(
      'registerIdentity_1_256_1_6_960_248_NA',
    );
  });

  it('maps a 93-byte DG1 (TD3 / passport) to the TD3 circuit', () => {
    expect(heavyCircuitNameForDg1(new Uint8Array(93))).toBe(
      'registerIdentity_1_256_3_5_576_248_NA',
    );
  });

  it('never returns the same circuit for both document types', () => {
    // The whole point of the map: dg1/ec/sa are fixed-size Noir arrays, so a
    // TD1 chip cannot be proved with TD3 bytecode. If these ever collapse to
    // one name, Step7 is silently proving against the wrong circuit.
    expect(HEAVY_CIRCUIT_NAMES.idCard).not.toBe(HEAVY_CIRCUIT_NAMES.passport);
  });

  it('returns undefined for any other DG1 length rather than guessing', () => {
    // A wrong-length DG1 handed to a fixed-size circuit fails inside the
    // prover ~20 s later; undefined routes the caller to the light path.
    for (const len of [0, 1, 92, 94, 96, 128]) {
      expect(heavyCircuitNameForDg1(new Uint8Array(len))).toBeUndefined();
    }
  });
});

describe('zkType derivation from the pinned circuit names', () => {
  // Registration2 dispatches proof verification on keccak256(zkType), where
  // zkType = "Z_NOIR_PASSPORT_" + everything after the first underscore of the
  // circuit name. buildRegisterViaNoirCalldata does that derivation inline, so
  // we assert it through the encoded calldata rather than re-implementing it.
  const REGISTRATION_ABI = [
    'function registerViaNoir(' +
      'bytes32 certificatesRoot_,' +
      'uint256 identityKey_,' +
      'uint256 dgCommit_,' +
      '(bytes32 dataType, bytes32 zkType, bytes signature, bytes publicKey, bytes32 passportHash) passport_,' +
      'bytes zkPoints_' +
      ')',
  ];

  /** Decode the `zkType` field back out of the ABI-encoded calldata. */
  const zkTypeFor = (circuitName: string): string => {
    const calldata = buildRegisterViaNoirCalldata({
      noirProof: {
        // Content is irrelevant here — only the shape matters (5 signals, or
        // the builder throws). Distinct values so a mis-indexed read would be
        // visible rather than reading 0 everywhere.
        pub_signals: ['11', '22', '33', '44', '55'].map((s) => s.padStart(64, '0')),
        proof: 'ab'.repeat(32),
      },
      aaPubKeyPem: new Uint8Array(),
      aaSignature: new Uint8Array(),
      ecSizeInBits: 0,
      circuitName,
    });
    const iface = new ethers.Interface(REGISTRATION_ABI);
    const decoded = iface.decodeFunctionData('registerViaNoir', calldata);
    return decoded[3].zkType;
  };

  it('derives the TD1 zkType for the CNIe circuit', () => {
    // keccak("Z_NOIR_PASSPORT_1_256_1_6_960_248_NA"). Registered in
    // Registration2.passportVerifiers on Mainnet, resolving to the Aztec
    // verifier at 0xeDA16d0aA50D8a66C306525D0d6e95fA485d0658 (verified live
    // 2026-08-31), whose bytecode embeds the verification-key hash of our
    // bundled TD1 circuit. It read as the zero address on 2026-08-24, so a
    // CNIe submit really did revert by design up to then — hence the older
    // wording in circuits/README.md. Getting this constant wrong now means
    // dispatching to the wrong verifier rather than to nothing at all, which
    // is why the assertion matters more than it did.
    expect(zkTypeFor(HEAVY_CIRCUIT_NAMES.idCard)).toBe(
      '0xe39d060618707c7996e21efea05e4dd0698ca1fc200d2f7e9b9015a338844f8c', // nosec: public keccak of a public circuit-name string
    );
  });

  it('derives the TD3 zkType for the passport circuit (unchanged)', () => {
    // keccak("Z_NOIR_PASSPORT_1_256_3_5_576_248_NA"), read off the Mainnet tx
    // at block 2330. Regression guard: pinning TD1 must not move TD3.
    expect(zkTypeFor(HEAVY_CIRCUIT_NAMES.passport)).toBe(
      '0xc2be9038dea425da0c44873cf74097e7ed94cfc01c0cc26c130b6542c9a8b575', // nosec: public keccak of a public circuit-name string
    );
  });

  it('gives the two circuits different zkTypes', () => {
    expect(zkTypeFor(HEAVY_CIRCUIT_NAMES.idCard)).not.toBe(
      zkTypeFor(HEAVY_CIRCUIT_NAMES.passport),
    );
  });

  it('rejects a circuit name with no underscore to split on', () => {
    expect(() => zkTypeFor('registerIdentity')).toThrow(/no underscore/);
  });
});

describe('assertOnChainConstants', () => {
  // Runs at app init (app/voting-flow.tsx) purely as a keccak drift alarm.
  // Covering it here means a drift is caught in CI rather than as a
  // console.error nobody reads on a tester's phone.
  it('passes with the current dispatch strings', () => {
    expect(() => assertOnChainConstants()).not.toThrow();
  });
});
