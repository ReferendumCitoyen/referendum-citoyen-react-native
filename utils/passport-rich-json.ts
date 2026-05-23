/**
 * Builds a rich JSON dump from a `PassportData` returned by
 * `modules/e-document.scanDocument`. Used by the dev tool at
 * `app/passport-json-tool.tsx`.
 *
 * Every parsed sub-field is wrapped in its own try/catch so a partial scan
 * (e.g. only dg1+sod, no dg11/12/14/15) still emits valid JSON — the
 * sections that couldn't be parsed land as `null` rather than blowing up
 * the whole dump.
 */

import { Platform } from 'react-native';
import { parse as parseMrzLib } from 'mrz';
import { DG1, DG11, DG12, DG14, DG15 } from '@li0ard/tsemrtd';
import { AsnConvert } from '@peculiar/asn1-schema';
import { RSAPublicKey } from '@peculiar/asn1-rsa';

import type { PassportData } from '@/modules/e-document';
import { Sod } from '@/utils/e-document/sod';

// ---- hex helpers ---------------------------------------------------------

const toHex = (u: Uint8Array | null | undefined): string => {
  if (!u || !u.length) return '';
  return Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
};

// ---- OID -> friendly name maps ------------------------------------------

const HASH_OIDS: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

const SIG_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'RSA-SHA1',
  '1.2.840.113549.1.1.11': 'RSA-SHA256',
  '1.2.840.113549.1.1.12': 'RSA-SHA384',
  '1.2.840.113549.1.1.13': 'RSA-SHA512',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.10045.4.1': 'ECDSA-SHA1',
  '1.2.840.10045.4.3.2': 'ECDSA-SHA256',
  '1.2.840.10045.4.3.3': 'ECDSA-SHA384',
  '1.2.840.10045.4.3.4': 'ECDSA-SHA512',
};

// PACE / Chip-Auth OIDs all sit under 0.4.0.127.0.7.2.2.* (BSI TR-03110).
// We classify the family rather than spelling out every variant.
const dg14ProtocolFamily = (oid: string): string => {
  if (oid.startsWith('0.4.0.127.0.7.2.2.4')) return 'PACE';
  if (oid.startsWith('0.4.0.127.0.7.2.2.3')) return 'CA';
  if (oid.startsWith('0.4.0.127.0.7.2.2.2')) return 'TA';
  if (oid.startsWith('0.4.0.127.0.7.2.2.1')) return 'PACEInfo';
  return oid;
};

// ---- per-DG parsers (each returns null on any failure) ------------------

type ParsedMrz = {
  docType: string | null;
  issuingCountry: string | null;
  lastName: string | null;
  firstName: string | null;
  docNumber: string | null;
  nationality: string | null;
  dob: string | null;
  gender: string | null;
  expiry: string | null;
};

const parseMrzFromDg1 = (dg1: Uint8Array): ParsedMrz | null => {
  try {
    const raw = DG1.load(dg1);
    if (!raw || typeof raw !== 'string') return null;
    // tsemrtd hands back the MRZ as a single string with line-feeds stripped.
    // The `mrz` library wants an array of lines: 2 lines (TD3 passport) or 3
    // lines (TD1 ID card). Split by length: 88 chars = TD3 (44+44), 90 chars
    // = TD1 (30+30+30). Fall back to a single-line probe if neither fits.
    let lines: string[];
    if (raw.length === 88) lines = [raw.slice(0, 44), raw.slice(44, 88)];
    else if (raw.length === 90) lines = [raw.slice(0, 30), raw.slice(30, 60), raw.slice(60, 90)];
    else lines = [raw];
    const r = parseMrzLib(lines, { autocorrect: true });
    const f = r.fields as Record<string, unknown>;
    const isPassport = (f.documentCode as string)?.startsWith('P');
    return {
      docType: isPassport ? 'Passport' : 'ID',
      issuingCountry: (f.issuingState as string) ?? null,
      lastName: (f.lastName as string) ?? null,
      firstName: (f.firstName as string) ?? null,
      docNumber: (f.documentNumber as string) ?? null,
      nationality: (f.nationality as string) ?? null,
      dob: (f.birthDate as string) ?? null,
      gender: (f.sex as string) ?? null,
      expiry: (f.expirationDate as string) ?? null,
    };
  } catch {
    return null;
  }
};

type Dg11Parsed = { placeOfBirth: string | null; personalNumber: string | null };
const parseDg11 = (dg11: Uint8Array | undefined): Dg11Parsed | null => {
  if (!dg11 || !dg11.length) return null;
  try {
    const d = DG11.load(dg11);
    return {
      placeOfBirth: d.placeOfBirth?.length ? d.placeOfBirth.join(' ') : null,
      personalNumber: d.personalNumber || null,
    };
  } catch {
    return null;
  }
};

type Dg12Parsed = { issuingAuthority: string | null; dateOfIssue: string | null };
const parseDg12 = (dg12: Uint8Array | undefined): Dg12Parsed | null => {
  if (!dg12 || !dg12.length) return null;
  try {
    const d = DG12.load(dg12);
    return {
      issuingAuthority: d.issuingAuthority || null,
      // dateOfIssue is a numeric YYYYMMDD; coerce to string for the dump.
      dateOfIssue: d.dateOfIssue != null ? String(d.dateOfIssue) : null,
    };
  } catch {
    return null;
  }
};

type SodDerived = {
  sodDgHashList: number[];
  sodHashAlgo: string | null;
  sodDscSigAlgo: string | null;
};
const parseSodDerived = (sodBytes: Uint8Array): SodDerived | null => {
  try {
    const sod = new Sod(sodBytes);
    const hashList = sod.ldsObject.hashes.map(h => h.number).sort((a, b) => a - b);
    const hashOid = sod.ldsObject.algorithm.algorithm;
    // signerInfos is an AsnArray; first element carries the digest+sig algos.
    // peculiar's CMS shape exposes `signatureAlgorithm.algorithm` as the OID
    // string but the .d.ts doesn't always surface it cleanly — cast through
    // `any` rather than suppress per-field to keep one annotation in scope.
    const signer = sod.signatures[0] as any;
    const sigOid = signer?.signatureAlgorithm?.algorithm as string | undefined;
    return {
      sodDgHashList: hashList,
      sodHashAlgo: HASH_OIDS[hashOid] ?? hashOid ?? null,
      sodDscSigAlgo: sigOid ? (SIG_OIDS[sigOid] ?? sigOid) : null,
    };
  } catch {
    return null;
  }
};

const parseDg14Protocols = (dg14: Uint8Array | undefined): string | null => {
  if (!dg14 || !dg14.length) return null;
  try {
    const infos = DG14.load(dg14);
    const families = new Set<string>();
    for (const info of infos as Array<{ protocol?: string }>) {
      if (info?.protocol) families.add(dg14ProtocolFamily(info.protocol));
    }
    if (!families.size) return null;
    // Match the example shape: a single label, not an array. Prefer PACE.
    if (families.has('PACE')) return 'PACE';
    return Array.from(families).join('+');
  } catch {
    return null;
  }
};

type Dg15Info = { algo: string | null; keyBits: number | null };
const parseDg15Info = (dg15Bytes: Uint8Array | undefined): Dg15Info | null => {
  if (!dg15Bytes?.length) return null;
  try {
    // DG15.load returns a parsed SubjectPublicKeyInfo. The OID tells us
    // RSA vs ECDSA; for RSA we further decode the modulus to count bits.
    // For ECDSA we leave keyBits null — extracting the named curve needs
    // the EC parameters dance EPassport does in `getAAPublicKey`, which is
    // overkill for a dev-only dump.
    const spki = DG15.load(dg15Bytes);
    const oid = spki.algorithm.algorithm;
    const isRsa = oid.includes('1.2.840.113549.1.1');
    const isEcdsa = oid.includes('1.2.840.10045');
    const algo = isRsa ? 'RSA' : isEcdsa ? 'ECDSA' : oid;
    let keyBits: number | null = null;
    if (isRsa) {
      try {
        const rsa = AsnConvert.parse(spki.subjectPublicKey, RSAPublicKey);
        // RSA modulus is a big-endian byte array; leading 0x00 byte is the
        // ASN.1 INTEGER sign padding for positives — strip it before bit
        // counting so 2048-bit moduli don't read as 2056.
        const mod = new Uint8Array(rsa.modulus);
        const start = mod[0] === 0 ? 1 : 0;
        keyBits = (mod.length - start) * 8;
      } catch {
        keyBits = null;
      }
    }
    return { algo, keyBits };
  } catch {
    return null;
  }
};

// ---- main entry point ---------------------------------------------------

export type PassportRichJson = {
  scannedAt: string;
  platform: string;
  strategy: { id: string; label: string };
  docCode: string;
  personDetails: PassportData['personDetails'];
  mrz: ParsedMrz | null;
  personalNumber: string | null;
  dgSizes: Record<string, number>;
  dgHex: Record<string, string | null>;
  dg11Parsed: Dg11Parsed | null;
  dg12Parsed: Dg12Parsed | null;
  derived: {
    sodDgHashList: number[] | null;
    sodDscSigAlgo: string | null;
    sodHashAlgo: string | null;
    dg14Protocols: string | null;
    dg15AaAlgo: string | null;
    dg15AaKeyBits: number | null;
    aaSigType: string | null;
  };
  photoBase64: string | null;
};

export const buildRichPassportJson = (data: PassportData): PassportRichJson => {
  const strategy =
    data.docCode === 'P'
      ? { id: 'mrz_bac', label: 'Scanner le passeport' }
      : { id: 'mrz_pace', label: "Scanner la carte d'identité" };

  const mrz = parseMrzFromDg1(data.dg1Bytes);
  const dg11 = parseDg11(data.dg11Bytes);
  const dg12 = parseDg12(data.dg12Bytes);
  const sod = parseSodDerived(data.sodBytes);
  const dg14 = parseDg14Protocols(data.dg14Bytes);
  const dg15 = parseDg15Info(data.dg15Bytes);

  return {
    scannedAt: new Date().toISOString(),
    platform: Platform.OS,
    strategy,
    docCode: data.docCode,
    personDetails: data.personDetails,
    mrz,
    personalNumber: dg11?.personalNumber ?? null,
    dgSizes: {
      dg1: data.dg1Bytes?.length ?? 0,
      dg11: data.dg11Bytes?.length ?? 0,
      dg12: data.dg12Bytes?.length ?? 0,
      dg14: data.dg14Bytes?.length ?? 0,
      dg15: data.dg15Bytes?.length ?? 0,
      sod: data.sodBytes?.length ?? 0,
      aaSignature: data.aaSignature?.length ?? 0,
    },
    dgHex: {
      dg1: data.dg1Bytes?.length ? toHex(data.dg1Bytes) : null,
      dg11: data.dg11Bytes?.length ? toHex(data.dg11Bytes) : null,
      dg12: data.dg12Bytes?.length ? toHex(data.dg12Bytes) : null,
      dg14: data.dg14Bytes?.length ? toHex(data.dg14Bytes) : null,
      dg15: data.dg15Bytes?.length ? toHex(data.dg15Bytes) : null,
      sod: data.sodBytes?.length ? toHex(data.sodBytes) : null,
      aaSignature: data.aaSignature?.length ? toHex(data.aaSignature) : null,
    },
    dg11Parsed: dg11,
    dg12Parsed: dg12,
    derived: {
      sodDgHashList: sod?.sodDgHashList ?? null,
      sodDscSigAlgo: sod?.sodDscSigAlgo ?? null,
      sodHashAlgo: sod?.sodHashAlgo ?? null,
      dg14Protocols: dg14,
      dg15AaAlgo: dg15?.algo ?? null,
      dg15AaKeyBits: dg15?.keyBits ?? null,
      // The example treats `aaSigType` as null when AA wasn't run, else a
      // descriptor string. Without a parser for the underlying sig OID
      // (which would require digging into the DSC), we emit a coarse flag.
      aaSigType: data.aaSignature?.length ? 'active_auth' : null,
    },
    photoBase64: data.personDetails?.passportImageRaw ?? null,
  };
};

export const serializeRichPassportJson = (data: PassportData): string =>
  JSON.stringify(buildRichPassportJson(data), null, 2);
