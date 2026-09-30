import {
  clearArtifacts,
  documentFromDg1Length,
  documentOfLastVote,
  formatArtifactsJson,
  hasArtifacts,
  recordRegistrationArtifact,
  recordVoteArtifact,
  snapshotArtifacts,
} from '@/utils/vote-artifacts';

// The collection is beta-only (C2), so every test below has to say which
// binary it is running on. Default: the beta app.
jest.mock('expo-application', () => ({ applicationId: 'app.referendumcitoyen.fr.beta' }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Application = require('expo-application') as { applicationId: string };
const asStoreBuild = () => { Application.applicationId = 'app.referendumcitoyen.fr'; };
const asBetaBuild = () => { Application.applicationId = 'app.referendumcitoyen.fr.beta'; };

const registration = {
  network: 'mainnet',
  circuitName: 'registerIdentity_1_256_3_5_576_248_NA',
  zkType: '0x' + 'c2'.repeat(32),
  pubSignals: ['1', '2', '3', '4', '5'],
  passportHash: '0x' + '02'.repeat(32),
  dgCommit: '3',
  identityKey: '4',
  certificatesRoot: '0x' + '05'.repeat(32),
  proofHex: 'ab'.repeat(2144),
};

const vote = {
  document: 'passport' as const,
  proposalId: '61',
  proposalEventId: '1234',
  selector: '39457',
  queryProof: {
    proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['5', '6', '1'], protocol: 'groth16' },
    pub_signals: Array.from({ length: 23 }, (_, i) => String(i)),
  },
  nullifier: '0x' + 'aa'.repeat(32),
  registrationRoot: '0x' + 'bb'.repeat(32),
  currentDate: '0x323630393130',
  effectiveCitizenship: '',
  citizenshipWhitelist: [],
  destination: '0x8Dea8065888A14F66ba9Fb944353d898663863cf',
  calldata: '0x1234',
};

beforeEach(() => {
  clearArtifacts();
  asBetaBuild();
});

describe('vote artifacts', () => {
  it('starts empty and says so', () => {
    expect(hasArtifacts()).toBe(false);
    expect(snapshotArtifacts()).toEqual({});
    expect(documentOfLastVote()).toBe('unknown');
  });

  it('keeps the registration and the vote side by side', () => {
    recordRegistrationArtifact(registration);
    recordVoteArtifact(vote);
    const s = snapshotArtifacts();
    expect(s.registration).toMatchObject(registration);
    expect(s.vote).toMatchObject(vote);
    expect(typeof s.registration?.recordedAt).toBe('string');
    expect(hasArtifacts()).toBe(true);
    expect(documentOfLastVote()).toBe('passport');
  });

  it('is cleared when the flow starts over', () => {
    recordVoteArtifact(vote);
    clearArtifacts();
    expect(hasArtifacts()).toBe(false);
  });

  // The attachment is the one place the values are NOT redacted — that is
  // its purpose — so it must say so, and it must carry the proof verbatim.
  it('writes the proof and public signals unredacted, with a warning', () => {
    recordVoteArtifact(vote);
    const json = formatArtifactsJson();
    const parsed = JSON.parse(json);
    expect(parsed.note).toMatch(/Unredacted/);
    expect(parsed.vote.queryProof.pub_signals).toHaveLength(23);
    expect(parsed.vote.nullifier).toBe('0x' + 'aa'.repeat(32));
    expect(parsed.vote.selector).toBe('39457');
  });

  it('names the document from the DG1 length', () => {
    expect(documentFromDg1Length(93)).toBe('passport');
    expect(documentFromDg1Length(95)).toBe('idCard');
    expect(documentFromDg1Length(0)).toBe('unknown');
  });
});

// C2: the collection itself, not only the attachment, is beta-only. A store
// binary must never hold a proof, a nullifier or a calldata in memory.
describe('a production (store) build collects nothing', () => {
  it('drops a vote artifact on the floor', () => {
    asStoreBuild();
    recordVoteArtifact(vote);
    expect(hasArtifacts()).toBe(false);
    expect(snapshotArtifacts()).toEqual({});
    expect(documentOfLastVote()).toBe('unknown');
  });

  it('drops a registration artifact on the floor', () => {
    asStoreBuild();
    recordRegistrationArtifact(registration);
    expect(hasArtifacts()).toBe(false);
    expect(snapshotArtifacts().registration).toBeUndefined();
  });

  it('holds no proof, no nullifier and no calldata anywhere in memory', () => {
    asStoreBuild();
    recordRegistrationArtifact(registration);
    recordVoteArtifact(vote);
    const json = formatArtifactsJson();
    for (const secret of [
      vote.nullifier,
      vote.calldata,
      vote.selector,
      registration.proofHex,
      registration.passportHash,
      registration.identityKey,
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(JSON.parse(json).vote).toBeUndefined();
    expect(JSON.parse(json).registration).toBeUndefined();
  });

  it('a value recorded in beta is not kept once the build is a store build', () => {
    // The guard is read at record time; what a beta build already collected
    // is cleared by the flow, as before.
    recordVoteArtifact(vote);
    expect(hasArtifacts()).toBe(true);
    asStoreBuild();
    clearArtifacts();
    recordVoteArtifact(vote);
    expect(hasArtifacts()).toBe(false);
  });

  it('a build whose flavour cannot be read is treated as production', () => {
    Application.applicationId = undefined as unknown as string;
    recordVoteArtifact(vote);
    expect(hasArtifacts()).toBe(false);
  });
});
