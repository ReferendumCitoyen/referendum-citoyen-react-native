import { parseVoteTxHash, lookupErrorCode } from './vote-hash-input';

// 2.0.2 item 1 (e): the Vérifier sent whatever was typed to the RPC and
// logged the ethers error quoting it.
describe('parseVoteTxHash', () => {
  const hash = '0x' + 'ab12'.repeat(16);

  it('accepts a vote serial number, trimmed and lower-cased', () => {
    expect(parseVoteTxHash(`  ${hash.toUpperCase().replace('0X', '0x')} \n`)).toBe(hash);
  });

  it.each([
    ['a CAN', '483920'],
    ['a sentence', 'mon vote de ce matin'],
    ['a contract address', '0x' + '1'.repeat(40)],
    ['the hash without 0x', 'ab12'.repeat(16)],
    ['one character short', hash.slice(0, -1)],
    ['one character long', hash + 'a'],
    ['a non-hex character', hash.slice(0, -1) + 'g'],
    ['a hash inside text', `vote ${hash}`],
    ['empty', ''],
  ])('refuses %s', (_label, input) => {
    expect(parseVoteTxHash(input)).toBeNull();
  });
});

describe('lookupErrorCode', () => {
  it('keeps a known ethers code and nothing of the message', () => {
    const err = Object.assign(new Error('could not coalesce error (value="483920", request=...)'), {
      code: 'NETWORK_ERROR',
    });
    expect(lookupErrorCode(err)).toBe('NETWORK_ERROR');
  });

  it('maps anything else to other', () => {
    expect(lookupErrorCode(Object.assign(new Error('x'), { code: 'value 483920' }))).toBe('other');
    expect(lookupErrorCode('483920')).toBe('other');
    expect(lookupErrorCode(null)).toBe('other');
  });
});
