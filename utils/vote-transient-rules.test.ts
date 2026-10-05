/**
 * REG-2: a transient failure to read the on-chain rules must not make an open
 * question unvotable.
 *
 * The SDK's getProposalRules hands back an all-zero stub when it cannot decode
 * the rules, and says so where it does it: "which lets isFrenchCompatible
 * default to permissive and the on-chain verifier remains the source of truth
 * for vote eligibility". That stub is a statement about this phone's
 * connection at this second, an RPC hiccup, a gateway 5xx, a slow IPFS read,
 * not a statement about the question.
 *
 * 2.0.1 had no rules check on the home screen at all: the button was there,
 * the voter could try, and a real refusal was explained further along the
 * flow. 2.0.2 turned the stub into a refusal, so during any network incident
 * an open question showed with no button and, before REG-10, no message.
 *
 * Tolerating it is safe, and this file pins why: the stub degrades permissively
 * in every place that reads it afterwards, and the on-chain verifier still
 * refuses a proof that does not satisfy the real rules.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { checkVoteEligibility, type EligibilityContext } from '@/utils/vote-eligibility';
import { parseProposalIndex, type ProposalIndex } from '@/utils/proposal-index';
import { birthDateBoundsIssue } from '@/utils/mrz-date-bounds';

const CARD = '0x7D73513D64EE4427CF60711b9C4d76284d4F9e2F';
const NOW = 1_789_430_400 + 1_000;
const FRA = BigInt('0x465241');

const index = (active: string[] = ['73']): ProposalIndex =>
  parseProposalIndex({
    version: 1,
    mainnet: { active, devOnly: [] },
    testnet: { active: [], devOnly: [] },
  })!;

const ctx = (idx: ProposalIndex): EligibilityContext => ({
  index: idx,
  network: 'mainnet',
  devAllowed: false,
  nowSeconds: NOW,
  appOutdated: false,
});

const REAL_RULES = {
  selector: 39457n,
  citizenshipWhitelist: [FRA],
  birthDateLowerbound: 0n,
  birthDateUpperbound: 0n,
  expirationDateLowerbound: 0n,
};

/** Exactly what the SDK returns when it cannot decode the rules. */
const ZERO_STUB = {
  selector: 0n,
  citizenshipWhitelist: [],
  birthDateLowerbound: 0n,
  birthDateUpperbound: 0n,
  expirationDateLowerbound: 0n,
};

const proposal = (criteria: unknown) => ({
  id: '73',
  sendVoteContractAddress: CARD,
  startTimestamp: 1_789_430_400n,
  duration: 8_640_000n,
  questions: [{ title: 'q', variants: ['Oui', 'Non'] }],
  criteria,
});

describe('an open question stays votable through a rules read failure', () => {
  it('the all-zero stub no longer refuses', () => {
    expect(checkVoteEligibility(proposal(ZERO_STUB) as never, 'idCard', ctx(index()))).toEqual({
      ok: true,
    });
  });

  it('nor does criteria missing altogether', () => {
    expect(checkVoteEligibility(proposal(undefined) as never, 'idCard', ctx(index()))).toEqual({
      ok: true,
    });
  });

  it('nor a selector that arrives as an unreadable value', () => {
    for (const selector of [null, undefined, '', 'nope', {}]) {
      expect(
        checkVoteEligibility(proposal({ ...ZERO_STUB, selector }) as never, 'idCard', ctx(index())),
      ).toEqual({ ok: true });
    }
  });
});

describe('what the client still refuses, because it did read it', () => {
  it('rules that were read and leave France out', () => {
    const deu = proposal({ ...REAL_RULES, citizenshipWhitelist: [BigInt('0x444555')] });
    expect(checkVoteEligibility(deu as never, 'idCard', ctx(index()))).toEqual({
      ok: false,
      reason: 'citizenship',
    });
  });

  it('a contract this build does not know, which is not transient', () => {
    const other = { ...proposal(REAL_RULES), sendVoteContractAddress: '0xdeadbeef' };
    expect(checkVoteEligibility(other as never, 'idCard', ctx(index()))).toEqual({
      ok: false,
      reason: 'unknown-contract',
    });
  });

  it('a question that ended, whatever the rules read said', () => {
    const ended = { ...ctx(index()), nowSeconds: 1_789_430_400 + 8_640_001 };
    expect(checkVoteEligibility(proposal(ZERO_STUB) as never, 'idCard', ended)).toEqual({
      ok: false,
      reason: 'ended',
    });
  });

  it('a question not in the signed index', () => {
    expect(checkVoteEligibility(proposal(ZERO_STUB) as never, 'idCard', ctx(index([])))).toEqual({
      ok: false,
      reason: 'not-listed',
    });
  });

  it('dates that could not be read at all, which is a different thing', () => {
    // Without a start or a duration the client cannot say the question is
    // open, so it does not pretend to. That refusal stays.
    const undated = { ...proposal(REAL_RULES), startTimestamp: undefined };
    expect(checkVoteEligibility(undated as never, 'idCard', ctx(index()))).toEqual({
      ok: false,
      reason: 'unknown-rules',
    });
  });
});

describe('the stub stays permissive downstream, which is what makes this safe', () => {
  it('zero birth-date bounds skip the age check instead of refusing', () => {
    expect(
      birthDateBoundsIssue({
        birthDate: '900101',
        lowerbound: 0n,
        upperbound: 0n,
        current: '260923',
      }),
    ).toBeNull();
  });

  it('and a real bound still refuses, so tolerance is not blanket', () => {
    // 0x303830363131 is ASCII "080611": born after it, not yet 18.
    expect(
      birthDateBoundsIssue({
        birthDate: '200101',
        lowerbound: 0n,
        upperbound: BigInt('0x303830363131'),
        current: '260923',
      }),
    ).toBe('above-upperbound');
  });

  it('a bound that is six NUL bytes constrains nothing, which is the bug', () => {
    // 0n decodes to six NUL bytes, not to the contract's "000000". Comparing
    // against it made normalizeMrzDate produce NaN, every comparison came out
    // false, and the voter read "réservé aux personnes majeures" because an
    // RPC call had failed.
    expect(
      birthDateBoundsIssue({
        birthDate: '900101',
        lowerbound: 0n,
        upperbound: 0n,
        current: '260923',
      }),
    ).toBeNull();
  });
});
