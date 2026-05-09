import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Buffer } from "buffer";
import { AsnConvert } from "@peculiar/asn1-schema";
import { Certificate } from "@peculiar/asn1-x509";
import { ECParameters } from "@peculiar/asn1-ecc";
import { RSAPublicKey } from "@peculiar/asn1-rsa";
import { SOD } from "@li0ard/tsemrtd";
import * as asn1js from "asn1js";

import { useColors, Typography } from "@/constants/theme";
import { findCousinVariants, findPublishedVariant } from "./published-variants";

// Inline OID labels — kept here so the probe is fully self-contained and
// doesn't depend on internal SDK imports. Limited to OIDs we expect from
// passport SODs / DG15 SPKIs.
const OID_LABELS: Record<string, string> = {
  // Public-key algorithms
  "1.2.840.113549.1.1.1": "rsaEncryption",
  "1.2.840.113549.1.1.10": "rsassa-pss",
  "1.2.840.10045.2.1": "id-ecPublicKey",
  // Signature algorithms (SOD signerInfo / cert signatureAlgorithm)
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1",
  "1.2.840.10045.4.3.1": "ecdsa-with-SHA224",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
  // Hash algorithms (DG / encapsulated-content digest)
  "1.3.14.3.2.26": "SHA-1",
  "2.16.840.1.101.3.4.2.4": "SHA-224",
  "2.16.840.1.101.3.4.2.1": "SHA-256",
  "2.16.840.1.101.3.4.2.2": "SHA-384",
  "2.16.840.1.101.3.4.2.3": "SHA-512",
  // Named curves
  "1.3.132.0.7": "SECP160R1",
  "1.2.840.10045.3.1.1": "SECP192R1 / P-192",
  "1.3.132.0.33": "SECP224R1 / P-224",
  "1.2.840.10045.3.1.7": "SECP256R1 / P-256",
  "1.3.132.0.34": "SECP384R1 / P-384",
  "1.3.132.0.35": "SECP521R1 / P-521",
  "1.3.36.3.3.2.8.1.1.1": "BRAINPOOLP160R1",
  "1.3.36.3.3.2.8.1.1.3": "BRAINPOOLP192R1",
  "1.3.36.3.3.2.8.1.1.5": "BRAINPOOLP224R1",
  "1.3.36.3.3.2.8.1.1.7": "BRAINPOOLP256R1",
  "1.3.36.3.3.2.8.1.1.9": "BRAINPOOLP320R1",
  "1.3.36.3.3.2.8.1.1.11": "BRAINPOOLP384R1",
  "1.3.36.3.3.2.8.1.1.13": "BRAINPOOLP512R1",
};

function labelFor(oid: string | undefined | null): string {
  if (!oid) return "—";
  return OID_LABELS[oid] ? `${OID_LABELS[oid]}` : "(unknown)";
}

export interface CircuitSuiteProbeProps {
  dg1Bytes: Uint8Array;
  sodBytes: Uint8Array;
  dg15Bytes?: Uint8Array;
  aaSignature?: Uint8Array;
}

interface DscPubkeyInfo {
  algoOid: string;
  algoLabel: string;
  // ECDSA branch
  curveOid?: string;
  curveLabel?: string;
  specifiedCurve?: boolean;
  orderHexFirst16?: string;
  // RSA branch
  rsaModulusBits?: number;
  rsaExponent?: string; // decimal
  // Cert signature algorithm (RSA-PSS uses this for salt resolution)
  certSigAlgoOid?: string;
}

interface Dg15Info {
  present: boolean;
  algoOid?: string;
  algoLabel?: string;
  curveOid?: string;
  curveLabel?: string;
  rsaModulusBits?: number;
}

interface SuiteOutcome {
  resolved: boolean;
  name?: string;
  publishedVersion?: string | null; // null = no exact match; populated = match
  cousinCount?: number;             // # of variants sharing same sigId/hash/doc/aa
  errorMessage?: string;
}

// Fully parse a passport's SOD + DG15 into structured probe data. NEVER
// throws — every failure is captured as a field error so the panel still
// shows everything else.
function inspectPassport(props: CircuitSuiteProbeProps): {
  documentType: string;
  dg1Length: number;
  sodLength: number;
  sodSignatureOid?: string;
  sodSignatureLabel?: string;
  dgHashOid?: string;
  dgHashLabel?: string;
  dsc?: DscPubkeyInfo;
  dscError?: string;
  dg15: Dg15Info;
  aaSignatureBytes?: number;
  suite: SuiteOutcome;
} {
  const out: ReturnType<typeof inspectPassport> = {
    documentType:
      props.dg1Bytes.length === 95
        ? "TD1 (ID card)"
        : props.dg1Bytes.length === 93
        ? "TD3 (passport)"
        : `unknown (${props.dg1Bytes.length} bytes)`,
    dg1Length: props.dg1Bytes.length,
    sodLength: props.sodBytes.length,
    dg15: { present: !!props.dg15Bytes && props.dg15Bytes.length > 0 },
    aaSignatureBytes: props.aaSignature?.length,
    suite: { resolved: false },
  };

  // SOD signature OID + DG hash OID via tsemrtd's loader.
  try {
    const tsmrtdSod = SOD.load(Buffer.from(props.sodBytes));
    out.dgHashOid = tsmrtdSod.ldsObject?.algorithm?.algorithm;
    out.dgHashLabel = labelFor(out.dgHashOid);
    out.sodSignatureOid = tsmrtdSod.signatures?.[0]?.signatureAlgorithm?.algorithm;
    out.sodSignatureLabel = labelFor(out.sodSignatureOid);

    // Slave cert pubkey inspection (independent of suite resolution success).
    try {
      const slaveChoice = tsmrtdSod.certificates?.find((c) => c.certificate);
      const cert = slaveChoice?.certificate;
      if (!cert) {
        out.dscError = "SOD has no slave certificate";
      } else {
        out.dsc = inspectDscCert(cert);
      }
    } catch (e: any) {
      out.dscError = `cert inspection failed: ${e?.message ?? String(e)}`;
    }
  } catch (e: any) {
    out.dscError = `SOD parse failed: ${e?.message ?? String(e)}`;
  }

  // DG15 SPKI
  if (props.dg15Bytes && props.dg15Bytes.length > 0) {
    try {
      out.dg15 = { present: true, ...inspectDg15Spki(props.dg15Bytes) };
    } catch (e: any) {
      out.dg15 = { present: true, algoLabel: `parse failed: ${e?.message}` };
    }
  }

  // Suite resolution via the SDK we already shipped. Capture either the
  // resolved name or the thrown error verbatim.
  try {
    // Lazy require so the probe doesn't crash the diagnostic panel if the
    // SDK isn't available in some test/host context.
    const { RarimePassport } = require("@rarimo/rarime-rn-sdk");
    const passport = new RarimePassport({
      dataGroup1: props.dg1Bytes,
      sod: props.sodBytes,
      dataGroup15: props.dg15Bytes,
      aaSignature: props.aaSignature,
    });
    const result = passport.extractCircuitSuite();
    out.suite.resolved = true;
    out.suite.name = result.name;
    const matched = findPublishedVariant(result.name);
    out.suite.publishedVersion = matched ? matched.version : null;
    out.suite.cousinCount = findCousinVariants(result.name).length;
  } catch (e: any) {
    out.suite.resolved = false;
    out.suite.errorMessage = e?.message ?? String(e);
  }

  return out;
}

// Inspect a slave (DSC) certificate and return its public-key fingerprint.
// Doesn't throw — falls back to "unknown" fields when something exotic is
// encoded so the user can still see what was extracted.
function inspectDscCert(cert: Certificate): DscPubkeyInfo {
  const algoOid = cert.tbsCertificate.subjectPublicKeyInfo.algorithm.algorithm;
  const sigOid = cert.signatureAlgorithm.algorithm;
  const info: DscPubkeyInfo = {
    algoOid,
    algoLabel: labelFor(algoOid),
    certSigAlgoOid: sigOid,
  };

  if (algoOid === "1.2.840.113549.1.1.1") {
    // RSA — extract modulus + exponent
    try {
      const rsaPub = AsnConvert.parse(
        cert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey,
        RSAPublicKey,
      );
      const modBytes = new Uint8Array(rsaPub.modulus);
      const stripped = modBytes[0] === 0x00 ? modBytes.subarray(1) : modBytes;
      info.rsaModulusBits = stripped.length * 8;
      info.rsaExponent = BigInt(
        "0x" + Buffer.from(rsaPub.publicExponent).toString("hex"),
      ).toString(10);
    } catch {
      // leave the fields unset
    }
    return info;
  }

  if (algoOid === "1.2.840.10045.2.1") {
    // ECDSA — try namedCurve, fall back to specifiedCurve fingerprint
    if (!cert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters) {
      info.specifiedCurve = false;
      return info;
    }
    try {
      const ec = AsnConvert.parse(
        cert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters,
        ECParameters,
      );
      if (ec.namedCurve) {
        info.curveOid = ec.namedCurve;
        info.curveLabel = labelFor(ec.namedCurve);
      } else if (ec.specifiedCurve) {
        info.specifiedCurve = true;
        // First 16 bytes of `order` — a stable per-curve fingerprint.
        const orderBytes = new Uint8Array(ec.specifiedCurve.order);
        info.orderHexFirst16 = Array.from(orderBytes.slice(0, 16))
          .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
          .join("");
      }
    } catch {
      // best-effort: leave fields blank
    }
    return info;
  }

  return info;
}

// Pull the AlgorithmIdentifier + named curve OID out of a DG15 SPKI without
// going through the SDK's parseDg15Pubkey (which is private).
function inspectDg15Spki(dg15Bytes: Uint8Array): Omit<Dg15Info, "present"> {
  // DG15 wraps a SubjectPublicKeyInfo inside a tag-67 (0x6F) container.
  // The `@li0ard/tsemrtd/dg15` loader unwraps that for us.
  // For self-containment: parse the outer container manually with asn1js.
  // Slice into a fresh ArrayBuffer (not SharedArrayBuffer) so AsnConvert/asn1js
  // BufferSource typing is satisfied across RN's Buffer + TypedArray overlap.
  const sliced = dg15Bytes.buffer.slice(
    dg15Bytes.byteOffset,
    dg15Bytes.byteOffset + dg15Bytes.byteLength,
  );
  const fullBuf: ArrayBuffer = sliced as ArrayBuffer;
  const result = asn1js.fromBER(fullBuf);
  if (result.offset === -1) return { algoLabel: "DG15 BER parse failed" };

  // The outer is an [APPLICATION 15] container; inside it, an SPKI SEQUENCE.
  // Walk the tree to find the AlgorithmIdentifier.
  const container = result.result as any;
  const inner = container.valueBlock?.value?.[0];
  if (!inner) return { algoLabel: "DG15 has no inner SPKI" };

  const spkiSeq = inner;
  const algoSeq = spkiSeq.valueBlock?.value?.[0];
  if (!algoSeq) return { algoLabel: "DG15 SPKI has no AlgorithmIdentifier" };
  const algoOidNode = algoSeq.valueBlock?.value?.[0];
  if (!algoOidNode) return { algoLabel: "DG15 has no algorithm OID" };
  const algoOid = (algoOidNode as asn1js.ObjectIdentifier).valueBlock.toString();

  const out: Omit<Dg15Info, "present"> = {
    algoOid,
    algoLabel: labelFor(algoOid),
  };

  // For ECDSA, the namedCurve OID lives in the AlgorithmIdentifier.parameters slot.
  if (algoOid === "1.2.840.10045.2.1") {
    const paramsNode = algoSeq.valueBlock?.value?.[1];
    if (paramsNode instanceof asn1js.ObjectIdentifier) {
      out.curveOid = paramsNode.valueBlock.toString();
      out.curveLabel = labelFor(out.curveOid);
    }
  }

  // For RSA, parse the BIT STRING content as RSAPublicKey to get modulus length.
  if (algoOid === "1.2.840.113549.1.1.1") {
    try {
      const bitString = spkiSeq.valueBlock.value[1] as asn1js.BitString;
      const rsa = AsnConvert.parse(bitString.valueBlock.valueHex, RSAPublicKey);
      const modBytes = new Uint8Array(rsa.modulus);
      const stripped = modBytes[0] === 0x00 ? modBytes.subarray(1) : modBytes;
      out.rsaModulusBits = stripped.length * 8;
    } catch {
      // leave blank
    }
  }

  return out;
}

export const CircuitSuiteProbe: React.FC<CircuitSuiteProbeProps> = (props) => {
  const colors = useColors();
  const styles = createStyles(colors);

  const data = useMemo(() => inspectPassport(props), [props.dg1Bytes, props.sodBytes, props.dg15Bytes, props.aaSignature]);

  const suiteColor = data.suite.resolved
    ? data.suite.publishedVersion
      ? "#10B981" // green: resolved + published
      : "#F59E0B" // amber: resolved but not in published list
    : "#EF4444";  // red: failed to resolve

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Circuit suite probe</Text>

      <Row label="Document type" value={data.documentType} />
      <Row label="DG1 length" value={`${data.dg1Length} bytes`} />
      <Row label="SOD length" value={`${data.sodLength} bytes`} />

      {data.sodSignatureOid && (
        <Row
          label="SOD signature"
          value={`${data.sodSignatureLabel}`}
          mono={data.sodSignatureOid}
        />
      )}
      {data.dgHashOid && (
        <Row label="DG hash algorithm" value={`${data.dgHashLabel}`} mono={data.dgHashOid} />
      )}

      {/* DSC public key */}
      <Text style={styles.sectionLabel}>DSC (slave) certificate</Text>
      {data.dscError && <Text style={styles.errorRow}>✗ {data.dscError}</Text>}
      {data.dsc && (
        <>
          <Row label="Algorithm" value={`${data.dsc.algoLabel}`} mono={data.dsc.algoOid} />
          {data.dsc.certSigAlgoOid && (
            <Row
              label="Cert signed with"
              value={`${labelFor(data.dsc.certSigAlgoOid)}`}
              mono={data.dsc.certSigAlgoOid}
            />
          )}
          {data.dsc.algoOid === "1.2.840.10045.2.1" && (
            <>
              {data.dsc.curveOid ? (
                <Row label="Named curve" value={`${data.dsc.curveLabel}`} mono={data.dsc.curveOid} />
              ) : data.dsc.specifiedCurve ? (
                <Row
                  label="Curve encoding"
                  value="⚠ specifiedCurve (no namedCurve OID)"
                  mono={`order(first16): ${data.dsc.orderHexFirst16}`}
                />
              ) : (
                <Row label="Curve" value="(no parameters in SPKI)" />
              )}
            </>
          )}
          {data.dsc.algoOid === "1.2.840.113549.1.1.1" && (
            <>
              {data.dsc.rsaModulusBits && (
                <Row label="RSA modulus" value={`${data.dsc.rsaModulusBits} bits`} />
              )}
              {data.dsc.rsaExponent && (
                <Row label="RSA exponent" value={data.dsc.rsaExponent} />
              )}
            </>
          )}
        </>
      )}

      {/* DG15 / Active Authentication */}
      <Text style={styles.sectionLabel}>Active Authentication (DG15)</Text>
      {!data.dg15.present && (
        <Row label="Status" value="— not present (no Active Authentication)" />
      )}
      {data.dg15.present && (
        <>
          <Row
            label="AA pubkey algorithm"
            value={data.dg15.algoLabel ?? "?"}
            mono={data.dg15.algoOid}
          />
          {data.dg15.curveOid && (
            <Row
              label="AA curve"
              value={data.dg15.curveLabel ?? "?"}
              mono={data.dg15.curveOid}
            />
          )}
          {data.dg15.rsaModulusBits && (
            <Row label="AA RSA modulus" value={`${data.dg15.rsaModulusBits} bits`} />
          )}
          {data.aaSignatureBytes != null && (
            <Row label="AA signature" value={`${data.aaSignatureBytes} bytes`} />
          )}
        </>
      )}

      {/* Suite resolution */}
      <Text style={styles.sectionLabel}>Heavy-register circuit suite</Text>
      {data.suite.resolved ? (
        <>
          <Text selectable style={[styles.suiteName, { color: suiteColor }]}>
            {data.suite.name}
          </Text>
          {data.suite.publishedVersion ? (
            <Text style={styles.suiteOk}>
              ✓ Published variant — Rarimo hosts this circuit at{" "}
              {data.suite.publishedVersion}
            </Text>
          ) : (
            <>
              <Text style={styles.suiteWarn}>
                ⚠ Suite resolves but no exact published variant. Rarimo doesn't
                have a deployed verifier for this exact ec/dg1/aa position
                combination on Q-testnet.
              </Text>
              {(data.suite.cousinCount ?? 0) > 0 && (
                <Text style={styles.suiteHint}>
                  {data.suite.cousinCount} sibling variant(s) exist for the
                  same signature/hash/doc family.
                </Text>
              )}
            </>
          )}
        </>
      ) : (
        <Text selectable style={styles.suiteError}>
          ✗ Cannot resolve suite{"\n"}
          {data.suite.errorMessage}
        </Text>
      )}
    </View>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: string }> = ({
  label,
  value,
  mono,
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueColumn}>
        <Text selectable style={styles.rowValue}>
          {value}
        </Text>
        {mono && (
          <Text selectable style={styles.rowMono}>
            {mono}
          </Text>
        )}
      </View>
    </View>
  );
};

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    panel: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.cardBackground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    panelTitle: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 14,
      color: colors.text,
      marginBottom: 8,
    },
    sectionLabel: {
      fontFamily: Typography.fontFamily.semibold,
      fontSize: 12,
      color: colors.textSecondary ?? colors.text,
      marginTop: 12,
      marginBottom: 4,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    row: {
      flexDirection: "row",
      paddingVertical: 4,
      gap: 12,
    },
    rowLabel: {
      flex: 0,
      width: 130,
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: colors.textSecondary ?? colors.text,
    },
    rowValueColumn: {
      flex: 1,
    },
    rowValue: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 13,
      color: colors.text,
    },
    rowMono: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 11,
      color: colors.textSecondary ?? colors.text,
      opacity: 0.7,
      marginTop: 2,
    },
    errorRow: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: "#EF4444",
      paddingVertical: 4,
    },
    suiteName: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 12,
      marginTop: 4,
      marginBottom: 6,
    },
    suiteOk: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: "#10B981",
    },
    suiteWarn: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 12,
      color: "#F59E0B",
    },
    suiteHint: {
      fontFamily: Typography.fontFamily.medium,
      fontSize: 11,
      color: colors.textSecondary ?? colors.text,
      marginTop: 4,
      opacity: 0.7,
    },
    suiteError: {
      fontFamily: Typography.fontFamily.mono,
      fontSize: 11,
      color: "#EF4444",
      lineHeight: 16,
    },
  });
