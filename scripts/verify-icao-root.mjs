// Verify our locally-computed ICAO master root matches Mainnet's
// stateKeeper.icaoMasterTreeMerkleRoot(). If they differ, the bundled
// masters_asset.pem is stale (or our algorithm port is wrong) — either way
// we can't proceed with on-app CSCA registration until that's resolved.
//
// Algorithm — direct port of rarimo/ldif-sdk's mt/treap_tree.go:
//   leaf       = keccak256(pubKeyBytes)
//   priority   = keccak256(leaf) mod (2^64 - 1)        ← uint64 max, not 2^64
//   tree       = randomized BST (treap) on (leaf, priority)
//   nodeHash   = leafHash if no children
//              = hash(combinedChildrenHash, leafHash)   otherwise
//   hash(a, b) = keccak256(min(a,b) || max(a,b))        OZ-style sorted pair
//
// Pubkey bytes (matches Go's icaoMemberKey):
//   RSA   → modulus N bytes (big-endian, leading zeros stripped via .Bytes())
//   ECDSA → X.Bytes() || Y.Bytes()  ← no leading zero strip per coord here

import fs from 'node:fs';
import crypto from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';

const PEM_PATH = '/home/alexis/Apps/inid-passport-debug/assets/certificates/master_000316.pem';
const EXPECTED_ROOT = '0x490355b1c9cca56d89c180780c5ea66c1766d57cf22670c7a9a07dc18b835a4f';

const toHex = (u8) => Buffer.from(u8).toString('hex');

function stripLeadingZeros(buf) {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i++;
  return Buffer.from(buf.subarray(i));
}

function base64UrlToBuffer(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// Minimal DER reader. Returns { tag, length, contentStart, contentEnd, nextStart }.
function readTLV(buf, off) {
  const tag = buf[off];
  let lenByte = buf[off + 1];
  let lenStart = off + 2;
  let length;
  if (lenByte < 0x80) {
    length = lenByte;
  } else {
    const numLenBytes = lenByte & 0x7f;
    length = 0;
    for (let i = 0; i < numLenBytes; i++) length = (length << 8) | buf[lenStart + i];
    lenStart += numLenBytes;
  }
  return {
    tag,
    length,
    contentStart: lenStart,
    contentEnd: lenStart + length,
    nextStart: lenStart + length,
  };
}

// Extract the public-key bytes Go's icaoMemberKey produces for each cert.
// Parses SPKI DER directly because Node's JWK exporter doesn't handle the
// brainpool curves used by ~16% of CSCAs (BSI HSM_DS_1 chain is brainpool).
function extractPubKeyBytes(certPem) {
  const cert = new crypto.X509Certificate(certPem);
  const spki = Buffer.from(cert.publicKey.export({ format: 'der', type: 'spki' }));

  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  const outer = readTLV(spki, 0);            // outer SEQUENCE
  const algo = readTLV(spki, outer.contentStart); // AlgorithmIdentifier SEQUENCE
  const bitStr = readTLV(spki, algo.nextStart);   // BIT STRING (tag 0x03)
  // BIT STRING content: first byte is "unused bits" count, then the payload.
  const payloadStart = bitStr.contentStart + 1;
  const payload = spki.subarray(payloadStart, bitStr.contentEnd);

  // Distinguish RSA vs EC by the algorithm OID. RSA SubjectPublicKey is a
  // DER-encoded RSAPublicKey SEQUENCE; EC SubjectPublicKey is the raw
  // uncompressed point bytes.
  // OID is inside AlgorithmIdentifier — first child is OID (tag 0x06).
  const algoOidTlv = readTLV(spki, algo.contentStart);
  const oidBytes = spki.subarray(algoOidTlv.contentStart, algoOidTlv.contentEnd);
  const oid = oidToString(oidBytes);

  if (oid === '1.2.840.113549.1.1.1') {
    // RSA: payload is DER of RSAPublicKey { modulus INTEGER, exponent INTEGER }.
    const rsaSeq = readTLV(payload, 0);
    const modTlv = readTLV(payload, rsaSeq.contentStart);
    let mod = payload.subarray(modTlv.contentStart, modTlv.contentEnd);
    // ASN.1 INTEGERs prefix a 0x00 when MSB would set the sign bit. Strip it
    // — Go's big.Int.Bytes() returns the same unsigned magnitude.
    return stripLeadingZeros(mod);
  }
  if (oid === '1.2.840.10045.2.1') {
    // EC: payload is 0x04 || X || Y (uncompressed point). Curve byte length
    // is (payload.length - 1) / 2.
    if (payload[0] !== 0x04) throw new Error(`compressed EC point (prefix ${payload[0]})`);
    const coordLen = (payload.length - 1) / 2;
    const x = payload.subarray(1, 1 + coordLen);
    const y = payload.subarray(1 + coordLen);
    return Buffer.concat([stripLeadingZeros(Buffer.from(x)), stripLeadingZeros(Buffer.from(y))]);
  }
  throw new Error(`unsupported pubkey algorithm OID: ${oid}`);
}

function oidToString(bytes) {
  if (bytes.length === 0) return '';
  const first = bytes[0];
  const parts = [Math.floor(first / 40), first % 40];
  let v = 0;
  for (let i = 1; i < bytes.length; i++) {
    v = (v << 7) | (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

function keccak(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = Buffer.alloc(total);
  let off = 0;
  for (const p of parts) { Buffer.from(p).copy(buf, off); off += p.length; }
  return Buffer.from(keccak_256(buf));
}

// hash(a, b) — empty-aware, sorted-pair keccak256.
function hash(a, b) {
  if (!a || a.length === 0) return b;
  if (!b || b.length === 0) return a;
  if (Buffer.compare(a, b) < 0) return keccak(a, b);
  return keccak(b, a);
}

function hashNodes(left, right) {
  const l = left ? left.merkleHash : Buffer.alloc(0);
  const r = right ? right.merkleHash : Buffer.alloc(0);
  return hash(l, r);
}

function updateNode(node) {
  const childHash = hashNodes(node.left, node.right);
  node.merkleHash = (childHash.length === 0) ? node.key : hash(childHash, node.key);
}

const MAX_UINT64 = (1n << 64n) - 1n;
function derivePriority(key) {
  const h = keccak(key);
  const big = BigInt('0x' + h.toString('hex'));
  return big % MAX_UINT64;
}

function split(root, key) {
  if (!root) return [null, null];
  if (Buffer.compare(root.key, key) <= 0) {
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

function merge(left, right) {
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

function insert(root, key, priority) {
  const middle = { key, merkleHash: key, priority, left: null, right: null };
  if (!root) return middle;
  const [left, right] = split(root, key);
  return merge(merge(left, middle), right);
}

const pemContent = fs.readFileSync(PEM_PATH, 'utf8');
const pemBlocks = pemContent.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
console.log('PEM blocks:', pemBlocks.length);

// Filters from rarimo/ldif-sdk utils/cert.go::ExtractPubKeys:
//   1. Skip keys whose pubKey.Bytes() length is 768 bytes (RSA-6144) — ZKP
//      circuits don't support that key size; ldif-sdk hardcodes the
//      `ignoredKeyLength = 768` constant.
//   2. Deduplicate by the pubKey big-int value — multiple certs can share
//      a public key (rotation, parallel signing chains). Only the first
//      occurrence enters the tree.
const IGNORED_KEY_LENGTH = 768;

let root = null;
let failures = 0;
const failuresByReason = new Map();
const seen = new Set();
let skippedDup = 0, skipped6144 = 0;

for (let i = 0; i < pemBlocks.length; i++) {
  try {
    const pubKeyBytes = extractPubKeyBytes(pemBlocks[i]);
    if (pubKeyBytes.length === IGNORED_KEY_LENGTH) { skipped6144++; continue; }
    const dupKey = pubKeyBytes.toString('hex');
    if (seen.has(dupKey)) { skippedDup++; continue; }
    seen.add(dupKey);
    const leaf = keccak(pubKeyBytes);
    const priority = derivePriority(leaf);
    root = insert(root, leaf, priority);
    if (i < 3 || i === pemBlocks.length - 1) {
      console.log(`#${i}: pubKeyLen=${pubKeyBytes.length} leaf=${leaf.toString('hex').slice(0, 12)}… priority=${priority}`);
    }
  } catch (e) {
    failures++;
    const k = e.message.slice(0, 60);
    failuresByReason.set(k, (failuresByReason.get(k) ?? 0) + 1);
  }
}
console.log(`Skipped: ${skippedDup} duplicates, ${skipped6144} RSA-6144 keys`);

console.log('\nProcessed:', pemBlocks.length, 'Failures:', failures);
for (const [r, n] of failuresByReason) console.log(`  ${n}× ${r}`);
console.log('Local root:    0x' + (root?.merkleHash.toString('hex') ?? '(none)'));
console.log('On-chain root:', EXPECTED_ROOT);
const match = root && ('0x' + root.merkleHash.toString('hex')) === EXPECTED_ROOT.toLowerCase();
console.log('Match:', match ? '✅ YES' : '❌ NO');
