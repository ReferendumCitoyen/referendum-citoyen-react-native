/**
 * Step 6 milestone lines for error reports (item 11 F, approved by the project lead on
 * 21/09): the technical step name and the time since the reader was armed,
 * nothing else. The listener payloads are never read here, so no chip data,
 * CAN, native log or chip response can reach a line: the output is built
 * from a closed list of names and a number.
 *
 * Without these a report cannot tell "chip never detected" from "detected,
 * then stuck", which is the question every NFC timeout raises.
 */

export const MILESTONE_EVENTS = [
  'ScanStarted',
  'RequestPresentPassport',
  'AuthenticatingWithPassport',
  'ReadingDataGroupProgress',
  'SuccessfulRead',
  'ScanError',
] as const;

export type MilestoneName = (typeof MILESTONE_EVENTS)[number];

// Repeated for every data group or APDU round: only the first one says
// something about where a read got to.
const FIRST_ONLY: ReadonlySet<MilestoneName> = new Set<MilestoneName>([
  'AuthenticatingWithPassport',
  'ReadingDataGroupProgress',
]);

const KNOWN: ReadonlySet<string> = new Set<string>(MILESTONE_EVENTS);

export interface MilestoneLog {
  /** The reader is armed: times are counted from here. */
  begin(): void;
  /** The attempt settled: later events are not timed against it. */
  end(): void;
  /** The line to log for this event, or null when there is none. */
  line(name: MilestoneName): string | null;
}

export function createMilestoneLog(now: () => number = () => Date.now()): MilestoneLog {
  let startedAt: number | null = null;
  let seen = new Set<MilestoneName>();
  return {
    begin() {
      startedAt = now();
      seen = new Set();
    },
    end() {
      startedAt = null;
    },
    line(name) {
      if (startedAt === null || !KNOWN.has(name)) return null;
      if (FIRST_ONLY.has(name) && seen.has(name)) return null;
      seen.add(name);
      const ms = Math.max(0, Math.round(now() - startedAt));
      return `[Step6] event ${name} +${ms}ms`;
    },
  };
}
