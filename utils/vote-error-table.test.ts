import fr from '@/locales/fr.json';
import en from '@/locales/en.json';
import { BIRTH_DATE_MESSAGES, CITIZENSHIP_MESSAGE } from './mrz-date-bounds';
import {
  classifyVoteError,
  VOTE_ERROR_TABLE,
  voteErrorKey,
  voteErrorMessage,
  VoteRefusal,
  type VoteErrorCode,
} from './vote-error-table';

const lookup = (dict: unknown) => (key: string): string => {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
  if (typeof v !== 'string') throw new Error(`missing key ${key}`);
  return v;
};
const tFr = lookup(fr);
const tEn = lookup(en);
const codes = Object.keys(VOTE_ERROR_TABLE) as VoteErrorCode[];
const posted = (message: string, status?: number) =>
  Object.assign(new Error(message), { votePostSent: true, ...(status ? { status } : {}) });

describe('the table itself', () => {
  it.each(codes)('%s has a French and an English text for both documents', (code) => {
    for (const doc of ['idCard', 'passport'] as const) {
      expect(voteErrorMessage(tFr, code, doc).length).toBeGreaterThan(10);
      expect(voteErrorMessage(tEn, code, doc).length).toBeGreaterThan(10);
      expect(voteErrorMessage(tFr, code, doc)).not.toBe(voteErrorMessage(tEn, code, doc));
    }
  });

  it('expected refusals carry neither Retry nor the report button', () => {
    for (const code of [
      'already-voted',
      'ineligible-minor',
      'ineligible-age-limit',
      'ineligible-citizenship',
      'other-key',
      'question-closed',
      'ended',
      'not-started',
      'app-outdated',
    ] as VoteErrorCode[]) {
      expect(VOTE_ERROR_TABLE[code]).toMatchObject({ severity: 'expected', retryable: false, reportable: false });
    }
  });

  it('the unsupported document is final but still reported', () => {
    expect(VOTE_ERROR_TABLE['unsupported-document']).toMatchObject({ retryable: false, reportable: true });
  });

  it('403, 500 and network keep Retry', () => {
    for (const code of ['relayer-forbidden', 'relayer-server', 'network', 'outcome-unknown'] as VoteErrorCode[]) {
      expect(VOTE_ERROR_TABLE[code].retryable).toBe(true);
    }
  });

  it('nothing that can follow a sent vote says it was not recorded (R4)', () => {
    for (const code of ['outcome-unknown', 'outcome-still-unknown', 'relayer-server', 'relayer-forbidden'] as VoteErrorCode[]) {
      for (const doc of ['idCard', 'passport'] as const) {
        expect(voteErrorMessage(tFr, code, doc)).not.toMatch(/pas (été|pu être) enregistré/);
        expect(voteErrorMessage(tEn, code, doc)).not.toMatch(/not (been )?(registered|recorded)/i);
      }
    }
  });
});

describe('classifyVoteError, by sub-case and never by the text the voter read', () => {
  it('minor, age limit and nationality, from the app pre-check and from the SDK wording', () => {
    expect(classifyVoteError(new Error(BIRTH_DATE_MESSAGES['above-upperbound']))).toBe('ineligible-minor');
    expect(classifyVoteError(new Error('Birth date is higher than upperbound'))).toBe('ineligible-minor');
    expect(classifyVoteError(new Error(BIRTH_DATE_MESSAGES['below-lowerbound']))).toBe('ineligible-age-limit');
    expect(classifyVoteError(new Error(CITIZENSHIP_MESSAGE))).toBe('ineligible-citizenship');
    expect(classifyVoteError(new Error('Citizen is not in whitelist'))).toBe('ineligible-citizenship');
  });

  it('other key: the proof refused because the chain holds another identity for this document', () => {
    expect(classifyVoteError(new Error('profile key mismatch. profileKey = 0x…, passportInfo.activeIdentity = 0x…'))).toBe(
      'other-key',
    );
  });

  it('already voted: « Vous avez déjà voté sur cette question », the SDK and the contract', () => {
    expect(classifyVoteError(new Error('[VOTE_INELIGIBLE] Vous avez déjà voté sur cette question.'))).toBe('already-voted');
    expect(classifyVoteError(new Error('User has already voted'))).toBe('already-voted');
    expect(classifyVoteError(new Error('nullifier already used'))).toBe('already-voted');
  });

  it('an unsupported document', () => {
    expect(classifyVoteError(new Error('TD3 voting is not supported'))).toBe('unsupported-document');
    expect(classifyVoteError(new VoteRefusal('unsupported-document'))).toBe('unsupported-document');
  });

  it('403 and 500, with the card and the passport wording', () => {
    const e403 = posted('HTTP error 403: Forbidden', 403);
    expect(classifyVoteError(e403)).toBe('relayer-forbidden');
    expect(tFr(voteErrorKey('relayer-forbidden', 'idCard'))).toBe(
      'Le service de vote est momentanément saturé. Votre carte est bien inscrite, réessayez dans quelques minutes.',
    );
    expect(tFr(voteErrorKey('relayer-forbidden', 'passport'))).toMatch(/Votre passeport est bien inscrit/);
    expect(tEn(voteErrorKey('relayer-forbidden', 'idCard'))).toMatch(/busy/);
    expect(classifyVoteError(posted('HTTP error 500: <html>…</html>', 500))).toBe('relayer-server');
    // The relayer body never reaches the voter: the text is the table's.
    expect(voteErrorMessage(tFr, 'relayer-server', 'idCard')).not.toMatch(/html|500/);
  });

  it('a transport failure before the POST is the network; after it, the outcome is unknown', () => {
    expect(classifyVoteError(new Error('Network request failed'))).toBe('network');
    expect(classifyVoteError(posted('Network request failed'))).toBe('outcome-unknown');
    expect(classifyVoteError(posted('HTTP error 504: Gateway Time-out', 504))).toBe('outcome-unknown');
    expect(classifyVoteError(posted('The request timed out.'))).toBe('outcome-unknown');
  });

  it('the 400: terminal only when the rule fails locally; a date change keeps Retry', () => {
    const e400 = posted('HTTP error 400: {"error":"Execution reverted","field":"failed to estimate gas"}', 400);
    expect(classifyVoteError(e400)).toBe('rejected-opaque');
    expect(classifyVoteError(e400, { dateChanged: true })).toBe('rejected-date-rollover');
    expect(VOTE_ERROR_TABLE['rejected-date-rollover'].retryable).toBe(true);
    expect(classifyVoteError(e400, { localIneligibility: 'wrong-document' })).toBe('unsupported-document');
    expect(classifyVoteError(e400, { localIneligibility: 'closed' })).toBe('question-closed');
    // The relayer 400 carrying the pairing selector stays named.
    expect(classifyVoteError(posted('HTTP error 400: 0xd71fd263', 400))).toBe('prover-incompatible');
  });

  it('the voting window', () => {
    expect(classifyVoteError(new Error('Voting has ended.'))).toBe('ended');
    expect(classifyVoteError(new Error('Voting has not started.'))).toBe('not-started');
  });

  it('defaults to unknown, retryable and reportable', () => {
    expect(classifyVoteError(new Error('something else'))).toBe('unknown');
    expect(VOTE_ERROR_TABLE.unknown).toMatchObject({ retryable: true, reportable: true });
  });
});
