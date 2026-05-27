// Dev-mode fixture loader. Reads example-passport.json from the repo root
// (gitignored — see .gitignore) and exposes two shapes:
//
//   loadDevExampleMrz()           → Step 5 "skip OCR" button
//   loadDevExamplePassportData()  → Step 6 "skip NFC" button (returns the
//                                   same PassportData the eDocument module
//                                   would produce on a successful scan)
//
// The require() is wrapped in try/catch so a missing fixture (clean CI
// checkout) returns null and the gated UI hides itself — mirrors the
// lazyUnzip pattern in modules/witnesscalculator/index.ts.

import type { PassportData } from '@/modules/e-document';

// Same JSON shape the dev-only passport-dump path in app/voting-flow.tsx
// writes to documentDirectory + the inid passport-debug spike repo also
// emits — kept loose because we read it forgivingly.
interface ExamplePassportFile {
  docCode?: string;
  personDetails?: {
    firstName?: string | null;
    lastName?: string | null;
    gender?: string | null;
    birthDate?: string | null;
    expiryDate?: string | null;
    documentNumber?: string | null;
    nationality?: string | null;
    issuingAuthority?: string | null;
  };
  dgHex?: {
    dg1?: string | null;
    dg11?: string | null;
    dg12?: string | null;
    dg14?: string | null;
    dg15?: string | null;
    sod?: string | null;
    aaSignature?: string | null;
  };
}

function loadRaw(): ExamplePassportFile | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-unresolved
    return require('@/example-passport.json') as ExamplePassportFile;
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return out;
}

export function loadDevExampleMrz(): {
  documentNumber: string;
  birthDate: string;
  expiryDate: string;
} | null {
  const ep = loadRaw();
  const pd = ep?.personDetails;
  if (!pd?.documentNumber || !pd?.birthDate || !pd?.expiryDate) return null;
  return {
    documentNumber: String(pd.documentNumber),
    birthDate: String(pd.birthDate),
    expiryDate: String(pd.expiryDate),
  };
}

export function loadDevExamplePassportData(): PassportData | null {
  const ep = loadRaw();
  const pd = ep?.personDetails;
  const hex = ep?.dgHex;
  // dg1 + sod are the minimum needed for Step 7's verify + Step 11's vote
  // calldata. Bail if either is missing.
  if (!hex?.dg1 || !hex?.sod || !pd) return null;

  return {
    docCode: ep?.docCode ?? 'P',
    personDetails: {
      firstName: pd.firstName ?? null,
      lastName: pd.lastName ?? null,
      gender: pd.gender ?? null,
      birthDate: pd.birthDate ?? null,
      expiryDate: pd.expiryDate ?? null,
      documentNumber: pd.documentNumber ?? null,
      nationality: pd.nationality ?? null,
      issuingAuthority: pd.issuingAuthority ?? null,
      passportImageRaw: null,
    },
    dg1Bytes: hexToBytes(hex.dg1),
    sodBytes: hexToBytes(hex.sod),
    dg11Bytes: hex.dg11 ? hexToBytes(hex.dg11) : undefined,
    dg12Bytes: hex.dg12 ? hexToBytes(hex.dg12) : undefined,
    dg14Bytes: hex.dg14 ? hexToBytes(hex.dg14) : undefined,
    dg15Bytes: hex.dg15 ? hexToBytes(hex.dg15) : undefined,
    aaSignature: hex.aaSignature ? hexToBytes(hex.aaSignature) : undefined,
  };
}
