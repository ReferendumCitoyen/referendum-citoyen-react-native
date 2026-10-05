/**
 * Consecutive-read agreement for the camera MRZ scanner.
 *
 * Each MRZ field carries an ICAO check digit, but a read with one wrong digit
 * still passes its check digit about one time in ten. At two frames a second,
 * over the dozens of frames a scan produces, one such read eventually gets
 * through — a single valid frame was the acceptance rule on build 16, and it
 * sent a tester to the chip with a wrong document number three times. Two
 * identical reads in a row are what the pre-May consensus scanner amounted
 * to, without its 15-frame buffer.
 */

export const REQUIRED_CONSECUTIVE_READS = 2;

export interface MrzReadFields {
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
}

/** The three fields the chip is unlocked with, as one comparable string. */
export function mrzReadKey(fields: MrzReadFields): string {
  return `${fields.documentNumber}|${fields.dateOfBirth}|${fields.dateOfExpiry}`;
}

export class ConsecutiveReads {
  private last: string | null = null;
  private count = 0;

  constructor(private readonly required: number = REQUIRED_CONSECUTIVE_READS) {}

  /** Record one read. True once `required` identical reads arrived in a row. */
  record(key: string): boolean {
    if (key === this.last) {
      this.count += 1;
    } else {
      this.last = key;
      this.count = 1;
    }
    return this.count >= this.required;
  }

  reset(): void {
    this.last = null;
    this.count = 0;
  }
}
