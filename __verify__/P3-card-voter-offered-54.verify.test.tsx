/**
 * P3: every vote on #54 failed with relayer 400 "Execution reverted / failed
 * to estimate gas", all on iOS, 16 reports on 2.0.1. The sequence in every
 * report: a card vote on #73 succeeds (`step → 12`), a new flow opens on #54
 * a few seconds later (the post-vote "another referendum" card), the card is
 * read again, and the vote goes to #54's contract, which is the passport
 * contract (BioPassportVoting, the address in utils/vote-calldata.ts) while
 * the proof is a card proof.
 *
 * Replays the success screen of that #73 card vote with the proposal cache
 * the home had filled (#73 on the card contract, #52 to #56 on the passport
 * contract, #54 the most voted): the card must not send a card voter to #54.
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';

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
jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.1', applicationId: 'app.referendumcitoyen.fr' }));
const mockCachedProposals = jest.fn(async (): Promise<unknown[]> => []);
jest.mock('@/utils/proposal-cache', () => ({ readCachedProposals: () => mockCachedProposals() }));

import Step12Success from '@/components/voting-modal/Step12Success';
import { ThemeProvider } from '@/contexts/ThemeContext';

const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
const PASSPORT = '0x8Dea8065888A14F66ba9Fb944353d898663863cf';
const FRA = BigInt('0x465241');
const now = Math.floor(Date.now() / 1000);
const proposal = (id: string, contract: string, title: string, votes: bigint) => ({
  id,
  title,
  sendVoteContractAddress: contract,
  // Open on chain dates, as #54 was (no "Voting has ended" in the reports).
  startTimestamp: BigInt(now - 86400 * 90),
  duration: BigInt(86400 * 150),
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

describe('P3: after a card vote on #73, the next suggestion is votable with a card', () => {
  it('does not offer #54 (passport contract) to a card voter', async () => {
    const voted = proposal('73', CARD, 'Question 73', 5n);
    const june = ['52', '53', '55', '56'].map((id) => proposal(id, PASSPORT, `Juin ${id}`, 900n));
    const q54 = proposal('54', PASSPORT, "PRIX DE L'ÉLECTRICITÉ", 10331n);
    mockCachedProposals.mockImplementation(async () => [voted, ...june, q54]);
    const onVoteAnother = jest.fn();
    const r = render(
      <ThemeProvider>
        <Step12Success
          containerWidth={300}
          network="mainnet"
          proposalInfo={voted as any}
          onVoteAnother={onVoteAnother}
          {...({ isPassportFlow: false } as any)}
        />
      </ThemeProvider>,
    );
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(r.queryByText(/PRIX DE L'ÉLECTRICITÉ/)).toBeNull();
    expect(r.queryByText(/Juin 5\d/)).toBeNull();
  });
});
