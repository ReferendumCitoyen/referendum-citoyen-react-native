/**
 * End-to-end CSCA bootstrap. Called by Step 7 when the slave-DSC's leaf
 * isn't in Mainnet's CertificatesSMT — we have to register the slave's
 * CSCA on-chain first (via `Registration2.registerCertificate(...)`)
 * before `registerViaNoir` can proceed.
 *
 * Pipeline:
 *   1. Load `master_000316.pem` (once per app boot, cached as a
 *      Map<SubjectKeyIdentifier, MasterEntry> + a pre-built merkle tree).
 *   2. Find the CSCA that signed the passport's slave cert (slave's
 *      AuthorityKeyIdentifier → CSCA's SubjectKeyIdentifier — O(1) hash
 *      lookup against the cache).
 *   3. Generate the inclusion proof for the CSCA's pubkey (cached tree).
 *   4. ABI-encode `registerCertificate(...)` calldata.
 *   5. POST to the Rarimo registration relayer at
 *      `api.app.rarime.com/integrations/registration-relayer/v1/register`
 *      (it pays gas + submits the tx).
 *
 * Returns the relayer tx_hash. The caller is responsible for waiting on
 * the tx to confirm before re-checking the slave-cert SMT.
 *
 * Reference impl: `inid-passport-debug/src/api/modules/registration/strategy.ts::registerCertificate`
 * + matched against the live tx
 * `0x4f4bc331a8e8cfa4aad4bec9d1615892cf71e9ee21c58bd69c9aee5a0443e29a`
 * (Mainnet block 2329). The first build called X509Certificate over all 857
 * certs (~60 s); the new SKI-keyed cache + tree memoization drops the
 * second-and-later calls to ≲500 ms.
 */

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { AsnConvert } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import { Buffer } from 'buffer';
import type { ExtendedCertificate } from '@/utils/e-document/extended-cert';
import {
  buildIcaoMasterTree,
  extractAuthorityKeyIdentifier,
  extractSubjectKeyIdentifier,
  pemToDerList,
  pubKeyBytesFromSpki,
  spkiFromCert,
  type IcaoMasterTree,
} from '@/utils/icao-master-tree';
import {
  buildRegisterCertificateCalldata,
  MAINNET_REGISTRATION2_ADDRESS,
} from '@/utils/build-register-cert-calldata';
import { RARIME_MAINNET_CONFIG } from '@/constants/rarime-config';
import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers';
import i18n from 'i18next';

// ---------------------------------------------------------------------------
// Cache. Built once per app boot (or once per cache invalidation, e.g. if
// the bundled PEM is ever updated and we change the version). Module-scope
// promise so concurrent callers share the same Build.
// ---------------------------------------------------------------------------

interface MasterEntry {
  /** Raw DER of the cert — kept for AsnConvert.parse when we actually need
   * the structured @peculiar/asn1-x509 `Certificate` (only for the matched
   * CSCA, not all of them). */
  der: Uint8Array;
  /** RSA modulus or ECDSA X||Y, leading zeros stripped — what feeds into
   * keccak256 to produce the merkle leaf. */
  pubKey: Uint8Array;
  /** SKI bytes as hex — the lookup key for matching against a slave's AKI. */
  skiHex: string;
}

interface CachedMasters {
  bySki: Map<string, MasterEntry>;
  tree: IcaoMasterTree;
}

let cachedMastersPromise: Promise<CachedMasters> | null = null;

/** Load + parse master_000316.pem and build the merkle tree. Cached at
 * module scope so all subsequent calls (re-tries, different passports) hit
 * an instant lookup. Call this early (e.g., after NFC scan) to warm the
 * cache before the user actually needs it.
 *
 * If the first attempt fails (asset missing, PEM corrupt, treap error)
 * we null out the cached promise so the next caller retries instead of
 * inheriting a permanent rejected promise. Without this clear, a single
 * transient pre-warm failure would brick CSCA bootstrap for the rest
 * of the app session. */
export async function ensureMastersCache(): Promise<CachedMasters> {
  if (cachedMastersPromise) return cachedMastersPromise;
  const promise = (async (): Promise<CachedMasters> => {
    const asset = Asset.fromModule(require('@/assets/certificates/master_000316.pem'));
    if (!asset.localUri) await asset.downloadAsync();
    if (!asset.localUri) throw new Error('[csca-bootstrap] failed to materialise master_000316.pem');
    const pem = await FileSystem.readAsStringAsync(asset.localUri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const t0 = Date.now();
    const cscaDers = pemToDerList(pem);
    console.log(`[csca-bootstrap] PEM parsed: ${cscaDers.length} CSCAs in ${Date.now() - t0}ms`);

    const t1 = Date.now();
    const bySki = new Map<string, MasterEntry>();
    let skipNoSki = 0;
    for (const der of cscaDers) {
      const ski = extractSubjectKeyIdentifier(der);
      if (!ski) { skipNoSki++; continue; }
      try {
        const pubKey = pubKeyBytesFromSpki(spkiFromCert(der));
        // First occurrence wins, matching ldif-sdk dedup behavior — later
        // certs with the same SKI (cert rotation, parallel chains) get
        // ignored so the merkle leaf stays unique.
        const skiHex = Buffer.from(ski).toString('hex');
        if (!bySki.has(skiHex)) bySki.set(skiHex, { der, pubKey, skiHex });
      } catch {
        // Unsupported pubkey algorithm — skip silently (none in practice).
      }
    }
    console.log(`[csca-bootstrap] SKI map: ${bySki.size} entries (${skipNoSki} skipped: no SKI ext) in ${Date.now() - t1}ms`);

    const t2 = Date.now();
    const tree = buildIcaoMasterTree(cscaDers);
    console.log(`[csca-bootstrap] merkle tree built in ${Date.now() - t2}ms`);

    return { bySki, tree };
  })();
  // Assign immediately so concurrent callers share this attempt — but
  // attach a catch handler that clears the slot if it fails, so the NEXT
  // call retries from scratch instead of inheriting the rejected promise.
  cachedMastersPromise = promise;
  promise.catch(() => {
    if (cachedMastersPromise === promise) {
      cachedMastersPromise = null;
    }
  });
  return promise;
}

// ---------------------------------------------------------------------------
// Relayer POST. Identical body shape to the Android app's
// `registrationManager.relayerRegister(callData, destination)`.
// ---------------------------------------------------------------------------

interface RelayerResponse {
  data: { attributes: { tx_hash: string } };
}

async function postCalldataToRelayer(
  calldata: string,
  destination: string,
): Promise<string> {
  const url =
    RARIME_MAINNET_CONFIG.apiConfiguration.rarimeApiUrl +
    '/integrations/registration-relayer/v1/register';
  const body = { data: { tx_data: calldata, destination, no_send: false } };
  console.log(`[csca-bootstrap] POST ${url} destination=${destination} calldataLen=${calldata.length}`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`[csca-bootstrap] relayer ${resp.status}: ${text}`);
  }
  let parsed: RelayerResponse;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`[csca-bootstrap] relayer body not JSON: ${text}`); }
  const txHash = parsed?.data?.attributes?.tx_hash;
  if (!txHash) {
    throw new Error(`[csca-bootstrap] relayer response missing tx_hash: ${text}`);
  }
  return txHash;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RegisterCscaResult {
  /** Relayer-submitted tx hash. Caller waits for confirmation. */
  txHash: string;
  /** Dispatcher name resolved for this cert (e.g., "C_RSA_2048"). */
  dispatcherName: string;
}

/**
 * Find the CSCA that signed `slave` in the bundled master list, generate
 * an inclusion proof, ABI-encode `registerCertificate(...)`, and POST it
 * to the registration relayer.
 *
 * Throws with a French user-facing message if the CSCA can't be found in
 * the bundled list — that's a hard limit (the only way to fix it is
 * updating master_000316.pem AND the on-chain
 * `icaoMasterTreeMerkleRoot`).
 */
/** Read `Registration2.certificateDispatchers(keccak256(name))` and throw a
 * `[VOTE_INELIGIBLE]` error when the verifier address is zero. Each entry
 * is set by an admin tx on the Rarimo team's side — until they deploy the
 * verifier contract and call setDispatcher, the relayer can't construct a
 * tx for this cert chain and will return HTTP 500. */
async function assertDispatcherDeployed(
  registration2Address: string,
  dispatcherName: string,
): Promise<void> {
  const provider = new JsonRpcProvider(
    RARIME_MAINNET_CONFIG.apiConfiguration.jsonRpcEvmUrl,
  );
  const contract = new Contract(
    registration2Address,
    ['function certificateDispatchers(bytes32) view returns (address)'],
    provider,
  );
  const hash = keccak256(toUtf8Bytes(dispatcherName));
  let verifier: string;
  try {
    verifier = await contract.certificateDispatchers(hash);
  } catch (e: any) {
    // Network blip on the pre-check shouldn't block the user — let the POST
    // run and surface its own error.
    console.warn(
      `[csca-bootstrap] dispatcher pre-check failed (network?), skipping: ${e?.message ?? e}`,
    );
    return;
  }
  if (verifier === ZeroAddress) {
    console.log(
      `[csca-bootstrap] dispatcher "${dispatcherName}" not yet deployed on-chain`,
    );
    throw new Error(
      '[VOTE_INELIGIBLE] ' +
        i18n.t('voting.errors.dispatcherNotDeployed', {
          defaultValue:
            "Votre type de passeport n'est pas encore pris en charge par le contrat " +
            "d'enregistrement Rarimo (autorité de certification ECDSA en attente de " +
            "déploiement on-chain). Notre équipe suit ce blocage avec Rarimo.",
        }),
    );
  }
}

export async function registerCscaForSlave(slave: ExtendedCertificate): Promise<RegisterCscaResult> {
  const { bySki, tree } = await ensureMastersCache();

  // The slave cert here comes from `utils/e-document/sod.ts`. We DER-encode
  // it once so the same lightweight walker we use for CSCAs can find the
  // AuthorityKeyIdentifier without spinning up `@peculiar/x509`.
  const slaveDer = new Uint8Array(AsnConvert.serialize(slave.certificate));
  const slaveAki = extractAuthorityKeyIdentifier(slaveDer);
  if (!slaveAki) {
    throw new Error(
      i18n.t('voting.errors.missingAki', {
        defaultValue:
          "Votre certificat de passeport n'a pas d'AuthorityKeyIdentifier — impossible de déterminer le CSCA signataire.",
      }),
    );
  }
  const slaveAkiHex = Buffer.from(slaveAki).toString('hex');

  const match = bySki.get(slaveAkiHex);
  if (!match) {
    throw new Error(
      i18n.t('voting.errors.cscaNotInBundle', {
        defaultValue:
          "Le certificat racine (CSCA) de votre passeport n'est pas dans la liste ICAO embarquée dans l'application. Demandez à la maintenance de mettre à jour la liste des certificats.",
      }),
    );
  }
  console.log(`[csca-bootstrap] matched CSCA via SKI lookup: ski=${slaveAkiHex.slice(0, 16)}…`);

  const proof = tree.generateProof(match.pubKey);
  console.log(`[csca-bootstrap] generated proof: ${proof.length} siblings`);

  const masterAsn1: Certificate = AsnConvert.parse(match.der, Certificate);
  const { calldata, destination, dispatcherName } = buildRegisterCertificateCalldata({
    slave,
    master: masterAsn1,
    icaoMerkleProof: proof,
  });
  console.log(`[csca-bootstrap] calldata: dispatcherName=${dispatcherName} bytes=${(calldata.length - 2) / 2}`);

  // Pre-check the on-chain dispatcher mapping. As of 2026-05-24 Rarimo has
  // only deployed RSA verifier dispatchers on Mainnet — every C_ECDSA_*
  // combination returns the zero address. POSTing to the relayer in that
  // state burns ~10 s on a request that's guaranteed to revert and surfaces
  // as a generic 500 to the user. Pre-check, fail fast with a VOTE_INELIGIBLE
  // so Step 7's catch keeps the user on the verification screen with a
  // specific message instead of cascading into Step 11's "not registered".
  await assertDispatcherDeployed(destination, dispatcherName);

  const txHash = await postCalldataToRelayer(calldata, destination);
  console.log(`[csca-bootstrap] tx_hash: ${txHash}`);
  return { txHash, dispatcherName };
}

export { MAINNET_REGISTRATION2_ADDRESS };
