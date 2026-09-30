/**
 * Fixture data for the QA gallery: proposals, a fake SDK that fails on
 * command, simulated chip reads. Nothing here touches a network, a chip or the
 * chain; nothing here is a real person's data.
 */
import { Buffer } from 'buffer';
import { ID_CARD_VOTING_ADDRESS as ID_CARD_VOTING_ADDRESS_FOR_QA } from '@/utils/voteResults';
import { REGISTERED_WITH_OTHER_KEY } from '@/utils/registration-sentinels';

const FRA = BigInt('0x465241');
const now = Math.floor(Date.now() / 1000);

type AnyProposal = any; // ProposalInfo is not exported by the SDK (see Step12Success).

function proposal(
  id: string,
  title: string,
  opts: { votes?: bigint[]; variants?: string[]; contract?: string; startOffset?: number; durationDays?: number } = {},
): AnyProposal {
  // The four options of every live question, in the chain's order
  // (constants/bundled-proposal-metadata.ts): a ballot the gallery shows
  // with three options is not the ballot the voter sees (2026-09-24).
  const variants = opts.variants ?? ['Oui', 'Non', 'Blanc', 'Je refuse de voter'];
  return {
    id,
    title,
    sendVoteContractAddress: opts.contract ?? ID_CARD_VOTING_ADDRESS_FOR_QA,
    startTimestamp: BigInt(now + (opts.startOffset ?? -86400 * 3)),
    duration: BigInt(86400 * (opts.durationDays ?? 30)),
    questions: [{ title: `${title} ?`, variants }],
    votingResults: [opts.votes ?? variants.map((_, i) => BigInt(1200 - i * 350))],
    criteria: {
      selector: 39457n,
      citizenshipWhitelist: [FRA],
      birthDateLowerbound: 52983525027888n,
      birthDateUpperbound: 52983525027888n,
      expirationDateLowerbound: 52983525027888n,
    },
  };
}

/** The question just voted on. A long French title on purpose: long titles
 *  are what push buttons down. */
export const VOTED_PROPOSAL: AnyProposal = proposal(
  'qa-901',
  "Approuvez-vous l'organisation d'un référendum d'initiative citoyenne sur la réforme des retraites et le financement des régimes spéciaux",
);

/** A second open question, offered by the post-vote card. */
export const NEXT_PROPOSAL: AnyProposal = proposal(
  'qa-902',
  'Faut-il inscrire le référendum d’initiative citoyenne dans la Constitution ?',
  { votes: [4210n, 1502n, 380n, 96n] },
);

/** A plausible serial number (0x + 64 hex), not a real transaction. */
export const QA_VOTE_TX = '0x' + 'ab12'.repeat(16);

/** What the chip returned, for Step 7's personal-details card. Fictional. */
export const QA_NFC_DATA = {
  personDetails: {
    firstName: 'MARIANNE',
    lastName: 'DUPONT-LEFEBVRE',
    birthDate: '850712',
    expiryDate: '330101',
    nationality: 'FRA',
    documentNumber: 'X4RTBPFW4',
  },
};

// ---------------------------------------------------------------------------
// Step 7: a fake SDK whose first call throws what the state needs. Step 7 calls
// passport.getMRZData() inside its try block before anything else, so the
// error reaches step7ErrorMessage() at once, with no SDK import, no RPC and no
// withRetry delay.
// ---------------------------------------------------------------------------

export function failingStep7Sdk(message: string) {
  const passport = {
    dataGroup1: new Uint8Array(95),
    sod: new Uint8Array(0),
    dataGroup15: undefined,
    getMRZData: () => {
      throw new Error(message);
    },
    extractDGHashAlgo: () => '',
    getSignatureAlgorithm: () => '',
  };
  const rarime = {};
  const attemptKey = { privateKey: '00'.repeat(32), passportHash: 'qa', keySource: 'qa' };
  return { passport: passport as any, rarime: rarime as any, attemptKey: attemptKey as any };
}

export const STEP7_MESSAGES = {
  otherKey: `${REGISTERED_WITH_OTHER_KEY} document status after one re-read`,
};

// ---------------------------------------------------------------------------
// Step 6: simulated native reads (utils/qa-overrides.ts).
// ---------------------------------------------------------------------------

/** A native-shaped failure: what EDocumentModule rejects with. */
export function nativeScanError(message: string, code?: string): Error {
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

/** The native JSON string of a read whose DG1 is `dg1Length` bytes long. */
export function nativeScanResult(dg1Length: number): string {
  const b64 = (n: number) => Buffer.from(new Uint8Array(n)).toString('base64');
  return JSON.stringify({
    personDetails: {
      firstName: 'MARIANNE',
      lastName: 'DUPONT',
      primaryIdentifier: 'DUPONT',
      secondaryIdentifier: 'MARIANNE',
      dateOfBirth: '850712',
      documentExpiryDate: '330101',
      dateOfExpiry: '330101',
      documentNumber: 'X4RTBPFW4',
      nationality: 'FRA',
    },
    sod: b64(64),
    dg1: b64(dg1Length),
  });
}

export type ScanScript =
  | { kind: 'fail'; message: string; code?: string; delayMs?: number }
  | { kind: 'succeed'; dg1Length: number; delayMs?: number }
  | { kind: 'hang' };

/** The stand-in the gallery installs for one Step 6 state. */
export function scanStandIn(script: ScanScript): () => Promise<string> {
  return () =>
    new Promise<string>((resolve, reject) => {
      if (script.kind === 'hang') return;
      const run = () =>
        script.kind === 'fail'
          ? reject(nativeScanError(script.message, script.code))
          : resolve(nativeScanResult(script.dg1Length));
      if (script.delayMs) setTimeout(run, script.delayMs);
      else run();
    });
}
