/**
 * Simulate the CSCA-bootstrap `registerCertificate` call for a captured
 * passport, on chain, WITHOUT sending anything — and print the real revert
 * reason if it would fail.
 *
 * Why this exists
 * ---------------
 * The Rarimo registration relayer answers an opaque `500 Internal Server
 * Error` both when its infra is down and when the transaction it would send
 * reverts. The app cannot tell those apart, and neither can a tester's error
 * report. This mirrors exactly what utils/csca-bootstrap.ts does — same SKI
 * lookup, same tree, same calldata builder — and then `eth_call`s the result
 * against Registration2 as the relayer's own EOA. A revert comes back with the
 * contract's own message ("invalid icao proof", "invalid x509 certificate",
 * "the key already exists", …), which is the thing nobody could see.
 *
 * Usage:
 *   npx tsx scripts/simulate-csca-bootstrap.ts <person-dir> [<person-dir> …]
 * where each dir holds a `passport-*.json` scan fixture with `dgHex.sod`.
 * Run it from this repo so tsx picks up the `@/` path alias from tsconfig.
 *
 * Read-only: it never posts to the relayer and never sends a transaction.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsnConvert } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import { ethers } from 'ethers';

import { Sod } from '@/utils/e-document/sod';
import {
  buildIcaoMasterTree,
  extractAuthorityKeyIdentifier,
  extractSubjectKeyIdentifier,
  pemToDerList,
  pubKeyBytesFromSpki,
  spkiFromCert,
} from '@/utils/icao-master-tree';
import {
  buildRegisterCertificateCalldata,
  MAINNET_REGISTRATION2_ADDRESS,
} from '@/utils/build-register-cert-calldata';

const RPC = 'https://l2.rarimo.com';
/** The relayer's own sender, from the maintainer's successful bootstrap tx at block 2329. */
const RELAYER_EOA = '0xe4d595Aa9d2c344ee47D912c8288440bC00D3C6c';
/** CertificatesSMT — where registered DS certs live; the tree the app checks. */
const CERT_SMT = '0xA8b350d699632569D5351B20ffC1b31202AcEDD8';
/** Registration2.certificateDispatchers(keccak("C_RSA_2048")) before and after the
 *  Sept 5 2026 04:04 UTC redeploy (blocks 68223 → 68224). */
const OLD_C_RSA_2048 = '0xDAa6C3FC709c5BE73F36f41C796040f4B9df3D6f';
const NEW_C_RSA_2048 = '0xeC61215c700a17b4b5D50D2fF7d3CCfC19A8937c';
const REGISTER_ABI = [
  'function registerCertificate((bytes32 dataType, bytes signedAttributes, uint256 keyOffset, uint256 expirationOffset) certificate_, (bytes signature, bytes publicKey) icaoMember_, bytes32[] icaoMerkleProof_)',
];
const PEM = path.resolve(__dirname, '../assets/certificates/master_000316.pem');

function revertReason(e: unknown): string {
  const err = e as { data?: string; info?: { error?: { data?: string } }; reason?: string; shortMessage?: string; message?: string };
  const d = err?.data ?? err?.info?.error?.data ?? '';
  if (typeof d === 'string' && d.startsWith('0x08c379a0')) {
    try {
      return 'Error(string): ' + ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + d.slice(10))[0];
    } catch { /* fall through */ }
  }
  return err?.reason ?? err?.shortMessage ?? err?.message ?? String(e);
}

async function main() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: npx tsx scripts/simulate-csca-bootstrap.ts <person-dir> [...]');
    process.exit(2);
  }

  // --- master list, exactly as the app builds it -------------------------
  const ders = pemToDerList(fs.readFileSync(PEM, 'utf8'));
  const tree = buildIcaoMasterTree(ders);
  const bySki = new Map<string, { der: Uint8Array; pubKey: Uint8Array }>();
  for (const der of ders) {
    const ski = extractSubjectKeyIdentifier(der);
    if (!ski) continue;
    let pubKey: Uint8Array;
    try { pubKey = pubKeyBytesFromSpki(spkiFromCert(der)); } catch { continue; }
    const skiHex = Buffer.from(ski).toString('hex');
    if (!bySki.has(skiHex)) bySki.set(skiHex, { der, pubKey }); // first occurrence wins, as the app does
  }
  console.log(`master list: ${ders.length} certs, ${bySki.size} by SKI, root ${Buffer.from(tree.root()).toString('hex').slice(0, 16)}…\n`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const latest = await provider.getBlockNumber();

  for (const dir of dirs) {
    const who = path.basename(dir);
    try {
      const file = fs.readdirSync(dir).find((f) => f.startsWith('passport') && f.endsWith('.json'));
      if (!file) { console.log(`${who}: no passport-*.json`); continue; }
      const sodHex: string | undefined = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))?.dgHex?.sod;
      if (!sodHex) { console.log(`${who}: no dgHex.sod`); continue; }

      // --- the app's pipeline, step for step ---------------------------
      const slave = new Sod(new Uint8Array(Buffer.from(sodHex, 'hex'))).slaveCertificate;
      const slaveDer = new Uint8Array(AsnConvert.serialize(slave.certificate));
      const aki = extractAuthorityKeyIdentifier(slaveDer);
      if (!aki) { console.log(`${who}: DS has no AKI`); continue; }
      const akiHex = Buffer.from(aki).toString('hex');
      const match = bySki.get(akiHex);
      if (!match) { console.log(`${who}: CSCA ${akiHex.slice(0, 16)}… not in bundle`); continue; }
      const proof = tree.generateProof(match.pubKey);
      const master = AsnConvert.parse(match.der, Certificate);
      const { calldata, destination, dispatcherName } = buildRegisterCertificateCalldata({ slave, master, icaoMerkleProof: proof });

      // DS validity, since an expired certificate is one plausible revert.
      const notAfter = slave.certificate.tbsCertificate.validity.notAfter;
      const expiry = (notAfter.utcTime ?? notAfter.generalTime) as Date | undefined;

      console.log(`=== ${who} ===`);
      console.log(`  CSCA ${akiHex.slice(0, 16)}…  dispatcher ${dispatcherName}  proof ${proof.length} siblings  calldata ${(calldata.length - 2) / 2} B  DS expires ${expiry?.toISOString().slice(0, 10) ?? '?'}`);

      // --- simulate, don't send --------------------------------------------
      try {
        await provider.call({ to: destination, from: RELAYER_EOA, data: calldata, blockTag: latest });
        console.log(`  @${latest}: WOULD SUCCEED — bootstrap is fine for this passport`);
      } catch (e) {
        console.log(`  @${latest}: REVERT — ${revertReason(e)}`);
      }

      // --- the app's existence check vs what the contract keys on ---------
      // The app decides whether to bootstrap by looking the DS cert up in
      // CertificatesSMT under `slaveCertificateIndex`. If that key is not the
      // one `registerCertificate` inserted under, the app never sees a
      // registered cert, tries to re-register it, and the contract answers
      // "the key already exists" — which the relayer surfaces as a 500.
      // What the app looks up under NOW (sha256, since the fix) and what it
      // used to (legacy Poseidon). Both printed so the change is auditable.
      const appKey = '0x' + Buffer.from(slave.slaveCertificateSmtKey).toString('hex').padStart(64, '0');
      const legacyKey = '0x' + Buffer.from(slave.slaveCertificateIndex).toString('hex').padStart(64, '0');
      const smt = new ethers.Contract(
        CERT_SMT,
        ['function getProof(bytes32 key_) view returns (tuple(bytes32 root, bytes32[] siblings, bool existence, bytes32 key, bytes32 value, bool auxExistence, bytes32 auxKey, bytes32 auxValue))'],
        provider,
      );
      const p = await smt.getProof(appKey);
      const pLegacy = await smt.getProof(legacyKey);
      console.log(`  app key (sha256)  ${appKey.slice(0, 18)}…  → SMT existence = ${p.existence}`);
      console.log(`  legacy (Poseidon) ${legacyKey.slice(0, 18)}…  → SMT existence = ${pLegacy.existence}`);

      // What each dispatcher derives as the key for this exact certificate.
      const iface = new ethers.Interface(REGISTER_ABI);
      const [certArg] = iface.decodeFunctionData('registerCertificate', calldata);
      const dispAbi = [
        'function getCertificatePublicKey(bytes memory certificate_, uint256 keyOffset_) view returns (bytes memory)',
        'function getCertificateKey(bytes memory certificatePublicKey_) view returns (bytes32)',
      ];
      let newPk = '';
      let newKey = '';
      for (const [label, addr] of [['OLD dispatcher (pre Sept 5)', OLD_C_RSA_2048], ['NEW dispatcher (since Sept 5)', NEW_C_RSA_2048]] as const) {
        try {
          const d = new ethers.Contract(addr, dispAbi, provider);
          const pk: string = await d.getCertificatePublicKey(certArg.signedAttributes, certArg.keyOffset);
          const key: string = await d.getCertificateKey(pk);
          console.log(`  ${label.padEnd(30)} key ${key.slice(0, 18)}…  ${key.toLowerCase() === appKey.toLowerCase() ? '== app key' : '!= app key'}`);
          if (addr === NEW_C_RSA_2048) { newPk = pk; newKey = key.toLowerCase(); }
        } catch (e) {
          console.log(`  ${label.padEnd(30)} (call failed: ${(e as Error).message.slice(0, 60)})`);
        }
      }

      // --- reverse-engineer the NEW derivation from the pubkey bytes --------
      // The new key starts with 0x00…, i.e. it fits in 248 bits — the same
      // "keccak truncated to 248 bits" convention Rarimo uses for event data.
      // Try the obvious candidates and name the one that matches.
      if (newPk && newKey) {
        const pkBytes = ethers.getBytes(newPk);
        const mask248 = (1n << 248n) - 1n;
        const hex32 = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
        const spki = spkiFromCert(slaveDer);
        const cands: Array<[string, string]> = [
          ['keccak256(pk) >> 8', hex32(BigInt(ethers.keccak256(pkBytes)) >> 8n)],
          ['keccak256(pk) & mask248', hex32(BigInt(ethers.keccak256(pkBytes)) & mask248)],
          ['keccak256(pk)', ethers.keccak256(pkBytes)],
          ['keccak256(0x00‖pk) >> 8', hex32(BigInt(ethers.keccak256(new Uint8Array([0, ...pkBytes]))) >> 8n)],
          ['keccak256(spki) >> 8', hex32(BigInt(ethers.keccak256(spki)) >> 8n)],
          ['sha256(pk) >> 8', hex32(BigInt(ethers.sha256(pkBytes)) >> 8n)],
          ['sha256(pk) & mask248', hex32(BigInt(ethers.sha256(pkBytes)) & mask248)],
        ];
        console.log(`  dispatcher-extracted pubkey: ${pkBytes.length} B, starts ${newPk.slice(0, 10)}…`);
        const hit = cands.find(([, v]) => v.toLowerCase() === newKey);
        if (hit) console.log(`  NEW derivation = ${hit[0]}   ✅ matches`);
        else console.log(`  NEW derivation: none of ${cands.length} keccak/sha candidates match — likely Poseidon or a different input; see verified source`);
        // Full value, so a unit test can pin exactly what the chain computes.
        console.log(`  NEW key (full) ${newKey}`);
      }
      console.log('');
    } catch (e) {
      console.log(`${who}: pipeline threw — ${(e as Error).message}\n`);
    }
  }
  console.log(`(destination ${MAINNET_REGISTRATION2_ADDRESS}, simulated as relayer ${RELAYER_EOA}; nothing was sent)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
