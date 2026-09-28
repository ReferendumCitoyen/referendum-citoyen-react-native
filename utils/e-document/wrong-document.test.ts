import { isTransportError, suspectsWrongDocument } from './wrong-document';

// The error strings below are the real ones the native layers produce, not
// invented samples:
//   - iOS builds its message as "\(type(of: error)): \(localizedDescription)"
//     in modules/e-document/ios/EDocumentModule.swift, and the descriptions
//     come from NFCPassportReaderError in the pinned NFCPassportReader pod.
//   - Android rejects with the message thrown in DocumentScanner.kt.

describe('suspectsWrongDocument — regressions from beta feedback', () => {
  it('does not blame the document because the iOS error type is named "…Passport…"', () => {
    // Every single iOS failure carries this prefix, so matching on "passport"
    // reported "Passeport détecté" for any ID-card read error at all.
    const message =
      'NFCPassportReaderError: PACEError (Step3 KeyAgreement) - Error PICC Token mismatch!';
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
  });

  it('does not blame the document when a PACE failure mentions "passports public key"', () => {
    // The library says "passports …" in its own PACE messages regardless of
    // which document is on the phone — this fires on a genuine ID card that
    // simply coupled badly (held upside down).
    const message =
      'NFCPassportReaderError: PACEError (Step3 KeyEx) - Unable to decode passports ephemeral key';
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
  });

  it('does not read "bac" out of the word "back" in the Android ID-card failure', () => {
    const message =
      'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card. Original error: SW=6982';
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
  });
});

describe('suspectsWrongDocument — transport failures never produce a verdict', () => {
  it.each([
    'NFCPassportReaderError: Tag was lost',
    'NFCPassportReaderError: ConnectionError',
    'NFCPassportReaderError: UserCanceled',
    'NFCPassportReaderError: MoreThanOneTagFound',
    'NFC scan timeout',
    'android.nfc.TagLostException: Tag was lost',
  ])('%s is a transport error in both flows', (message) => {
    expect(isTransportError(message)).toBe(true);
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
    expect(suspectsWrongDocument(message, 'passport')).toBe(false);
  });

  it('a transport failure wins even when the message also carries a real signal', () => {
    const message = 'Tag was lost while polling ISO14443B';
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
  });
});

describe('suspectsWrongDocument — genuine signals still fire', () => {
  it.each([
    'NFCPassportReaderError: ISO14443B tag detected, expected Type A',
    'NFCPassportReaderError: Chip reports type B',
    'NFCPassportReaderError: PACE not supported by this chip',
  ])('%s means a passport during an ID-card scan', (message) => {
    expect(suspectsWrongDocument(message, 'idCard')).toBe(true);
    // …and says nothing about the reverse case.
    expect(suspectsWrongDocument(message, 'passport')).toBe(false);
  });

  it.each([
    'NFCPassportReaderError: PACEError (Step2IM) - Unsupported agreement algorithm',
  ])('%s means an ID card during a passport scan', (message) => {
    expect(suspectsWrongDocument(message, 'passport')).toBe(true);
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
  });

  // Rule R11 (2.0.2): 6982 is what a passport answers to BAC with a mistyped
  // MRZ. It is no evidence of an ID card, in either flow.
  it.each([
    'NFCPassportReaderError: ResponseError - Security status not satisfied',
    'net.sf.scuba.smartcards.CardServiceException: SW=6982',
    'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card. ' +
      'Original error: BAC failed (SW = 0x6982: SECURITY STATUS NOT SATISFIED)',
    'PACE: PACE failed (SW = 0x6300) ; BAC: BAC failed (SW = 0x6982: SECURITY STATUS NOT SATISFIED)',
  ])('a passport with a wrong MRZ (%s) is not classified as an ID card', (message) => {
    expect(suspectsWrongDocument(message, 'passport')).toBe(false);
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
  });
});

describe('suspectsWrongDocument — degenerate input', () => {
  it.each(['', 'Something went wrong', 'undefined'])('%p yields no verdict', (message) => {
    expect(suspectsWrongDocument(message, 'idCard')).toBe(false);
    expect(suspectsWrongDocument(message, 'passport')).toBe(false);
  });
});

// modules/e-document/index.ts rewrites the native error into French prose for
// display before Step 6 ever sees it. That rewrite consumes the tokens that
// identify the chip ("6982", "Step2IM") and introduces misleading ones, so
// Step 6 must classify on `error.nativeMessage` instead. These lock in what
// happens if anyone ever points the classifier back at the translated text.
describe('the French display text must never be used for classification', () => {
  const PACE_IM_REWRITE =
    '❌ Méthode PACE non supportée\n\nCette carte utilise le mode PACE-IM (Integrated Mapping) ' +
    "qui n'est pas encore implémenté dans le lecteur NFC.";
  const CAN_REWRITE =
    "❌ CAN obligatoire\n\nLes cartes d'identité françaises nécessitent le CAN (6 chiffres) " +
    "pour l'authentification PACE.";

  it('the PACE-IM rewrite reads as passport evidence during an ID-card scan', () => {
    // "PACE non supportée" is a passport signal, but this text is produced by a
    // *French ID card* that speaks PACE-IM. Classifying on it tells a valid
    // CNIe holder they are holding a passport.
    expect(suspectsWrongDocument(PACE_IM_REWRITE, 'idCard')).toBe(true);
    // The raw native error it was built from points the other way entirely.
    expect(suspectsWrongDocument('NFCPassportReaderError: PACEError (Step2IM) - Unsupported', 'idCard'))
      .toBe(false);
  });

  it('the CAN rewrite escapes a false verdict only by an accident of grammar', () => {
    // This one does NOT currently match, but only because the text says
    // "cartes d'identité" (plural) and the signal is /carte d'identit/. Change
    // that sentence to the singular and a passport scan starts reporting an ID
    // card. It is not a safety property — it is luck, which is the whole
    // argument for classifying on the native message instead.
    expect(CAN_REWRITE).toContain("cartes d'identité");
    expect(suspectsWrongDocument(CAN_REWRITE, 'passport')).toBe(false);
    expect(suspectsWrongDocument(CAN_REWRITE.replace("cartes d'identité", "carte d'identité"), 'passport'))
      .toBe(true);
  });

  it('the 6982 rewrite yields no verdict, and neither does the raw 6982', () => {
    const rewritten = "❌ Erreur d'authentification du passeport\n\nVérifiez que : …";
    expect(suspectsWrongDocument(rewritten, 'passport')).toBe(false);
    // Raw, it is a wrong MRZ as often as an ID card (rule R11, 2.0.2).
    expect(suspectsWrongDocument('ResponseError - Security status not satisfied', 'passport')).toBe(false);
  });
});
