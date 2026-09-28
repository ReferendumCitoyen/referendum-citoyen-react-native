/**
 * P11: on iOS a wrong CAN comes back from the native reader as
 * "NFCPassportReaderError: Security status not satisfied" (mixed case, as in
 * the reports). The user must be told about the CAN, not about NFC being off.
 * Replays the native rejection through the real modules/e-document wrapper.
 */
jest.mock('@/modules/e-document/src/EDocumentModule', () => ({
  __esModule: true,
  default: { scanDocument: jest.fn() },
}));

import { Platform } from 'react-native';
import EDocumentModule from '@/modules/e-document/src/EDocumentModule';
import { scanDocument } from '@/modules/e-document';

const IOS_WRONG_CAN = 'NFCPassportReaderError: Security status not satisfied';

describe('P11: iOS wrong CAN is reported as a CAN problem', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    (EDocumentModule as any).scanDocument.mockReset();
    (EDocumentModule as any).scanDocument.mockRejectedValue(new Error(IOS_WRONG_CAN));
  });
  afterEach(() => jest.restoreAllMocks());

  it('the shown message names the CAN and does not blame NFC being disabled', async () => {
    let caught: any;
    try {
      await scanDocument('I', { can: '000000' }, new Uint8Array(32));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/CAN/);
    expect(caught.message).not.toMatch(/NFC est activé/);
  });
});
