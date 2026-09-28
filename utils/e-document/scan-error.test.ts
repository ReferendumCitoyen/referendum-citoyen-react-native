import { classifyScanError, scanErrorKey, type ScanErrorKind } from './scan-error';
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';

const lookup = (dict: any, key: string) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), dict);

// Native texts as the layers produce them: iOS "<ErrorType>: <description>"
// (EDocumentModule.swift), Android the DocumentScanner.kt exceptions. The
// Unknown(...) forms are what the 2.0.2 store build will send (item 11 F).
const IOS_WRONG_CAN = 'NFCPassportReaderError: InvalidResponse - Security status not satisfied';
const IOS_UE = 'NFCPassportReaderError: UnexpectedError';
const IOS_UNKNOWN_TIMEOUT =
  'NFCPassportReaderError: Unknown(Error Domain=NFCError Code=201 "Session timeout" UserInfo={NSLocalizedDescription=Session timeout})';
const IOS_UNKNOWN_BUSY =
  'NFCPassportReaderError: Unknown(Error Domain=NFCError Code=203 "System resource unavailable")';
const ANDROID_WRAPPER =
  'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card.';
const ANDROID_WRONG_CAN =
  'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card. ' +
  'Original error: BAC failed (SW = 0x6982: SECURITY STATUS NOT SATISFIED)';
const ANDROID_FAILED_RESPONSE =
  'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card. ' +
  'Original error: Failed response';

describe('classifyScanError: the CAN refused', () => {
  it('reads the iOS wrong-CAN text case-insensitively in the card flow', () => {
    expect(classifyScanError({ raw: IOS_WRONG_CAN, flow: 'idCard', elapsedMs: 4_000 })).toBe('canRejected');
    expect(classifyScanError({ raw: IOS_WRONG_CAN.toLowerCase(), flow: 'idCard' })).toBe('canRejected');
    expect(scanErrorKey('canRejected', 'idCard')).toBe('voting.step6CanRejected');
  });

  it('reads the Android wrapper through its Original error part', () => {
    expect(classifyScanError({ raw: ANDROID_WRONG_CAN, flow: 'idCard' })).toBe('canRejected');
    // A "Failed response" without 6982 is the card moving, not the CAN.
    expect(classifyScanError({ raw: ANDROID_FAILED_RESPONSE, flow: 'idCard' })).toBe('contactLost');
  });

  // P15 (plan D1): the wrapper alone is printed for any PACE failure, so it
  // never means "wrong CAN" by itself; only 6982 / "security status" do.
  it.each([
    'Tag was lost.',
    'java.io.IOException: Not connected',
    'java.lang.SecurityException: Tag 1a2b3c4d is out of date',
  ])('the wrapper around "%s" is lost contact, not a refused CAN', (cause) => {
    const raw = `${ANDROID_WRAPPER} Original error: ${cause}`;
    expect(classifyScanError({ raw, flow: 'idCard', elapsedMs: 4_000 })).toBe('contactLost');
    expect(classifyScanError({ raw, flow: 'passport' })).toBe('contactLost');
  });

  it('the wrapper with no recognisable cause is a plain read failure, not a refused CAN', () => {
    expect(classifyScanError({ raw: ANDROID_WRAPPER, flow: 'idCard' })).toBe('generic');
    expect(classifyScanError({ raw: `${ANDROID_WRAPPER} Original error: something else`, flow: 'idCard' }))
      .toBe('generic');
  });

  it('a passport with a wrong MRZ is neither a CAN problem nor an ID card', () => {
    for (const raw of [IOS_WRONG_CAN, ANDROID_WRONG_CAN, 'net.sf.scuba.smartcards.CardServiceException: SW=6982']) {
      const kind = classifyScanError({ raw, flow: 'passport', hasSpecificMessage: true });
      expect(kind).not.toBe('canRejected');
      expect(kind).not.toBe('wrongDocument');
      // modules/e-document/index.ts's passport sentence ("vérifiez les dates…").
      expect(kind).toBe('translated');
    }
  });
});

describe('classifyScanError: timeouts and a busy reader, old and new native formats', () => {
  it('our own timer and the 75 s safety net', () => {
    expect(classifyScanError({ raw: 'NFC scan timeout', flow: 'idCard' })).toBe('timeout');
    expect(scanErrorKey('timeout', 'idCard')).toBe('voting.step6Timeout_idCard');
    expect(scanErrorKey('timeout', 'passport')).toBe('voting.step6Timeout_passport');
  });

  it('today: UnexpectedError classified by when it happened', () => {
    expect(classifyScanError({ raw: IOS_UE, flow: 'idCard', elapsedMs: 60_010 })).toBe('timeout');
    expect(classifyScanError({ raw: IOS_UE, flow: 'idCard', elapsedMs: 40 })).toBe('nfcBusy');
    expect(classifyScanError({ raw: IOS_UE, flow: 'idCard', elapsedMs: 12_000 })).toBe('interrupted');
    expect(classifyScanError({ raw: IOS_UE, flow: 'passport' })).toBe('interrupted');
  });

  it('2.0.2 store build: Unknown(<CoreNFC reason>)', () => {
    expect(classifyScanError({ raw: IOS_UNKNOWN_TIMEOUT, flow: 'idCard', elapsedMs: 3_000 })).toBe('timeout');
    expect(classifyScanError({ raw: IOS_UNKNOWN_BUSY, flow: 'passport', elapsedMs: 20_000 })).toBe('nfcBusy');
    expect(classifyScanError({ raw: 'NFCPassportReaderError: Unknown(Error Domain=NFCError Code=202)', flow: 'idCard', elapsedMs: 10 }))
      .toBe('nfcBusy');
    expect(scanErrorKey('nfcBusy', 'idCard')).toBe('voting.step6NfcBusy');
  });
});

describe('classifyScanError: the rest', () => {
  it.each([
    ['NFCPassportReaderError: Tag response error / no response', 'contactLost'],
    ['android.nfc.TagLostException: Tag was lost.', 'contactLost'],
    ['NFCPassportReaderError: UserCanceled', 'userCancelled'],
    ['NFCPassportReaderError: NFCNotSupported', 'nfcUnsupported'],
    ['InvalidMRZKey', 'invalidMrz'],
    ['Something nobody expected', 'generic'],
  ] as [string, ScanErrorKind][])('%s → %s', (raw, kind) => {
    expect(classifyScanError({ raw, flow: 'idCard' })).toBe(kind);
  });
});

describe('no English on screen: every message key exists in both locales', () => {
  const kinds: ScanErrorKind[] = [
    'invalidMrz', 'userCancelled', 'nfcUnsupported', 'timeout', 'canRejected',
    'contactLost', 'nfcBusy', 'interrupted', 'generic',
  ];
  it.each(kinds)('%s', (kind) => {
    for (const sfx of ['idCard', 'passport'] as const) {
      const key = scanErrorKey(kind, sfx)!;
      expect(typeof lookup(fr, key)).toBe('string');
      expect(typeof lookup(en, key)).toBe('string');
    }
  });

  it('the timeout text names where the antenna is, on both platforms', () => {
    for (const dict of [fr, en] as any[]) {
      expect(dict.voting.step6Timeout_idCard).toContain('{{antenna}}');
      expect(dict.voting.step6Timeout_passport).toContain('{{antenna}}');
      expect(typeof dict.voting.step6AntennaIos).toBe('string');
      expect(typeof dict.voting.step6AntennaAndroid).toBe('string');
    }
  });
});
