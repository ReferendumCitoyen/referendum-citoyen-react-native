/**
 * Treap-backed ICAO master Merkle tree, ported from `rarimo/ldif-sdk`
 * (Go: `mt/treap_tree.go` + `mt/cert_mt.go`).
 *
 * Used by the CSCA registration flow (utils/build-register-cert-calldata.ts):
 * before a passport whose slave-DSC isn't on chain can be registered, the
 * CSCA that signed it must be proven a member of the on-chain ICAO master
 * tree. The on-chain root is `stateKeeper.icaoMasterTreeMerkleRoot()`; this
 * module rebuilds the exact same tree client-side from
 * `assets/certificates/master_000316.pem` and exposes an inclusion-proof
 * helper. Local root vs on-chain root verification lives in
 * `scripts/verify-icao-root.mjs` — if you change the algorithm here, re-run
 * that script (it must still print "Match: ✅ YES").
 *
 * Two ldif-sdk filters reproduced verbatim from `utils/cert.go::ExtractPubKeys`:
 *   1. Skip keys whose pubKey-bytes length is exactly 768 (RSA-6144) — Rarimo's
 *      ZK circuits don't support that size, so they're excluded from the tree
 *      (`ignoredKeyLength = 768` in Go).
 *   2. Deduplicate by pubKey bigint value — different certs can share a key
 *      (rotation, parallel chains). Only the first occurrence enters.
 *
 * Without those filters, the local root won't match on-chain (this was the
 * blocker we hit before finding the lukachi/rn-csca / inid-passport-debug
 * reference).
 */

// Use ethers' bundled keccak256 instead of @noble/hashes directly: @noble/hashes
// 2.x is ESM-only in its `./sha3.js` form which breaks jest-expo's CommonJS
// runtime. ethers wraps the same noble keccak implementation, is already a
// top-level dep, and works identically across Node, RN, and Jest.
import { keccak256 as ethersKeccak256, getBytes as ethersGetBytes } from 'ethers';
import { Buffer } from 'buffer';

// ---------------------------------------------------------------------------
// Minimal ASN.1 DER reader. We avoid pulling in `asn1.js` or `@peculiar/x509`
// here because both bring substantial transitive deps and we only need a
// handful of TLV walks. The same reader is used by the CSCA matcher.
// ---------------------------------------------------------------------------

interface TLV {
  tag: number;
  /** Where the contents start in `buf`. */
  contentStart: number;
  /** First byte AFTER the contents (= next sibling's tag). */
  contentEnd: number;
}

export function readTLV(buf: Uint8Array, off: number): TLV {
  const tag = buf[off];
  const lenByte = buf[off + 1];
  let lenStart = off + 2;
  let length: number;
  if (lenByte < 0x80) {
    length = lenByte;
  } else {
    const numLenBytes = lenByte & 0x7f;
    length = 0;
    for (let i = 0; i < numLenBytes; i++) length = (length << 8) | buf[lenStart + i];
    lenStart += numLenBytes;
  }
  return { tag, contentStart: lenStart, contentEnd: lenStart + length };
}

/** OID OCTETs → "1.2.840.113549.1.1.1" form. */
function oidToString(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const first = bytes[0];
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let v = 0;
  for (let i = 1; i < bytes.length; i++) {
    v = (v << 7) | (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

function stripLeadingZeros(buf: Uint8Array): Uint8Array {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  return buf.subarray(i);
}

const OID_RSA = '1.2.840.113549.1.1.1';
const OID_EC = '1.2.840.10045.2.1';

/**
 * Extract the public-key bytes a CSCA contributes to the merkle tree. The
 * shape mirrors Go's `icaoMemberKey` for that cert type:
 *   - RSA → modulus N as big-endian magnitude (leading zeros stripped)
 *   - EC  → X.Bytes() || Y.Bytes()  (each coord stripped of leading zeros)
 *
 * Takes a DER-encoded SubjectPublicKeyInfo (the same blob you get out of an
 * X.509 cert's `tbsCertificate.subjectPublicKeyInfo`).
 */
export function pubKeyBytesFromSpki(spki: Uint8Array): Uint8Array {
  const outer = readTLV(spki, 0); // outer SEQUENCE
  const algo = readTLV(spki, outer.contentStart); // AlgorithmIdentifier
  const bitStr = readTLV(spki, algo.contentEnd); // BIT STRING
  // BIT STRING content: first byte is "unused bits" count (always 0 for
  // pubkeys in practice), then the payload.
  const payload = spki.subarray(bitStr.contentStart + 1, bitStr.contentEnd);

  // First child of AlgorithmIdentifier is the algorithm OID.
  const algoOidTlv = readTLV(spki, algo.contentStart);
  const oid = oidToString(spki.subarray(algoOidTlv.contentStart, algoOidTlv.contentEnd));

  if (oid === OID_RSA) {
    // payload is DER of RSAPublicKey { modulus INTEGER, exponent INTEGER }
    const rsaSeq = readTLV(payload, 0);
    const modTlv = readTLV(payload, rsaSeq.contentStart);
    return stripLeadingZeros(payload.subarray(modTlv.contentStart, modTlv.contentEnd));
  }
  if (oid === OID_EC) {
    // payload is 0x04 || X || Y (uncompressed point)
    if (payload[0] !== 0x04) {
      throw new Error(`compressed EC point not supported (prefix 0x${payload[0].toString(16)})`);
    }
    const coordLen = (payload.length - 1) / 2;
    const x = stripLeadingZeros(payload.subarray(1, 1 + coordLen));
    const y = stripLeadingZeros(payload.subarray(1 + coordLen));
    const out = new Uint8Array(x.length + y.length);
    out.set(x, 0);
    out.set(y, x.length);
    return out;
  }
  throw new Error(`unsupported pubkey algorithm OID: ${oid}`);
}

/** Walk past the standard TBSCertificate fields and return the offset
 * within `certDer` where `subjectPublicKeyInfo` starts. Used by both
 * spkiFromCert (which slices out SPKI) and extractKeyIdentifier (which
 * needs to keep walking past SPKI into Extensions).
 *
 * Returns the start offset of the SPKI's outer SEQUENCE tag.
 */
function spkiOffsetInTbs(certDer: Uint8Array): { spkiStart: number; tbsEnd: number } {
  const cert = readTLV(certDer, 0); // Certificate SEQUENCE
  const tbs = readTLV(certDer, cert.contentStart); // TBSCertificate
  let off = tbs.contentStart;
  // [0] EXPLICIT version (optional, tag 0xa0)
  if (certDer[off] === 0xa0) off = readTLV(certDer, off).contentEnd;
  // serialNumber, signatureAlgorithm, issuer, validity, subject
  for (let i = 0; i < 5; i++) off = readTLV(certDer, off).contentEnd;
  return { spkiStart: off, tbsEnd: tbs.contentEnd };
}

/** Extract the SubjectPublicKeyInfo DER blob from an X.509 cert's
 *  `tbsCertificate`. Walks the standard Certificate→TBSCertificate→
 *  …→subjectPublicKeyInfo path.
 *
 * Certificate ::= SEQUENCE {
 *   tbsCertificate TBSCertificate, signatureAlgorithm AlgId, signature BIT STRING
 * }
 * TBSCertificate ::= SEQUENCE {
 *   [0] EXPLICIT version,         -- optional, tag A0
 *   serialNumber INTEGER,
 *   signatureAlg AlgId,
 *   issuer Name,
 *   validity SEQUENCE,
 *   subject Name,
 *   subjectPublicKeyInfo SubjectPublicKeyInfo,
 *   ...
 * }
 */
export function spkiFromCert(certDer: Uint8Array): Uint8Array {
  const { spkiStart } = spkiOffsetInTbs(certDer);
  const spki = readTLV(certDer, spkiStart);
  return certDer.subarray(spkiStart, spki.contentEnd);
}

// ---------------------------------------------------------------------------
// Key Identifier extraction (Subject and Authority).
//
// These are the matching keys for the CSCA bootstrap: a passport's slave-DSC
// carries an AuthorityKeyIdentifier extension whose `keyIdentifier` field
// equals the corresponding CSCA's SubjectKeyIdentifier extension. Walking
// the DER directly to extract these is ~30× faster than constructing
// `@peculiar/x509::X509Certificate` for each CSCA (the bottleneck that
// makes the matcher take ~60 s over 857 certs).
// ---------------------------------------------------------------------------

const OID_SKI = '2.5.29.14';
const OID_AKI = '2.5.29.35';

/** Locate the Extensions sequence inside a TBSCertificate, or null if the
 * cert has no Extensions (v1 certs don't). The result is the SEQUENCE's
 * content range — iterate it as a list of Extension TLVs. */
function extensionsContentRange(certDer: Uint8Array): { start: number; end: number } | null {
  const { spkiStart, tbsEnd } = spkiOffsetInTbs(certDer);
  // SPKI itself
  let off = readTLV(certDer, spkiStart).contentEnd;
  // Optional [1]/[2] IMPLICIT *UniqueID
  while (off < tbsEnd && (certDer[off] === 0x81 || certDer[off] === 0x82)) {
    off = readTLV(certDer, off).contentEnd;
  }
  // [3] EXPLICIT Extensions, tag 0xa3
  if (off >= tbsEnd || certDer[off] !== 0xa3) return null;
  const explicit = readTLV(certDer, off);
  const seq = readTLV(certDer, explicit.contentStart); // inner SEQUENCE
  return { start: seq.contentStart, end: seq.contentEnd };
}

/** Find an extension's `extnValue` OCTET STRING content by OID. Returns
 * null if the extension isn't present. */
function findExtensionValue(certDer: Uint8Array, targetOid: string): Uint8Array | null {
  const range = extensionsContentRange(certDer);
  if (!range) return null;
  let off = range.start;
  while (off < range.end) {
    const ext = readTLV(certDer, off);
    let p = ext.contentStart;
    // extnID OID
    const oidTlv = readTLV(certDer, p);
    const oid = oidToString(certDer.subarray(oidTlv.contentStart, oidTlv.contentEnd));
    p = oidTlv.contentEnd;
    // Optional critical BOOLEAN
    if (certDer[p] === 0x01) p = readTLV(certDer, p).contentEnd;
    // extnValue OCTET STRING — its content is the inner DER of the extension.
    const valTlv = readTLV(certDer, p);
    if (oid === targetOid) {
      return certDer.subarray(valTlv.contentStart, valTlv.contentEnd);
    }
    off = ext.contentEnd;
  }
  return null;
}

/** Extract the SubjectKeyIdentifier (SKI) bytes from a cert. The extension
 * value DER is `OCTET STRING { keyBytes }`. Returns the inner key bytes,
 * or null if the cert has no SKI extension. */
export function extractSubjectKeyIdentifier(certDer: Uint8Array): Uint8Array | null {
  const extValue = findExtensionValue(certDer, OID_SKI);
  if (!extValue) return null;
  // extValue contents are DER of `SubjectKeyIdentifier ::= OCTET STRING`.
  const inner = readTLV(extValue, 0);
  return extValue.subarray(inner.contentStart, inner.contentEnd);
}

/** Extract the AuthorityKeyIdentifier's `keyIdentifier` field. The extension
 * value is `AuthorityKeyIdentifier ::= SEQUENCE { keyIdentifier [0] IMPLICIT
 * OCTET STRING OPTIONAL, ... }`. Returns null if the cert has no AKI
 * extension or the AKI is missing `keyIdentifier`. */
export function extractAuthorityKeyIdentifier(certDer: Uint8Array): Uint8Array | null {
  const extValue = findExtensionValue(certDer, OID_AKI);
  if (!extValue) return null;
  const seq = readTLV(extValue, 0); // outer SEQUENCE
  // Walk children, find context-specific [0] (tag 0x80 — IMPLICIT OCTET STRING).
  let off = seq.contentStart;
  while (off < seq.contentEnd) {
    const child = readTLV(extValue, off);
    if (child.tag === 0x80) {
      return extValue.subarray(child.contentStart, child.contentEnd);
    }
    off = child.contentEnd;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PEM helpers
// ---------------------------------------------------------------------------

const PEM_RE = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g;

/** Split a multi-cert PEM blob into individual DER buffers. */
export function pemToDerList(pem: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const match of pem.matchAll(PEM_RE)) {
    const b64 = match[1].replace(/\s+/g, '');
    out.push(new Uint8Array(Buffer.from(b64, 'base64')));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function keccak(input: Uint8Array): Uint8Array {
  // ethers.keccak256 returns a 0x-hex string; we want raw bytes.
  return ethersGetBytes(ethersKeccak256(input));
}

/** Empty-aware sorted-pair keccak — matches OpenZeppelin's `MerkleProof`
 * processor used on-chain. The treap merge step calls this for every
 * parent node, and a verifier walks the proof siblings with the same
 * function. */
function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const cmp = Buffer.compare(Buffer.from(a), Buffer.from(b));
  const concat = new Uint8Array(a.length + b.length);
  if (cmp < 0) {
    concat.set(a, 0);
    concat.set(b, a.length);
  } else {
    concat.set(b, 0);
    concat.set(a, b.length);
  }
  return keccak(concat);
}

// ---------------------------------------------------------------------------
// Treap
// ---------------------------------------------------------------------------

interface Node {
  /** Leaf key = keccak256(pubKey bytes). 32 bytes. */
  key: Uint8Array;
  /** uint64 — keccak256(key) mod (2^64 - 1). Treap priority. */
  priority: bigint;
  /** Subtree merkle hash. For a leaf = key. For internal = hashPair(hashPair(L,R), key). */
  merkleHash: Uint8Array;
  left: Node | null;
  right: Node | null;
}

const MAX_UINT64 = (1n << 64n) - 1n;
function derivePriority(key: Uint8Array): bigint {
  const h = keccak(key);
  // Big-endian → bigint.
  let big = 0n;
  for (let i = 0; i < h.length; i++) big = (big << 8n) | BigInt(h[i]);
  return big % MAX_UINT64;
}

function hashChildren(l: Node | null, r: Node | null): Uint8Array {
  const lh = l ? l.merkleHash : new Uint8Array(0);
  const rh = r ? r.merkleHash : new Uint8Array(0);
  return hashPair(lh, rh);
}

function updateNode(node: Node): void {
  const childHash = hashChildren(node.left, node.right);
  node.merkleHash = childHash.length === 0 ? node.key : hashPair(childHash, node.key);
}

function cmp(a: Uint8Array, b: Uint8Array): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function split(root: Node | null, key: Uint8Array): [Node | null, Node | null] {
  if (!root) return [null, null];
  if (cmp(root.key, key) <= 0) {
    const [left, right] = split(root.right, key);
    root.right = left;
    updateNode(root);
    return [root, right];
  }
  const [left, right] = split(root.left, key);
  root.left = right;
  updateNode(root);
  return [left, root];
}

function merge(left: Node | null, right: Node | null): Node | null {
  if (!left) return right;
  if (!right) return left;
  if (left.priority > right.priority) {
    left.right = merge(left.right, right);
    updateNode(left);
    return left;
  }
  right.left = merge(left, right.left);
  updateNode(right);
  return right;
}

function insert(root: Node | null, key: Uint8Array, priority: bigint): Node {
  const middle: Node = { key, priority, merkleHash: key, left: null, right: null };
  if (!root) return middle;
  const [left, right] = split(root, key);
  return merge(merge(left, middle), right)!;
}

/** ldif-sdk's `ignoredKeyLength = 768` — RSA-6144 keys are excluded from
 * the tree because the ZK circuits don't support them. */
export const IGNORED_KEY_LENGTH = 768;

export interface IcaoMasterTree {
  /** Returns the 32-byte merkle root. */
  root(): Uint8Array;
  /** Inclusion proof for a pubKey. Returns the siblings list (leaf→root).
   * Throws if the pubKey isn't in the tree. */
  generateProof(pubKey: Uint8Array): Uint8Array[];
}

/** Build the canonical ICAO master tree from a list of DER-encoded CSCA
 * certificates. The order of `cscaCertDers` doesn't affect the tree (the
 * treap structure is determined by deterministic key+priority), but
 * deduplication preserves the FIRST occurrence — match Go SDK semantics. */
export function buildIcaoMasterTree(cscaCertDers: Uint8Array[]): IcaoMasterTree {
  let root: Node | null = null;
  const seen = new Set<string>();

  for (const certDer of cscaCertDers) {
    let pubKey: Uint8Array;
    try {
      pubKey = pubKeyBytesFromSpki(spkiFromCert(certDer));
    } catch {
      // Unsupported algorithm (e.g., DSA) — Go SDK errors, we silently
      // skip; not in practice because every CSCA in the bundled list is
      // RSA or ECDSA.
      continue;
    }
    if (pubKey.length === IGNORED_KEY_LENGTH) continue;
    const dupKey = Buffer.from(pubKey).toString('hex');
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    const leaf = keccak(pubKey);
    root = insert(root, leaf, derivePriority(leaf));
  }

  if (!root) throw new Error('empty master tree');
  const r = root;

  return {
    root: () => r.merkleHash,
    generateProof: (pubKey: Uint8Array): Uint8Array[] => {
      const targetLeaf = keccak(pubKey);
      // Walk from root collecting siblings, then reverse — same shape the
      // on-chain `MerkleProof.processProof(leaf, proof)` consumes.
      const siblings: Uint8Array[] = [];
      let node: Node | null = r;
      while (node) {
        const c = cmp(node.key, targetLeaf);
        if (c === 0) {
          const childHash = hashChildren(node.left, node.right);
          if (childHash.length > 0) siblings.push(childHash);
          siblings.reverse();
          return siblings;
        }
        if (c > 0) {
          siblings.push(node.key);
          if (node.right) siblings.push(node.right.merkleHash);
          node = node.left;
        } else {
          siblings.push(node.key);
          if (node.left) siblings.push(node.left.merkleHash);
          node = node.right;
        }
      }
      throw new Error('pubKey not in master tree');
    },
  };
}
