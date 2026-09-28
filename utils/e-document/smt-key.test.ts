/**
 * What these protect: the key the app uses to ask CertificatesSMT "is this
 * certificate registered?". Get it wrong and the app cannot see registered
 * certificates, re-registers them, and every registration fails with a
 * misleading "service unavailable" — which is exactly what happened on
 * 2026-09-08 after Rarimo changed the derivation on 2026-09-05.
 *
 * Three independent checks on the same value:
 *   1. The function implements sha256 >> 8 on synthetic bytes (always runs).
 *   2. For a real passport, it equals the value the LIVE dispatcher computed
 *      for that certificate, captured on 2026-09-09 (block 70443). This pins
 *      "what Rarimo does", not "what we think Rarimo does".
 *   3. The modulus fed to it is parsed by Node's own X.509 parser — a second,
 *      unrelated implementation — so a bug in the app's ASN.1 handling cannot
 *      hide behind this test.
 *
 * This file deliberately imports nothing from extended-cert.ts (it cannot be
 * loaded under Jest). The getter that wires the derivation into the
 * certificate class is exercised against the chain by
 * scripts/simulate-csca-bootstrap.ts, which runs under tsx and can.
 *
 * Checks 2–3 read a captured passport fixture and skip when it is not there;
 * check 1 does not. Point RC_PASSPORT_FIXTURE_DIR at the directory holding the
 * capture for the passport whose DS certificate the on-chain key below was read
 * for — the key is that certificate's, so another passport will not match. The
 * captures are scans of real documents and are deliberately kept out of this
 * repository.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { smtKeyFromPublicKeyBytes } from './smt-key';

const hex = (b: Uint8Array | Buffer) => '0x' + Buffer.from(b).toString('hex');

describe('smtKeyFromPublicKeyBytes — sha256(pk) >> 8', () => {
  it('drops the last digest byte and prepends a zero byte', () => {
    const pk = new Uint8Array(256).fill(0xab);
    const digest = crypto.createHash('sha256').update(pk).digest();
    const key = smtKeyFromPublicKeyBytes(pk);
    expect(key).toHaveLength(32);
    expect(key[0]).toBe(0x00);
    expect(Buffer.from(key.subarray(1))).toEqual(digest.subarray(0, 31));
    // >> 8 as an integer, spelled out, so the byte gymnastics above are
    // provably the same thing as the arithmetic the dispatcher does.
    expect(BigInt(hex(key))).toBe(BigInt(hex(digest)) >> 8n);
  });

  it('fits in 248 bits, always', () => {
    for (const fill of [0x00, 0x7f, 0xff]) {
      const key = smtKeyFromPublicKeyBytes(new Uint8Array(64).fill(fill));
      expect(BigInt(hex(key)) < 1n << 248n).toBe(true);
    }
  });

  it('is sensitive to every input byte', () => {
    const a = new Uint8Array(256).fill(1);
    const b = new Uint8Array(256).fill(1);
    b[255] ^= 1;
    expect(hex(smtKeyFromPublicKeyBytes(a))).not.toBe(hex(smtKeyFromPublicKeyBytes(b)));
  });
});

// --- the real certificate -------------------------------------------------

const FIXTURE_DIR = process.env.RC_PASSPORT_FIXTURE_DIR
  ? path.resolve(process.env.RC_PASSPORT_FIXTURE_DIR)
  : '';
const haveFixture = FIXTURE_DIR !== '' && fs.existsSync(FIXTURE_DIR);

/**
 * What the NEW C_RSA_2048 dispatcher (0xeC61215c…, live since 2026-09-05)
 * returned from getCertificateKey(getCertificatePublicKey(sa, keyOffset)) for
 * this passport's DS certificate. Captured by scripts/simulate-csca-bootstrap.ts
 * on 2026-09-09 at block 70443. The OLD dispatcher returned 0x02d9141c… for the
 * same certificate — the Poseidon key the app used to compute.
 */
const ON_CHAIN_KEY = '0x000ad6875e96c72e3745f5ca12bcc1639a8a95671f3ff397934dea8ba01f94c5'; // nosec: public CertificatesSMT key — sha256 of a public DS certificate modulus, read off Mainnet at block 70443

/** The DS certificate's modulus, via Node's X.509 parser: JWK `n` is the
 *  unpadded big-endian modulus, exactly the bytes the dispatcher hashes. */
function dsModulusViaNode(): Buffer {
  const file = fs.readdirSync(FIXTURE_DIR).find((f) => f.startsWith('passport') && f.endsWith('.json'))!;
  const sod = Buffer.from(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')).dgHex.sod, 'hex');
  for (let i = 0; i + 4 < sod.length; i++) {
    if (sod[i] !== 0x30 || sod[i + 1] !== 0x82) continue;
    const len = (sod[i + 2] << 8) | sod[i + 3];
    const cand = sod.subarray(i, i + 4 + len);
    if (cand.length !== 4 + len) continue;
    try {
      const jwk = new crypto.X509Certificate(cand).publicKey.export({ format: 'jwk' }) as { n?: string };
      if (jwk.n) return Buffer.from(jwk.n, 'base64url');
    } catch { /* not a certificate at this offset */ }
  }
  throw new Error('no DS certificate found in SOD');
}

(haveFixture ? describe : describe.skip)('against a real French passport', () => {
  it('equals what the live dispatcher computed for this certificate', () => {
    const modulus = dsModulusViaNode();
    expect(modulus).toHaveLength(256); // RSA-2048 DS, no sign-pad byte
    expect(hex(smtKeyFromPublicKeyBytes(modulus))).toBe(ON_CHAIN_KEY);
  });

  it('and that value is sha256 >> 8 of the modulus, re-derived here', () => {
    const modulus = dsModulusViaNode();
    const digest = crypto.createHash('sha256').update(modulus).digest();
    expect(hex(Buffer.concat([Buffer.from([0]), digest.subarray(0, 31)]))).toBe(ON_CHAIN_KEY);
  });

  it('is not the legacy Poseidon key', () => {
    // 0x02d9141c… is what the OLD dispatcher derived (and what the app used to
    // compute). The new key must never collapse back onto it.
    expect(hex(smtKeyFromPublicKeyBytes(dsModulusViaNode())).startsWith('0x02d9141c')).toBe(false);
  });
});
