import { step7ErrorMessage, type Step7ErrorContext } from './step7-error-message';
import {
  IDENTITY_BOUND_ELSEWHERE,
  PROOF_GENERATION_FAILED,
  REGISTERED_WITH_OTHER_KEY,
  REGISTRATION_REVERT,
  STATUS_READ_TIMEOUT,
  isOtherKeyRefusal,
  isStatusReadTimeout,
} from './registration-sentinels';
import { isExpectedError } from './error-reporter';

// `t` echoes the key (plus any interpolated value) so a test asserts which
// string was chosen, not what French it holds.
const ctx = (overrides: Partial<Step7ErrorContext> = {}): Step7ErrorContext => ({
  docSfx: 'idCard',
  keyLinkedToOtherDocument: false,
  t: (key, options) => {
    const value = options?.reason ?? options?.detail;
    return value ? `${key}|${value}` : key;
  },
  fallback: () => 'fallback',
  ...overrides,
});

describe('step7ErrorMessage', () => {
  it('shows a [VOTE_INELIGIBLE] body verbatim', () => {
    expect(step7ErrorMessage(new Error('[VOTE_INELIGIBLE] Cette carte est déjà enregistrée.'), ctx()))
      .toBe('Cette carte est déjà enregistrée.');
  });

  // Dossier 2.0.2, item 14 (d, e).
  describe('bound to another key', () => {
    const err = new Error(`${REGISTERED_WITH_OTHER_KEY} document status after one re-read`);

    it('picks the per-document message', () => {
      expect(step7ErrorMessage(err, ctx({ docSfx: 'idCard' })))
        .toBe('voting.errors.passportAlreadyBoundOtherKey_idCard');
      expect(step7ErrorMessage(err, ctx({ docSfx: 'passport' })))
        .toBe('voting.errors.passportAlreadyBoundOtherKey_passport');
    });

    it('is an expected refusal (no report button)', () => {
      expect(isOtherKeyRefusal(err)).toBe(true);
      expect(isExpectedError(err)).toBe(true);
    });

    it.each(['fr', 'en'])('the %s text claims no impossibility and names real menus', (lang) => {
      const strings = require(`../locales/${lang}.json`).voting.errors;
      for (const k of ['passportAlreadyBoundOtherKey_idCard', 'passportAlreadyBoundOtherKey_passport']) {
        const s: string = strings[k];
        expect(s).not.toMatch(/mainnet/i);
        expect(s).not.toMatch(/clé privée|private key/i);
        expect(s).not.toMatch(/Restaurer une clé|Restore a key/i);
        expect(s).toMatch(lang === 'fr' ? /Paramètres → Gestion des clés/ : /Settings → Key management/);
      }
    });
  });

  // AV1 / plan D2: the first status read never answered. Nothing was sent:
  // the network message, not "registration service unavailable".
  it('a status read that never answered is the network message, retryable', () => {
    const err = new Error(`${STATUS_READ_TIMEOUT} getDocumentStatus did not answer within 20 s`);
    expect(step7ErrorMessage(err, ctx())).toBe('voting.errors.network');
    expect(isStatusReadTimeout(err)).toBe(true);
  });

  it('shows a [CSCA_MISSING] body verbatim', () => {
    expect(step7ErrorMessage(new Error('[CSCA_MISSING] Certificat non reconnu : …'), ctx()))
      .toBe('Certificat non reconnu : …');
  });

  // Level 1: the card inherited the passport's key, so the passport is what
  // the chain already holds — say so, and say which document to vote with.
  describe('identity already bound to another document', () => {
    const err = new Error(`${IDENTITY_BOUND_ELSEWHERE} StateKeeper: identity already registered`);

    it('names the passport when a linked ID card is refused', () => {
      expect(step7ErrorMessage(err, ctx({ docSfx: 'idCard', keyLinkedToOtherDocument: true })))
        .toBe('voting.errors.identityBoundToOtherDocument_idCard');
    });

    it('names the ID card when a linked passport is refused', () => {
      expect(step7ErrorMessage(err, ctx({ docSfx: 'passport', keyLinkedToOtherDocument: true })))
        .toBe('voting.errors.identityBoundToOtherDocument_passport');
    });

    it('cannot name the other document when the key was not linked here', () => {
      expect(step7ErrorMessage(err, ctx({ docSfx: 'idCard', keyLinkedToOtherDocument: false })))
        .toBe('voting.errors.identityBoundToOtherDocument_unknown');
    });
  });

  it('quotes the on-chain reason for any other revert', () => {
    expect(step7ErrorMessage(new Error(`${REGISTRATION_REVERT} StateKeeper: certificate is expired`), ctx()))
      .toBe('voting.errors.registrationRefusedOnChain|StateKeeper: certificate is expired');
  });

  // The prover refusing the witness is, since 2026-09-05, what a circuit built
  // for the old certificate-tree leaf looks like. Retrying is pointless; the
  // user must be told to report, and the report must name the circuit.
  it('quotes the circuit and the prover reason when the proof cannot be generated', () => {
    const err = new Error(
      `${PROOF_GENERATION_FAILED} registerIdentity_1_256_1_6_960_248_NA: Cannot satisfy constraint`,
    );
    expect(step7ErrorMessage(err, ctx())).toBe(
      'voting.errors.proofGenerationFailed|registerIdentity_1_256_1_6_960_248_NA: Cannot satisfy constraint',
    );
  });

  it('treats a relayer 500 as the service being down', () => {
    expect(step7ErrorMessage(new Error('[registerViaNoir] relayer 500 Internal Server Error: {}'), ctx()))
      .toBe('voting.errors.registrationServiceUnavailable');
  });

  it('treats a confirmation timeout as the service being down', () => {
    expect(step7ErrorMessage(new Error('[Step7] Registration confirmation timed out after 63s.'), ctx()))
      .toBe('voting.errors.registrationServiceUnavailable');
  });

  it('falls back for anything else', () => {
    const fallback = jest.fn().mockReturnValue('generic');
    const err = new Error('signature used');
    expect(step7ErrorMessage(err, ctx({ fallback }))).toBe('generic');
    expect(fallback).toHaveBeenCalledWith(err);
  });

  it('falls back for a non-Error throw', () => {
    expect(step7ErrorMessage({ code: 42 }, ctx())).toBe('fallback');
  });

  // QA Android 2.0.2, item 4.3: a blank sentence left Step 7 on its spinner
  // with no message and no report button. Never return one.
  describe('never returns a blank sentence', () => {
    it('uses the generic key when the fallback answers nothing', () => {
      for (const answer of [undefined, null, '', '   ']) {
        expect(step7ErrorMessage(new Error('boom'), ctx({ fallback: () => answer as any })))
          .toBe('voting.errors.generic');
      }
    });

    it('uses the hard-coded sentence when even the generic key answers nothing', () => {
      expect(
        step7ErrorMessage(new Error('boom'), ctx({ fallback: () => '', t: (() => undefined) as any })),
      ).toBe('Une erreur est survenue. Veuillez réessayer.');
    });
  });
});
