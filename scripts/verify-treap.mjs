// Run the rarimo/ldif-sdk treap_tree_test.go vectors through our port.
// If in-order traversal matches `shouldBeBuilt`, our split/merge/priority
// implementation is correct. Then any mismatch with the on-chain ICAO root
// is the bundled masters_asset.pem being out of date, not an algo bug.

import { keccak_256 } from '@noble/hashes/sha3.js';

const leavesToInsert = [
  '9490df6c03b5c8c4f6ac15f66ecb60d4cf69f6eb8ccc939e5260278aa0d12709',
  'e6b17e88388f66064cdc35944187eb5405eada720a9d8cdca24f6c508d9cd245',
  'bbe7408eb7ff72c417cd4b52a561ad9a3357662e8ea649852550f64cace04333',
  '97caed46231f53ce7373beeb905296f257db61dedb44a39cec820c9f1c6fe9bd',
  '480fa52802155f3ebe19b4b00a2ed6363b2c3604eb7905c4096c123712f74ce0',
  'c70c578772fc448a8d9c5f14a13a50a0a87224c68fe7afd2b688da3a504d67fc',
  '19ef3f3bd0fa2bec51048242633eb69c6bae9a7fe66b805ebf7d638d5ffd22be',
  '37c2efa5eede6b5479cd3289c5d37cd29d8c7aa00e964b85ca0e7e00196e786e',
  'cd88a641cca6308c9ff8474c538b3df59dca3eb665eb1b0faee44dcdbaed0ee3',
  '1c7020ea7ca8c94af4bcd7fc8de15a3b842716c487ea528ab05869453771b25f',
  '7425e3f2a4a9590221bacd85c0dec7040d2ec1939e67361f54905d13012fb518',
  '7e565652052881284caf9599af06742d4a03e5ff0e6612efc7ec68476e6ca9dc',
  'e75daac5a045c53f713b3f0e72494f45d41e712f4b9c8c33ca4550eda34f5532',
  '849ce15ec91f20e02cc6cabefde1b9dbb7fb18d7239dba77d578255ed7363357',
  '6809d51a13d958e75dab522670030397e905f674a426e8e3febfd0aea7208941',
  '963ed624c6204df0c10460007147aa945ef528b89560c4ddefe4ebcf1ec8f345',
];

const shouldBeBuilt = [
  'bbe7408eb7ff72c417cd4b52a561ad9a3357662e8ea649852550f64cace04333',
  '9490df6c03b5c8c4f6ac15f66ecb60d4cf69f6eb8ccc939e5260278aa0d12709',
  '1c7020ea7ca8c94af4bcd7fc8de15a3b842716c487ea528ab05869453771b25f',
  '19ef3f3bd0fa2bec51048242633eb69c6bae9a7fe66b805ebf7d638d5ffd22be',
  '6809d51a13d958e75dab522670030397e905f674a426e8e3febfd0aea7208941',
  '37c2efa5eede6b5479cd3289c5d37cd29d8c7aa00e964b85ca0e7e00196e786e',
  '480fa52802155f3ebe19b4b00a2ed6363b2c3604eb7905c4096c123712f74ce0',
  '7425e3f2a4a9590221bacd85c0dec7040d2ec1939e67361f54905d13012fb518',
  '7e565652052881284caf9599af06742d4a03e5ff0e6612efc7ec68476e6ca9dc',
  '849ce15ec91f20e02cc6cabefde1b9dbb7fb18d7239dba77d578255ed7363357',
  '97caed46231f53ce7373beeb905296f257db61dedb44a39cec820c9f1c6fe9bd',
  '963ed624c6204df0c10460007147aa945ef528b89560c4ddefe4ebcf1ec8f345',
  'cd88a641cca6308c9ff8474c538b3df59dca3eb665eb1b0faee44dcdbaed0ee3',
  'c70c578772fc448a8d9c5f14a13a50a0a87224c68fe7afd2b688da3a504d67fc',
  'e75daac5a045c53f713b3f0e72494f45d41e712f4b9c8c33ca4550eda34f5532',
  'e6b17e88388f66064cdc35944187eb5405eada720a9d8cdca24f6c508d9cd245',
];

function keccak(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = Buffer.alloc(total);
  let off = 0;
  for (const p of parts) { Buffer.from(p).copy(buf, off); off += p.length; }
  return Buffer.from(keccak_256(buf));
}

const MAX_UINT64 = (1n << 64n) - 1n;
function derivePriority(key) {
  const h = keccak(key);
  const big = BigInt('0x' + h.toString('hex'));
  return big % MAX_UINT64;
}

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

// Pre-order traversal (root, left, right). Matches `treapToList` in
// ldif-sdk/mt/treap_tree_test.go — what `shouldBeBuilt` is comparing against.
function preOrder(node, out = []) {
  if (!node) return out;
  out.push(node.key.toString('hex'));
  preOrder(node.left, out);
  preOrder(node.right, out);
  return out;
}

let root = null;
for (const hex of leavesToInsert) {
  const key = Buffer.from(hex, 'hex');
  root = insert(root, key, derivePriority(key));
}

const actual = preOrder(root);
let allMatch = true;
for (let i = 0; i < shouldBeBuilt.length; i++) {
  const ok = actual[i] === shouldBeBuilt[i];
  if (!ok) allMatch = false;
  console.log(`#${String(i).padStart(2)} ${ok ? '✓' : '✗'} expect=${shouldBeBuilt[i].slice(0,12)}… got=${(actual[i] ?? '').slice(0,12)}…`);
}
console.log('\nTreap test:', allMatch ? '✅ PASS' : '❌ FAIL');
console.log('Root merkleHash: 0x' + root.merkleHash.toString('hex'));
