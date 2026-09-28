const mockIsSupported = jest.fn();
jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: { isSupported: () => mockIsSupported() },
}));

import { checkNfcHardware } from './nfc-support';

describe('checkNfcHardware (item 11 E)', () => {
  it('an iPad: a definite no', async () => {
    mockIsSupported.mockResolvedValue(false);
    expect(await checkNfcHardware()).toBe(false);
  });

  it('a phone with NFC: yes', async () => {
    mockIsSupported.mockResolvedValue(true);
    expect(await checkNfcHardware()).toBe(true);
  });

  it('an error or an odd answer is a "maybe", never a block', async () => {
    mockIsSupported.mockRejectedValue(new Error('module missing'));
    expect(await checkNfcHardware()).toBeNull();
    mockIsSupported.mockResolvedValue(undefined);
    expect(await checkNfcHardware()).toBeNull();
  });
});
