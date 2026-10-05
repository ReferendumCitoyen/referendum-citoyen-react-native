import {
  byteArrayToBits,
  buildQueryIdentityInputs,
} from './query-identity-inputs';

describe('byteArrayToBits', () => {
  it('MSB-first per byte, emits numbers (not strings)', () => {
    // 0b10101010 = 0xAA → [1,0,1,0,1,0,1,0]
    expect(byteArrayToBits(new Uint8Array([0xaa]))).toEqual(
      [1, 0, 1, 0, 1, 0, 1, 0],
    );
  });

  it('handles all-zero and all-one bytes', () => {
    expect(byteArrayToBits(new Uint8Array([0x00, 0xff]))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it('93-byte TD3 DG1 expands to 744 bits', () => {
    const dg1 = new Uint8Array(93);
    for (let i = 0; i < 93; i++) dg1[i] = i & 0xff;
    expect(byteArrayToBits(dg1).length).toBe(744);
  });
});

describe('buildQueryIdentityInputs', () => {
  const baseArgs = {
    dg1: new Uint8Array([0xaa, 0x55]),
    smtProof: {
      root: '0x1c0f9d0df4269664aba3c3b0e96b1029e3273a1728b6c6674e75b18983db7a60',
      siblings: Array(80).fill('0x0000000000000000000000000000000000000000000000000000000000000000'),
    },
    selector: '6689',
    pkPassportHash: '8839474381234567890',
    issueTimestamp: '1744000000',
    identityCounter: '0',
    eventId: '0x0c3f3c96485ec9d96de363562b95866cdfb4fbf58e391cb2ad5b528910c4da00',
    eventData: '0xabcd',
    timestampLowerbound: '0',
    timestampUpperbound: '1744761600',
    identityCounterLowerbound: '0',
    identityCounterUpperbound: '1',
    expirationDateLowerbound: '0x000000',
    expirationDateUpperbound: '0x000000',
    birthDateLowerbound: '0x000000',
    birthDateUpperbound: '0x000000',
    citizenshipMask: '0x0',
    skIdentityDecimal: '14206245783295726894872618756472634587263545876234567',
  };

  it('emits the skIdentity field as decimal — not the Go SDK hex form', () => {
    const out = buildQueryIdentityInputs(baseArgs);
    expect(out.skIdentity).toBe(baseArgs.skIdentityDecimal);
  });

  it('converts SMT root + siblings hex to decimal strings', () => {
    const out = buildQueryIdentityInputs(baseArgs) as any;
    // root is a hex bytes32, decimal conversion via BigInt should give the
    // bigint string equivalent.
    expect(out.idStateRoot).toBe(
      BigInt(baseArgs.smtProof.root).toString(10),
    );
    expect(out.idStateSiblings).toHaveLength(80);
    expect(out.idStateSiblings[0]).toBe('0');
  });

  it('produces a currentDate hex with 6 hex bytes = 12 hex chars', () => {
    const out = buildQueryIdentityInputs(baseArgs) as any;
    // 0x prefix + 12 hex chars for YYMMDD ASCII (6 chars × 2 hex each)
    expect(out.currentDate).toMatch(/^0x[0-9a-f]{12}$/);
  });

  it('dg1 is expanded to bits (input length × 8)', () => {
    const out = buildQueryIdentityInputs(baseArgs) as any;
    expect(out.dg1.length).toBe(baseArgs.dg1.length * 8);
  });

  it('passes through hex date / mask fields unchanged', () => {
    const out = buildQueryIdentityInputs(baseArgs) as any;
    expect(out.expirationDateLowerbound).toBe('0x000000');
    expect(out.citizenshipMask).toBe('0x0');
  });

  it('uses camelCase circuit signal names (not snake_case)', () => {
    const out = buildQueryIdentityInputs(baseArgs) as any;
    // Regression guard: witnesscalc throws "Signal not found" on any
    // snake_case key (the circom uses camelCase throughout).
    expect(out).toHaveProperty('eventID');
    expect(out).toHaveProperty('eventData');
    expect(out).toHaveProperty('pkPassportHash');
    expect(out).toHaveProperty('skIdentity');
    expect(out).not.toHaveProperty('event_id');
    expect(out).not.toHaveProperty('sk_identity');
    expect(out).not.toHaveProperty('id_state_root');
  });
});
