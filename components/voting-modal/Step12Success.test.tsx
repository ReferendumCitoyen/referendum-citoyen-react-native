import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    getString() { return undefined; }
    getBoolean() { return undefined; }
    set() {}
    delete() {}
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
// The installed version the eligibility rule compares with the index minimum.
jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.1', applicationId: 'app.referendumcitoyen.fr' }));
// Reads the proposal cache and the local index on mount for the "another
// referendum" card. Empty by default; the suggestion tests below fill them.
const mockCachedProposals = jest.fn(async (): Promise<unknown[]> => []);
jest.mock('@/utils/proposal-cache', () => ({ readCachedProposals: () => mockCachedProposals() }));
const mockLocalIndex = jest.fn();
jest.mock('@/utils/proposal-index', () => {
  const actual = jest.requireActual('@/utils/proposal-index');
  return {
    ...actual,
    readLocalProposalIndex: async () => mockLocalIndex() ?? actual.bundledProposalIndex(),
  };
});

import Step12Success from './Step12Success';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { parseProposalIndex } from '@/utils/proposal-index';
import { act } from '@testing-library/react-native';

// The backup notice is the only warning a voter ever gets that the key now
// bonded to their document is worth keeping — and because revoke() is blocked
// for French documents (no DG15), losing it means that document can never vote
// again. Two ways this silently breaks: it stops appearing at all, or it starts
// appearing after every vote, at which point people stop reading it.
describe('Step12Success key-backup notice', () => {
  const draw = (props: Record<string, unknown>) =>
    render(
      <ThemeProvider>
        <Step12Success containerWidth={300} {...props} />
      </ThemeProvider>,
    );

  // i18n fr, with the raw key as a fallback for when i18n isn't initialised in
  // the jest environment — same approach as Step8.test.tsx.
  const CTA = /Sauvegarder maintenant|step12BackupCta/;

  it('shows the notice after a first registration', () => {
    const r = draw({ justRegistered: true, onBackupKey: jest.fn() });
    expect(r.getByText(CTA)).toBeTruthy();
  });

  it('calls onBackupKey when the user takes it up', () => {
    const onBackupKey = jest.fn();
    const r = draw({ justRegistered: true, onBackupKey });
    fireEvent.press(r.getByText(CTA));
    expect(onBackupKey).toHaveBeenCalledTimes(1);
  });

  it('stays hidden for a document that was already registered', () => {
    const r = draw({ justRegistered: false, onBackupKey: jest.fn() });
    expect(r.queryByText(CTA)).toBeNull();
  });

  it('stays hidden when the flow passes no registration signal at all', () => {
    const r = draw({ onBackupKey: jest.fn() });
    expect(r.queryByText(CTA)).toBeNull();
  });

  // Without a handler the button would render and do nothing, which is worse
  // than not offering it — the user would believe they had backed up.
  it('stays hidden when there is no handler to take the user anywhere', () => {
    const r = draw({ justRegistered: true });
    expect(r.queryByText(CTA)).toBeNull();
  });
});

// Item 2: the post-vote card sent card voters to #54, a closed June question on
// the passport contract, because it offered the most-voted proposal open on
// chain dates. It now obeys the shared eligibility rule.
describe('Step12Success "another referendum" card', () => {
  const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
  const PASSPORT = '0x8Dea8065888A14F66ba9Fb944353d898663863cf';
  const FRA = BigInt('0x465241');
  const now = Math.floor(Date.now() / 1000);
  const proposal = (id: string, contract: string, title: string, votes: bigint) => ({
    id,
    title,
    sendVoteContractAddress: contract,
    startTimestamp: BigInt(now - 86400),
    duration: BigInt(86400 * 365),
    questions: [{ title: 'q', variants: ['Oui', 'Non'] }],
    votingResults: [[votes, 0n]],
    criteria: {
      selector: 39457n,
      citizenshipWhitelist: [FRA],
      birthDateLowerbound: 52983525027888n,
      birthDateUpperbound: 52983525027888n,
      expirationDateLowerbound: 52983525027888n,
    },
  });
  const voted = proposal('73', CARD, 'Question 73', 5n);
  const june = ['52', '53', '54', '55', '56'].map((id) => proposal(id, PASSPORT, `Juin ${id}`, 10331n));
  const idx = (mainnet: Record<string, unknown>) =>
    parseProposalIndex({ version: 1, mainnet: { active: [], devOnly: [], ...mainnet }, testnet: { active: [], devOnly: [] } });

  const drawCard = async (props: Record<string, unknown>) => {
    const r = render(
      <ThemeProvider>
        <Step12Success containerWidth={300} network="mainnet" proposalInfo={voted} {...props} />
      </ThemeProvider>,
    );
    // Let the mount effect read the (mocked) cache and index.
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    return r;
  };

  afterEach(() => {
    mockCachedProposals.mockReset();
    mockCachedProposals.mockImplementation(async () => []);
    mockLocalIndex.mockReset();
  });

  it('cached [73, 52..56] with the bundled index: no card', async () => {
    mockCachedProposals.mockImplementation(async () => [voted, ...june]);
    const r = await drawCard({ onVoteAnother: jest.fn() });
    expect(r.queryByText(/Juin 5\d/)).toBeNull();
  });

  it('a live card twin is offered with the pair', async () => {
    mockLocalIndex.mockReturnValue(idx({ active: ['73', '80'], twins: { '80': '81' } }));
    mockCachedProposals.mockImplementation(async () => [
      voted,
      proposal('80', PASSPORT, 'Question 80', 3n),
      proposal('81', CARD, 'Question 81', 4n),
    ]);
    const onVoteAnother = jest.fn();
    const r = await drawCard({ onVoteAnother });
    expect(r.getByText('Question 81')).toBeTruthy();
    fireEvent.press(r.getByText(/^Voter$|voteButton/));
    expect(onVoteAnother).toHaveBeenCalledWith('80', '81');
  });

  it('a passport-only question after a card vote: no card', async () => {
    mockLocalIndex.mockReturnValue(idx({ active: ['73', '80'] }));
    mockCachedProposals.mockImplementation(async () => [voted, proposal('80', PASSPORT, 'Question 80', 3n)]);
    const r = await drawCard({ onVoteAnother: jest.fn() });
    expect(r.queryByText('Question 80')).toBeNull();
  });
});
