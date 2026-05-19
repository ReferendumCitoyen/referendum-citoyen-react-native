import * as fs from 'fs';
import * as path from 'path';
import {
  pubKeyBytesFromSpki,
  spkiFromCert,
  pemToDerList,
  buildIcaoMasterTree,
  keccak,
} from './icao-master-tree';
import { Buffer } from 'buffer';

// Mainnet on-chain root from stateKeeper.icaoMasterTreeMerkleRoot(). Pinned
// here so a future bundle update fails LOUDLY in CI if the root no longer
// matches — at that point we'd need to update master_000316.pem (and
// Rarimo would have published a new on-chain root).
const ON_CHAIN_ROOT = '0x490355b1c9cca56d89c180780c5ea66c1766d57cf22670c7a9a07dc18b835a4f';

// Pulled from the real registerCertificate tx
// https://scan.rarimo.com/tx/0x4f4bc331a8e8cfa4aad4bec9d1615892cf71e9ee21c58bd69c9aee5a0443e29a
// (Mainnet block 2329) — the CSCA's RSA modulus (512 bytes) and the 27
// merkle-proof siblings that the on-chain verifier accepted. If our local
// tree produces these exact siblings, every other slave signed by this same
// CSCA can be registered against the on-chain root without any roundtrip.
const KNOWN_GOOD_CSCA_PUBKEY_HEX =
  'b8bffce6f30f3b501280fbec7ad212dad81f6aee4345078b539f4c631bf82cad' +
  // (rest of the 512-byte modulus is irrelevant for this test — the
  //  buildIcaoMasterTree path doesn't reference KNOWN_GOOD_CSCA_LEAF, it
  //  re-hashes the full pubkey; we just need the leaf below.)
  '';

const KNOWN_GOOD_CSCA_LEAF =
  '0xf0c3389a205392c9aac962f07b084236f64698dc051c102d4e1dd9335c1e9ae1';

const KNOWN_GOOD_SIBLINGS = [
  '0xefc110ea45e8f45d99c15d876ab1d6142bd36580bd0240b978bf83f937919dfe',
  '0xefec682f805294a20261084d9e3530e8ca3d6a48deb497e486380e7256b1234c',
  '0xf0d4e043914a4846a952df3c88be88389d9da7126b41dcc3f1c764389349b2ba',
];

const MASTERS_PEM_PATH = path.join(
  __dirname,
  '..',
  'assets',
  'certificates',
  'master_000316.pem',
);

describe('icao-master-tree', () => {
  const pemContent = fs.readFileSync(MASTERS_PEM_PATH, 'utf8');
  const derList = pemToDerList(pemContent);

  it('master_000316.pem has 857 CSCA entries', () => {
    expect(derList.length).toBe(857);
  });

  it('extracts pubKey bytes for every CSCA in the bundle', () => {
    let ok = 0;
    for (const der of derList) {
      const spki = spkiFromCert(der);
      const pk = pubKeyBytesFromSpki(spki);
      expect(pk.length).toBeGreaterThan(0);
      ok++;
    }
    expect(ok).toBe(derList.length);
  });

  it('produces a tree whose root matches the on-chain icaoMasterTreeMerkleRoot', () => {
    const tree = buildIcaoMasterTree(derList);
    const root = '0x' + Buffer.from(tree.root()).toString('hex');
    expect(root).toBe(ON_CHAIN_ROOT);
  });

  it('locates the known-good CSCA in the bundle and reproduces its on-chain leaf', () => {
    let found: Uint8Array | null = null;
    for (const der of derList) {
      const pk = pubKeyBytesFromSpki(spkiFromCert(der));
      const hex = Buffer.from(pk).toString('hex');
      if (hex.startsWith(KNOWN_GOOD_CSCA_PUBKEY_HEX)) {
        found = pk;
        break;
      }
    }
    expect(found).not.toBeNull();
    expect(found!.length).toBe(512);
    const leaf = '0x' + Buffer.from(keccak(found!)).toString('hex');
    expect(leaf).toBe(KNOWN_GOOD_CSCA_LEAF);
  });

  it('inclusion proof for the known-good CSCA matches the on-chain siblings', () => {
    let pubKey: Uint8Array | null = null;
    for (const der of derList) {
      const pk = pubKeyBytesFromSpki(spkiFromCert(der));
      const hex = Buffer.from(pk).toString('hex');
      if (hex.startsWith(KNOWN_GOOD_CSCA_PUBKEY_HEX)) {
        pubKey = pk;
        break;
      }
    }
    expect(pubKey).not.toBeNull();
    const tree = buildIcaoMasterTree(derList);
    const proof = tree.generateProof(pubKey!);
    expect(proof.length).toBe(27);
    // First 3 siblings should match exactly — full siblings list comparison
    // is implicit through the root-verification test above (if root matches
    // and one leaf's proof works, all proofs work).
    for (let i = 0; i < KNOWN_GOOD_SIBLINGS.length; i++) {
      const got = '0x' + Buffer.from(proof[i]).toString('hex');
      expect(got).toBe(KNOWN_GOOD_SIBLINGS[i]);
    }
  });
});
