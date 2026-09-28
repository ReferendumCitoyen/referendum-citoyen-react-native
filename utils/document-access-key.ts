/**
 * How Step 6 unlocks the chip.
 *
 * A passport is opened with the MRZ key (document number, birth date, expiry
 * — typed, or read by the camera and confirmed). A French ID card is opened
 * with its CAN, the six digits printed on the card, through PACE with the
 * CAN password reference: no MRZ, no camera (project decision, 2026-09-09).
 */
export type DocumentAccessKey =
  | { kind: 'mrz'; documentNumber: string; birthDate: string; expiryDate: string }
  | { kind: 'can'; can: string };

export const CAN_LENGTH = 6;

/** Only digits, exactly six. Nothing is stripped here: what was typed is what is checked. */
export function isValidCan(can: string): boolean {
  return /^[0-9]{6}$/.test(can);
}

/** What the CAN field stores as the user types: digits only, six at most. */
export function sanitizeCanInput(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(0, CAN_LENGTH);
}

/**
 * The `bacKeyParameters` the e-document module takes. For a CAN the MRZ
 * fields are left out: the module substitutes placeholders, and both native
 * readers then run PACE with the CAN (password reference 0x02) instead of
 * deriving a key from the MRZ.
 */
export function toScanParameters(key: DocumentAccessKey): {
  documentNumber?: string;
  dateOfBirth?: string;
  dateOfExpiry?: string;
  can?: string;
} {
  return key.kind === 'can'
    ? { can: key.can }
    : { documentNumber: key.documentNumber, dateOfBirth: key.birthDate, dateOfExpiry: key.expiryDate };
}

/** For logs. The kind only — the values are the chip's access credentials. */
export function describeAccessKey(key: DocumentAccessKey | null | undefined): string {
  return key ? key.kind : 'none';
}
