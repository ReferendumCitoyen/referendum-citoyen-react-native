/**
 * Plan D14, rule R8: at the native boundary only an error type and a closed
 * code are logged, never the native text (which can carry chip bytes, tag
 * ids or anything the native layer chose to print). The native text stays on
 * the error, for classification only.
 */
import { describeNativeError, nfcErrorCode } from './scan-error';

const mockScan = jest.fn();
jest.mock('@/modules/e-document/src/EDocumentModule', () => ({
  __esModule: true,
  default: { scanDocument: (...a: unknown[]) => mockScan(...a) },
}));
jest.mock('expo-modules-core', () => ({
  EventEmitter: class { addListener() { return { remove() {} }; } },
}));

const SECRET_TAG = 'Tag 04A1B2C3D4E5F6 is out of date';
const WRAPPER = 'Authentication failed for ID card. Try providing the CAN (6 digits) from the back of the card. ';

describe('nfcErrorCode follows classifyScanError', () => {
  it.each([
    [`${WRAPPER}Original error: Tag was lost.`, 'idCard', 'NFC_CONTACT_LOST'],
    [`${WRAPPER}Original error: java.lang.SecurityException: ${SECRET_TAG}`, 'idCard', 'NFC_CONTACT_LOST'],
    [`${WRAPPER}Original error: BAC failed (SW = 0x6982)`, 'idCard', 'NFC_AUTH'],
    ['NFCPassportReaderError: UserCanceled', 'passport', 'NFC_CANCELLED'],
    ['InvalidMRZKey', 'passport', 'NFC_INVALID_MRZ'],
    ['Something nobody expected', 'idCard', 'NFC_FAILED'],
  ] as const)('%s', (raw, flow, code) => {
    expect(nfcErrorCode({ raw, flow })).toBe(code);
  });
});

describe('describeNativeError', () => {
  it('keeps an identifier-like type and a closed code, nothing else', () => {
    const e = Object.assign(new Error(SECRET_TAG), { name: 'SecurityException' });
    expect(describeNativeError(e, 'NFC_CONTACT_LOST')).toBe('type=SecurityException code=NFC_CONTACT_LOST');
  });

  it('never lets free text through the type or the code', () => {
    const e = { name: 'Tag 04A1B2 lost', message: SECRET_TAG };
    const line = describeNativeError(e, 'code with 04A1B2 inside');
    expect(line).toBe('type=Error code=none');
  });
});

describe('modules/e-document scanDocument', () => {
  beforeEach(() => {
    mockScan.mockReset();
  });

  it('attaches the closed code, keeps the native text on the error, and logs neither the text nor the tag', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const native = `${WRAPPER}Original error: java.lang.SecurityException: ${SECRET_TAG}`;
    mockScan.mockRejectedValue(new Error(native));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { scanDocument } = require('@/modules/e-document');
    const thrown = await scanDocument('I', { can: '123456' }, new Uint8Array(32)).catch((e: any) => e);
    expect(thrown.nfcCode).toBe('NFC_CONTACT_LOST');
    expect(thrown.nativeMessage).toBe(native);
    const logged = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls].flat().map(String).join('\n');
    expect(logged).toContain('code=NFC_CONTACT_LOST');
    expect(logged).not.toContain('04A1B2C3D4E5F6');
    expect(logged).not.toContain('123456');
    jest.restoreAllMocks();
  });
});
