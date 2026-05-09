// Published Rarimo Noir registerIdentity_<suite>.json artefacts.
// Source: rarimo/rarime-ios-app/Rarime/Code/Constants/CircuitData.swift
// (NOIR_CIRCUIT_DATA_URLS table). Update by hand when Rarimo publishes new
// variants. Used by the Diagnostic Passeport circuit-suite probe to tell
// the user whether their passport's resolved suite has a hosted circuit
// (and therefore a deployed on-chain verifier on Q-testnet).
//
// Total: 71 variants spanning v0.1.3 ... v0.1.38 + v1.0.4.
// Last refreshed: 2026-05-09.

export interface PublishedVariant {
  name: string;
  version: string; // e.g. "v0.1.18", "v1.0.4"
}

export const PUBLISHED_VARIANTS: readonly PublishedVariant[] = [
  { name: "registerIdentity_1_160_3_3_576_200_NA", version: "v0.1.23" },
  { name: "registerIdentity_1_256_3_3_576_248_NA", version: "v0.1.23" },
  { name: "registerIdentity_1_256_3_4_336_232_1_1480_4_256", version: "v0.1.36" },
  { name: "registerIdentity_1_256_3_4_336_232_1_1480_5_296", version: "v0.1.23" },
  { name: "registerIdentity_1_256_3_4_336_232_NA", version: "v0.1.14" },
  { name: "registerIdentity_1_256_3_4_336_248_1_1496_4_256", version: "v0.1.31" },
  { name: "registerIdentity_1_256_3_4_336_248_1_560_4_256", version: "v0.1.37" },
  { name: "registerIdentity_1_256_3_4_576_232_1_1480_3_256", version: "v0.1.12-fix" },
  { name: "registerIdentity_1_256_3_4_600_248_1_1496_3_256", version: "v1.0.4" },
  { name: "registerIdentity_1_256_3_5_336_232_NA", version: "v0.1.33" },
  { name: "registerIdentity_1_256_3_5_336_248_1_2120_3_256", version: "v0.1.18" },
  { name: "registerIdentity_1_256_3_5_336_248_1_2120_4_256", version: "v0.1.7-fix" },
  { name: "registerIdentity_1_256_3_5_344_232_NA", version: "v0.1.32" },
  { name: "registerIdentity_1_256_3_5_576_248_NA", version: "v0.1.9-fix" },
  { name: "registerIdentity_1_256_3_6_336_248_1_2432_3_256", version: "v0.1.30" },
  { name: "registerIdentity_1_256_3_6_336_248_1_2744_4_256", version: "v0.1.24" },
  { name: "registerIdentity_1_256_3_6_576_248_1_2432_5_296", version: "v0.1.22" },
  { name: "registerIdentity_1_256_3_6_576_264_1_2448_3_256", version: "v0.1.9-fix" },
  { name: "registerIdentity_1_256_3_7_336_264_20_2760_6_2008", version: "v0.1.34" },
  { name: "registerIdentity_10_256_3_3_576_248_1_1184_5_264", version: "v1.0.4" },
  { name: "registerIdentity_11_256_3_2_336_216_NA", version: "v0.1.25" },
  { name: "registerIdentity_11_256_3_3_336_248_NA", version: "v0.1.25" },
  { name: "registerIdentity_11_256_3_3_576_240_1_864_5_264", version: "v0.1.26" },
  { name: "registerIdentity_11_256_3_3_576_248_1_1184_5_264", version: "v0.1.26" },
  { name: "registerIdentity_11_256_3_3_576_248_NA", version: "v0.1.10-fix" },
  { name: "registerIdentity_11_256_3_4_336_232_1_1480_4_256", version: "v0.1.6-fix" },
  { name: "registerIdentity_11_256_3_4_576_248_1_1496_5_296", version: "v0.1.31" },
  { name: "registerIdentity_11_256_3_4_584_248_1_1496_4_256", version: "v0.1.26" },
  { name: "registerIdentity_11_256_3_5_576_248_1_1808_4_256", version: "v0.1.29" },
  { name: "registerIdentity_11_256_3_5_576_248_1_1808_5_296", version: "v0.1.27" },
  { name: "registerIdentity_11_256_3_5_576_248_NA", version: "v0.1.12-fix" },
  { name: "registerIdentity_11_256_3_5_576_264_NA", version: "v0.1.13" },
  { name: "registerIdentity_11_256_3_5_584_264_1_2136_4_256", version: "v0.1.13" },
  { name: "registerIdentity_12_256_3_3_336_232_NA", version: "v0.1.27" },
  { name: "registerIdentity_14_256_3_3_576_240_NA", version: "v0.1.8-fix" },
  { name: "registerIdentity_14_256_3_4_336_232_1_1480_5_296", version: "v0.1.12-fix" },
  { name: "registerIdentity_14_256_3_4_576_248_1_1496_3_256", version: "v0.1.8-fix" },
  { name: "registerIdentity_15_512_3_3_336_248_NA", version: "v0.1.27" },
  { name: "registerIdentity_2_256_3_4_336_232_1_1480_4_256", version: "v0.1.7-fix" },
  { name: "registerIdentity_2_256_3_4_336_248_22_1496_7_2408", version: "v0.1.14" },
  { name: "registerIdentity_2_256_3_4_336_248_NA", version: "v0.1.7-fix" },
  { name: "registerIdentity_2_256_3_5_336_248_22_1808_7_2408", version: "v0.1.30" },
  { name: "registerIdentity_2_256_3_6_336_248_1_2432_3_256", version: "v0.1.3" },
  { name: "registerIdentity_2_256_3_6_336_264_1_2448_3_256", version: "v0.1.24" },
  { name: "registerIdentity_2_256_3_6_336_264_21_2448_6_2008", version: "v0.1.3" },
  { name: "registerIdentity_2_256_3_6_576_248_1_2432_3_256", version: "v0.1.6-fix" },
  { name: "registerIdentity_20_160_3_2_576_184_NA", version: "v0.1.8-fix" },
  { name: "registerIdentity_20_160_3_3_576_200_NA", version: "v0.1.9-fix" },
  { name: "registerIdentity_20_256_3_3_336_224_NA", version: "v0.1.3" },
  { name: "registerIdentity_20_256_3_5_336_248_NA", version: "v0.1.11-fix" },
  { name: "registerIdentity_21_256_3_3_336_232_NA", version: "v0.1.28" },
  { name: "registerIdentity_21_256_3_3_576_232_NA", version: "v1.0.4" },
  { name: "registerIdentity_21_256_3_4_576_232_NA", version: "v0.1.5-fix" },
  { name: "registerIdentity_21_256_3_5_576_232_NA", version: "v0.1.28" },
  { name: "registerIdentity_21_256_3_7_336_264_21_3072_6_2008", version: "v0.1.32" },
  { name: "registerIdentity_23_160_3_3_576_200_NA", version: "v0.1.10-fix" },
  { name: "registerIdentity_24_256_3_4_336_232_NA", version: "v0.1.28" },
  { name: "registerIdentity_24_256_3_4_336_248_NA", version: "v0.1.11-fix" },
  { name: "registerIdentity_25_384_3_3_336_248_NA", version: "v0.1.22" },
  { name: "registerIdentity_25_384_3_3_336_264_1_2024_3_296", version: "v0.1.21" },
  { name: "registerIdentity_25_384_3_5_576_248_20_3768_3_2008", version: "v0.1.30" },
  { name: "registerIdentity_26_512_3_2_336_248_1_1384_2_256", version: "v0.1.38" },
  { name: "registerIdentity_28_384_3_3_576_264_24_2024_4_2792", version: "v0.1.22" },
  { name: "registerIdentity_3_160_3_3_336_200_NA", version: "v0.1.24" },
  { name: "registerIdentity_3_160_3_4_576_216_1_1512_3_256", version: "v0.1.25" },
  { name: "registerIdentity_3_256_3_3_576_248_NA", version: "v0.1.20" },
  { name: "registerIdentity_3_256_3_4_600_248_1_1496_3_256", version: "v0.1.10-fix" },
  { name: "registerIdentity_3_512_3_3_336_264_NA", version: "v0.1.6-fix" },
  { name: "registerIdentity_6_160_3_3_336_216_1_1080_3_256", version: "v0.1.11-fix" },
  { name: "registerIdentity_7_160_3_3_336_216_1_1080_3_256", version: "v0.1.18" },
  { name: "registerIdentity_8_160_3_3_336_216_1_1080_3_256", version: "v0.1.19" },
];

// Index for fast lookup by exact name.
const PUBLISHED_BY_NAME = new Map(
  PUBLISHED_VARIANTS.map((v) => [v.name, v]),
);

export function findPublishedVariant(name: string): PublishedVariant | null {
  return PUBLISHED_BY_NAME.get(name) ?? null;
}

// Variants that share the same signatureTypeId / hash / docType / aaType
// prefix. Useful when the resolved suite name doesn't match exactly but a
// "cousin" variant exists for the same algorithm — tells the user "Rarimo
// has circuits for this signature suite, just not this exact ec/dg1
// position combination, so it might be reachable with re-positioning."
export function findCousinVariants(name: string): PublishedVariant[] {
  // suite names look like:
  //   registerIdentity_<sigId>_<hashBits>_<docId>_<ec>_<ecPos>_<dg1Pos>_<aaTail>
  // Take the first 4 numeric fields as the prefix family.
  const parts = name.split("_");
  if (parts.length < 5) return [];
  const prefix = parts.slice(0, 4).join("_");
  return PUBLISHED_VARIANTS.filter(
    (v) => v.name.startsWith(prefix + "_") && v.name !== name,
  );
}
