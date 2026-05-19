/**
 * Build ABI-encoded calldata for `Registration2.registerCertificate(...)` on
 * Mainnet (`0x11BB4B14AA6e4b836580F3DBBa741dD89423B971`).
 *
 * Called by the CSCA bootstrap pre-step in `app/voting-flow.tsx::Step7` when
 * the slave cert isn't yet in the on-chain CertificatesSMT. Reference port
 * of `inid-passport-debug/src/api/modules/registration/strategy.ts::buildRegisterCertCallData`
 * + the Go SDK's `BuildRegisterCertificateCalldata`. Verified end-to-end
 * against the user's previous successful tx (block 2329 on Mainnet) — the
 * dispatcher hash, struct shape, and merkle proof all match byte-for-byte.
 *
 * The flow caller is responsible for:
 *   1. Parsing the slave cert (an `ExtendedCertificate` from
 *      `utils/e-document/extended-cert.ts` — gives us keyOffset / expirationOffset
 *      / signedAttributes for free).
 *   2. Finding the CSCA (master) that signed the slave (issuer name + SKI
 *      match — uses `getSlaveMaster` from
 *      `utils/e-document/helpers/misc.ts`).
 *   3. Generating the inclusion proof (uses `buildIcaoMasterTree` from
 *      `utils/icao-master-tree.ts` against the bundled master_000316.pem).
 * Then hand all three here.
 */

import { AsnConvert } from '@peculiar/asn1-schema';
import {
  id_pkcs_1,
  id_RSASSA_PSS,
  id_sha1WithRSAEncryption,
  id_sha256,
  id_sha384,
  id_sha384WithRSAEncryption,
  id_sha512,
  id_sha512WithRSAEncryption,
  RsaSaPssParams,
} from '@peculiar/asn1-rsa';
import {
  ECParameters,
  id_ecdsaWithSHA1,
  id_ecdsaWithSHA256,
  id_ecdsaWithSHA384,
  id_ecdsaWithSHA512,
} from '@peculiar/asn1-ecc';
import { Certificate } from '@peculiar/asn1-x509';
import { ethers } from 'ethers';
import { Buffer } from 'buffer';
import type { ExtendedCertificate } from '@/utils/e-document/extended-cert';
import { ECDSA_ALGO_PREFIX, Sod } from '@/utils/e-document/sod';
import { extractPubKey } from '@/utils/e-document/helpers/misc';
import { getPublicKeyFromEcParameters } from '@/utils/e-document/helpers/crypto';
import { RSAPublicKey } from '@peculiar/asn1-rsa';
import { toBeArray } from 'ethers';

/** Deployed Registration2 on Rarimo Mainnet — owner of the
 * `registerCertificate(...)` entrypoint. Probed against `0x11BB4B14…` (see
 * inid-passport-debug Config.REGISTRATION_CONTRACT_ADDRESS). */
export const MAINNET_REGISTRATION2_ADDRESS =
  '0x11BB4B14AA6e4b836580F3DBBa741dD89423B971';

/** Minimal ABI for the entrypoint. Static arrays vs tuples — see
 * vote-calldata.ts for why the distinction matters for selector
 * computation. registerCertificate has only structs, no static arrays. */
const REGISTER_CERTIFICATE_ABI = [
  'function registerCertificate(' +
    '(bytes32 dataType, bytes signedAttributes, uint256 keyOffset, uint256 expirationOffset) certificate_,' +
    '(bytes signature, bytes publicKey) icaoMember_,' +
    'bytes32[] icaoMerkleProof_' +
    ')',
];

// ---------------------------------------------------------------------------
// Dispatcher-name resolution. The on-chain Registration2 routes by
// `keccak256(dispatcherName)` to the verifier dispatcher for the cert type.
// Encoding mirrors inid-passport-debug exactly:
//   master RSA  → "C_RSA[_<hash>]_<bits>"  (slave hash + slave bits)
//   master ECDSA → "C_ECDSA_<curve>[_<hash>]_<bits>"
// Hash is OMITTED when `getCircuitHashAlgorithm` returns "" (i.e., for
// SHA256-with-RSA — apparently treated as the default and dropped from the
// name; that's how `C_RSA_2048` was produced for the verified Mainnet tx).
// ---------------------------------------------------------------------------

function circuitHashAlgorithm(cert: Certificate): string {
  switch (cert.signatureAlgorithm.algorithm) {
    case id_sha1WithRSAEncryption:
    case id_ecdsaWithSHA1:
      return 'SHA1';
    case id_RSASSA_PSS: {
      if (!cert.signatureAlgorithm.parameters) {
        throw new Error('RSASSA-PSS parameters missing on cert');
      }
      const params = AsnConvert.parse(cert.signatureAlgorithm.parameters, RsaSaPssParams);
      if (params.hashAlgorithm.algorithm === id_sha256 && params.saltLength === 32) return 'SHA2';
      if (params.hashAlgorithm.algorithm === id_sha384 && params.saltLength === 48) return 'SHA384';
      if (params.hashAlgorithm.algorithm === id_sha512 && params.saltLength === 64) return 'SHA384';
      throw new Error('Unsupported RSASSA-PSS parameters');
    }
    case id_ecdsaWithSHA256:
      return 'SHA2';
    case id_sha384WithRSAEncryption:
    case id_ecdsaWithSHA384:
      return 'SHA384';
    case id_sha512WithRSAEncryption:
    case id_ecdsaWithSHA512:
      return 'SHA512';
    default:
      // id_sha256WithRSAEncryption falls through to "" by design — that's
      // the default cert hash, and the registration contract's dispatcher
      // table doesn't include "_SHA256" in those names.
      return '';
  }
}

function slavePubKeyBits(slaveCert: Certificate): number {
  const pubKey = extractPubKey(slaveCert.tbsCertificate.subjectPublicKeyInfo);
  if (pubKey instanceof RSAPublicKey) {
    // ASN.1 INTEGERs pad a 0x00 when the MSB would set the sign bit. Strip
    // it so the byte length reflects the true modulus length.
    const modBytes = new Uint8Array(pubKey.modulus);
    const unpadded = modBytes[0] === 0x00 ? modBytes.subarray(1) : modBytes;
    return unpadded.byteLength * 8;
  }
  // ECDSA case — pub.px / pub.py are bigints (from @noble/curves).
  const xBytes = toBeArray(pubKey.px);
  const yBytes = toBeArray(pubKey.py);
  return (xBytes.length + yBytes.length) * 8;
}

function dispatcherName(slaveCert: Certificate, masterCert: Certificate): string {
  const masterAlg = masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm;
  const hashAlg = circuitHashAlgorithm(slaveCert);
  const bits = slavePubKeyBits(slaveCert);

  if (masterAlg.includes(id_pkcs_1)) {
    let name = 'C_RSA';
    if (hashAlg) name += `_${hashAlg}`;
    name += `_${bits}`;
    return name;
  }
  if (masterAlg.includes(ECDSA_ALGO_PREFIX)) {
    if (!masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
      throw new Error('Master ECDSA pubkey missing parameters');
    }
    const masterEcParams = AsnConvert.parse(
      masterCert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
      ECParameters,
    );
    const [, , masterCurveName] = getPublicKeyFromEcParameters(
      masterEcParams,
      new Uint8Array(masterCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey),
    );
    let name = `C_ECDSA_${masterCurveName}`;
    if (hashAlg) name += `_${hashAlg}`;
    name += `_${bits}`;
    return name;
  }
  throw new Error(`Unsupported master pubkey algorithm: ${masterAlg}`);
}

/** keccak256(dispatcherName) — the `dataType` field of `Certificate` on-chain.
 * Exposed for tests so we can pin known values (e.g. C_RSA_2048 →
 * 0xbf09b046e1fd32abb843f6ee4422c076a6fb365390d5be71020535c149781da1). */
export function dispatcherHash(slaveCert: Certificate, masterCert: Certificate): {
  name: string;
  hash: string;
} {
  const name = dispatcherName(slaveCert, masterCert);
  const hash = ethers.keccak256(ethers.toUtf8Bytes(name));
  return { name, hash };
}

// ---------------------------------------------------------------------------
// Calldata builder
// ---------------------------------------------------------------------------

export interface RegisterCertCalldataResult {
  /** 0x-prefixed ABI-encoded calldata. */
  calldata: string;
  /** Always MAINNET_REGISTRATION2_ADDRESS — convenience for the relayer POST. */
  destination: string;
  /** Useful for logging — the resolved dispatcher name (e.g., "C_RSA_2048"). */
  dispatcherName: string;
}

export function buildRegisterCertificateCalldata(args: {
  slave: ExtendedCertificate;
  master: Certificate;
  /** Siblings from `IcaoMasterTree.generateProof(masterPubKeyBytes)`. */
  icaoMerkleProof: Uint8Array[];
}): RegisterCertCalldataResult {
  const { slave, master, icaoMerkleProof } = args;

  if (icaoMerkleProof.length === 0) {
    throw new Error(
      '[buildRegisterCertificateCalldata] empty merkle proof — master cert ' +
      'not in the master tree. Check master_000316.pem coverage.',
    );
  }

  const { name, hash } = dispatcherHash(slave.certificate, master);

  // signedAttributes = DER of TBSCertificate (the part the CSCA signed over).
  // `keyOffset` and `expirationOffset` are byte offsets INTO this serialized
  // TBS — used by the on-chain verifier to slice out the slave pubkey and
  // notAfter timestamp without re-parsing ASN.1.
  const certificateArg = {
    dataType: hash,
    signedAttributes: new Uint8Array(AsnConvert.serialize(slave.certificate.tbsCertificate)),
    keyOffset: slave.slaveCertPubKeyOffset,
    expirationOffset: slave.slaveCertExpOffset,
  };

  const icaoMemberArg = {
    signature: slave.getSlaveCertIcaoMemberSignature(master),
    publicKey: Sod.getSlaveCertIcaoMemberKey(master),
  };

  const siblingsHex = icaoMerkleProof.map(
    (s) => '0x' + Buffer.from(s).toString('hex'),
  );

  const iface = new ethers.Interface(REGISTER_CERTIFICATE_ABI);
  const calldata = iface.encodeFunctionData('registerCertificate', [
    certificateArg,
    icaoMemberArg,
    siblingsHex,
  ]);

  return {
    calldata,
    destination: MAINNET_REGISTRATION2_ADDRESS,
    dispatcherName: name,
  };
}
