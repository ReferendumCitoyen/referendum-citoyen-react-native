/**
 * What a registration and a vote actually sent, kept for the report.
 *
 * The session log says "pub_signals=23, proof JSON=1217 bytes" and nothing
 * more: the values themselves were never logged, and the redactor would have
 * masked them if they had been. That was right for a log — a nullifier
 * identifies a voter across proposals — and useless for the one reader who
 * needs the values: the circuit author, who has to see the query proof our
 * prover emits, selector and all, to tell a prover bug from a contract one.
 * Until now the only way to hand him one was to catch a phone in the act.
 *
 * So the last registration and the last vote are kept here, in memory, in
 * the shapes they were sent in, and the report attaches them as a JSON file
 * — deliberately NOT through the redactor. This is opt-in per report (a
 * button the tester taps), and the values are those of consenting test
 * volunteers voting on test proposals. The email body says exactly what the
 * attachment contains, and never claims it is anonymised, because it is not.
 *
 * Kept by the flow for one run: cleared when the voting flow starts over, so a
 * report never carries a previous session's vote by mistake.
 *
 * Beta builds only, and that is enforced HERE rather than at the report
 * (audit item C2). Until now the collection itself ran on every build, so a
 * store binary held a full proof, its public signals, the nullifier and the
 * calldata in memory at every vote, with a single line in error-reporter.ts
 * standing between that heap and the disk cache. Now recordVoteArtifact and
 * recordRegistrationArtifact return immediately outside a beta build: the
 * store app never holds these values at all, and the report guard becomes a
 * second lock rather than the only one.
 */
import { isBetaBuild } from '@/constants/app-flavour';

export type ArtifactDocument = 'passport' | 'idCard' | 'unknown';

export interface RegistrationArtifact {
  recordedAt: string;
  network: string;
  circuitName: string;
  /** keccak256("Z_NOIR_PASSPORT_<suffix>") — the key Registration2 dispatches on. */
  zkType: string;
  /** The five public signals of the heavy register circuit, in order. */
  pubSignals: string[];
  /** Named views of the same five signals, as the calldata builder reads them. */
  passportHash: string;
  dgCommit: string;
  identityKey: string;
  certificatesRoot: string;
  /** The UltraPlonk proof, hex without 0x. */
  proofHex: string;
}

export interface VoteArtifact {
  recordedAt: string;
  document: ArtifactDocument;
  proposalId: string;
  /** Decimal, as the contract compares it against the proof's own signal. */
  proposalEventId: string;
  /** The proposal's selector bitmask — which fields the proof reveals. */
  selector: string;
  /** The query_identity Groth16 proof, verbatim from the prover. */
  queryProof: {
    proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string };
    pub_signals: string[];
  };
  /** What went into the on-chain `vote(...)` call. */
  nullifier: string;
  registrationRoot: string;
  currentDate: string;
  effectiveCitizenship: string;
  citizenshipWhitelist: string[];
  destination: string;
  calldata: string;
}

export interface VoteArtifacts {
  registration?: RegistrationArtifact;
  vote?: VoteArtifact;
}

let current: VoteArtifacts = {};

export function recordRegistrationArtifact(a: Omit<RegistrationArtifact, 'recordedAt'>): void {
  if (!isBetaBuild()) return;
  current = { ...current, registration: { recordedAt: new Date().toISOString(), ...a } };
}

export function recordVoteArtifact(a: Omit<VoteArtifact, 'recordedAt'>): void {
  if (!isBetaBuild()) return;
  current = { ...current, vote: { recordedAt: new Date().toISOString(), ...a } };
}

export function snapshotArtifacts(): VoteArtifacts {
  return { ...current };
}

export function hasArtifacts(): boolean {
  return Boolean(current.registration || current.vote);
}

export function clearArtifacts(): void {
  current = {};
}

/** Which document the last vote was cast with, for the report subject. */
export function documentOfLastVote(): ArtifactDocument {
  return current.vote?.document ?? 'unknown';
}

/** DG1 length is the document's own answer: 93 bytes TD3, 95 bytes TD1. */
export function documentFromDg1Length(len: number): ArtifactDocument {
  if (len === 93) return 'passport';
  if (len === 95) return 'idCard';
  return 'unknown';
}

/**
 * The attachment. Pretty-printed so it reads in a mail client; bigints are
 * long gone by here (everything is recorded as strings), so plain JSON.
 */
export function formatArtifactsJson(artifacts: VoteArtifacts = current): string {
  return JSON.stringify(
    {
      note:
        'Unredacted. Query proof and public signals of a TEST vote by a consenting ' +
        'volunteer, for the circuit author. The nullifier identifies this ' +
        'key across proposals — do not forward.',
      ...artifacts,
    },
    null,
    2,
  );
}
