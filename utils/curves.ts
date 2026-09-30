import i18n from 'i18next';
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/p256';
import { p384 } from '@noble/curves/p384';
import { p521 } from '@noble/curves/p521';
import { createCurve, CurveFnWithCreate } from '@noble/curves/_shortw_utils';
import { Field } from '@noble/curves/abstract/modular';
import { ECParameters } from '@peculiar/asn1-ecc';

/**
 * RFC 5639 §3 brainpool curve parameters. These have to be defined locally —
 * `@noble/curves` does not ship brainpool out of the box, and previous code
 * here aliased brainpool names to secp256k1/p384/p521 as "fallbacks", which
 * silently produced "bad point: is not on curve" at runtime for every
 * brainpool-issued DSC (Swiss, German, Latvian, Cypriot, … passports).
 */
const BRAINPOOL_P256R1 = {
  p: BigInt('0xA9FB57DBA1EEA9BC3E660A909D838D726E3BF623D52620282013481D1F6E5377'),
  n: BigInt('0xA9FB57DBA1EEA9BC3E660A909D838D718C397AA3B561A6F7901E0E82974856A7'),
  h: BigInt(1),
  a: BigInt('0x7D5A0975FC2C3057EEF67530417AFFE7FB8055C126DC5C6CE94A4B44F330B5D9'),
  b: BigInt('0x26DC5C6CE94A4B44F330B5D9BBD77CBF958416295CF7E1CE6BCCDC18FF8C07B6'),
  Gx: BigInt('0x8BD2AEB9CB7E57CB2C4B482FFC81B7AFB9DE27E1E3BD23C23A4453BD9ACE3262'),
  Gy: BigInt('0x547EF835C3DAC4FD97F8461A14611DC9C27745132DED8E545C1D54C72F046997'),
} as const;

const BRAINPOOL_P384R1 = {
  p: BigInt('0x8CB91E82A3386D280F5D6F7E50E641DF152F7109ED5456B412B1DA197FB71123ACD3A729901D1A71874700133107EC53'),
  n: BigInt('0x8CB91E82A3386D280F5D6F7E50E641DF152F7109ED5456B31F166E6CAC0425A7CF3AB6AF6B7FC3103B883202E9046565'),
  h: BigInt(1),
  a: BigInt('0x7BC382C63D8C150C3C72080ACE05AFA0C2BEA28E4FB22787139165EFBA91F90F8AA5814A503AD4EB04A8C7DD22CE2826'),
  b: BigInt('0x04A8C7DD22CE28268B39B55416F0447C2FB77DE107DCD2A62E880EA53EEB62D57CB4390295DBC9943AB78696FA504C11'),
  Gx: BigInt('0x1D1C64F068CF45FFA2A63A81B7C13F6B8847A3E77EF14FE3DB7FCAFE0CBD10E8E826E03436D646AAEF87B2E247D4AF1E'),
  Gy: BigInt('0x8ABE1D7520F9C2A45CB1EB8E95CFD55262B70B29FEEC5864E19C054FF99129280E4646217791811142820341263C5315'),
} as const;

const BRAINPOOL_P512R1 = {
  p: BigInt('0xAADD9DB8DBE9C48B3FD4E6AE33C9FC07CB308DB3B3C9D20ED6639CCA703308717D4D9B009BC66842AECDA12AE6A380E62881FF2F2D82C68528AA6056583A48F3'),
  n: BigInt('0xAADD9DB8DBE9C48B3FD4E6AE33C9FC07CB308DB3B3C9D20ED6639CCA70330870553E5C414CA92619418661197FAC10471DB1D381085DDADDB58796829CA90069'),
  h: BigInt(1),
  a: BigInt('0x7830A3318B603B89E2327145AC234CC594CBDD8D3DF91610A83441CAEA9863BC2DED5D5AA8253AA10A2EF1C98B9AC8B57F1117A72BF2C7B9E7C1AC4D77FC94CA'),
  b: BigInt('0x3DF91610A83441CAEA9863BC2DED5D5AA8253AA10A2EF1C98B9AC8B57F1117A72BF2C7B9E7C1AC4D77FC94CADC083E67984050B75EBAE5DD2809BD638016F723'),
  Gx: BigInt('0x81AEE4BDD82ED9645A21322E9C4C6A9385ED9F70B5D916C1B43B62EEF4D0098EFF3B1F78E2D0D48D50D1687B93B97D5F7C6D5047406A5E688B352209BCB9F822'),
  Gy: BigInt('0x7DDE385D566332ECC0EABFA9CF7822FDF209F70024A57B1AA000C55B881F8111B2DCDE494A5F485E5BCA4BD88A2763AED1CA2B2FA8F0540678CD1E0F3AD80892'),
} as const;

// Pair each brainpool curve with its RFC-5639 prescribed hash (matching field
// bitlength). The hash isn't used by the only consumer of these curves today
// — `Point.fromBytes` (public-key decoding) doesn't touch ECDSA sign/verify
// — but `createCurve` requires one, and matching the spec keeps the door
// open for future sign/verify use. We borrow the hashes already bundled with
// p256/p384/p521 rather than depending on `@noble/hashes/sha2.js` directly
// (it's ESM-only in v2.x and trips jest-expo's CJS resolver — see
// utils/passport-key-db.ts for the same workaround).
const sha256 = (p256 as unknown as { hash: Parameters<typeof createCurve>[1] }).hash;
const sha384 = (p384 as unknown as { hash: Parameters<typeof createCurve>[1] }).hash;
const sha512 = (p521 as unknown as { hash: Parameters<typeof createCurve>[1] }).hash;

export const brainpoolP256r1: CurveFnWithCreate = createCurve(
  { ...BRAINPOOL_P256R1, Fp: Field(BRAINPOOL_P256R1.p), lowS: false },
  sha256,
);

export const brainpoolP384r1: CurveFnWithCreate = createCurve(
  { ...BRAINPOOL_P384R1, Fp: Field(BRAINPOOL_P384R1.p), lowS: false },
  sha384,
);

export const brainpoolP512r1: CurveFnWithCreate = createCurve(
  { ...BRAINPOOL_P512R1, Fp: Field(BRAINPOOL_P512R1.p), lowS: false },
  sha512,
);

// Mapping of OIDs to curve implementations.
const CURVE_OID_MAP: Record<string, [string, CurveFnWithCreate]> = {
  // ANSI X9.62 named elliptic curves
  '1.2.840.10045.3.1.7': ['secp256r1', p256], // P-256 / prime256v1
  '1.3.132.0.34': ['secp384r1', p384], // P-384
  '1.3.132.0.35': ['secp521r1', p521], // P-521
  '1.3.132.0.10': ['secp256k1', secp256k1],

  // Brainpool curves (RFC 5639 §4.2).
  '1.3.36.3.3.2.8.1.1.7': ['brainpoolP256r1', brainpoolP256r1],
  '1.3.36.3.3.2.8.1.1.11': ['brainpoolP384r1', brainpoolP384r1],
  '1.3.36.3.3.2.8.1.1.13': ['brainpoolP512r1', brainpoolP512r1],
};

/**
 * Resolve a curve from a named-curve OID. Returns null on miss so the caller
 * can fall back to the specifiedCurve fingerprint path.
 */
export function namedCurveFromOID(oid: string): [string, CurveFnWithCreate] | null {
  return CURVE_OID_MAP[oid] ?? null;
}

// Prime → curve mapping for ASN.1 `specifiedCurve` form, where the cert
// encodes the full domain parameters inline instead of referencing a named
// curve via OID. ~149 / 857 CSCAs in our bundled master list use this form
// (CH, DE, LT, LV, CY, BE, HU, NZ, JP, GB, …) — fingerprinting by prime is
// enough to distinguish every standard curve we care about.
const PRIME_TO_CURVE: Record<string, [string, CurveFnWithCreate]> = {
  ['0x' + BRAINPOOL_P256R1.p.toString(16)]: ['brainpoolP256r1', brainpoolP256r1],
  ['0x' + BRAINPOOL_P384R1.p.toString(16)]: ['brainpoolP384r1', brainpoolP384r1],
  ['0x' + BRAINPOOL_P512R1.p.toString(16)]: ['brainpoolP512r1', brainpoolP512r1],
  '0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff': ['secp256r1', p256],
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff': ['secp384r1', p384],
  '0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff': ['secp521r1', p521],
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f': ['secp256k1', secp256k1],
};

/**
 * Parse the value bytes of an ASN.1 DER INTEGER `(02 LL VV..)` into a bigint.
 * Used to extract the prime from `specifiedCurve.fieldID.parameters`, which
 * `@peculiar/asn1-ecc` exposes as a raw ArrayBuffer.
 */
function readDerInteger(ab: ArrayBuffer): bigint {
  const bytes = new Uint8Array(ab);
  if (bytes.length < 2 || bytes[0] !== 0x02) {
    throw new TypeError(
      `readDerInteger: expected ASN.1 INTEGER (0x02), got 0x${(bytes[0] ?? 0).toString(16)}`,
    );
  }
  let off: number;
  let len: number;
  if (bytes[1] & 0x80) {
    const nLen = bytes[1] & 0x7f;
    len = 0;
    for (let i = 0; i < nLen; i++) len = (len << 8) | bytes[2 + i];
    off = 2 + nLen;
  } else {
    len = bytes[1];
    off = 2;
  }
  let hex = '';
  for (let i = off; i < off + len; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return BigInt('0x' + (hex || '0'));
}

/**
 * Resolve a curve from `specifiedCurve` form by fingerprinting the field
 * prime. Returns null when the curve can't be identified — the caller is
 * expected to surface this as an `UnsupportedCurveError` so the user sees a
 * specific message rather than a downstream "bad point" / "not registered"
 * cascade.
 */
export function namedCurveFromSpecified(
  parameters: ECParameters,
): [string, CurveFnWithCreate] | null {
  const sc = parameters.specifiedCurve;
  if (!sc?.fieldID?.parameters) return null;
  let prime: bigint;
  try {
    prime = readDerInteger(sc.fieldID.parameters);
  } catch {
    return null;
  }
  return PRIME_TO_CURVE['0x' + prime.toString(16)] ?? null;
}

/**
 * Tagged error thrown when a DSC uses an EC curve we don't support. Step7's
 * catch block translates this into a `[VOTE_INELIGIBLE]` user message via
 * the `.message` prefix it sets.
 */
export class UnsupportedCurveError extends Error {
  constructor(detail: string) {
    super(
      '[VOTE_INELIGIBLE] ' +
        i18n.t('voting.errors.curveUnsupported', {
          detail,
          defaultValue: `Ce passeport utilise une courbe cryptographique pas encore prise en charge par l'application (${detail}). Notre équipe travaille à ajouter cette compatibilité.`,
        }),
    );
    this.name = 'UnsupportedCurveError';
  }
}
