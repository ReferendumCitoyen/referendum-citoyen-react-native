import {
  bytesToBigIntBE,
  rsaBarrettReductionParam,
  smartBNToArray120,
  splitBy120Bits,
} from './heavy-noir-inputs-math';

describe('smartBNToArray120', () => {
  it('emits k zeroes when x = 0', () => {
    expect(smartBNToArray120(120, 3, 0n)).toEqual([0n, 0n, 0n]);
  });

  it('limb[0] is least significant', () => {
    // 2^120 + 5 → limb[0] = 5, limb[1] = 1
    const x = (1n << 120n) + 5n;
    const out = smartBNToArray120(120, 3, x);
    expect(out[0]).toBe(5n);
    expect(out[1]).toBe(1n);
    expect(out[2]).toBe(0n);
  });

  it('truncates silently when k is too small', () => {
    // 2^240 needs 3 limbs to represent; ask for only 2 → high bits dropped
    const x = 1n << 240n;
    const out = smartBNToArray120(120, 2, x);
    expect(out).toEqual([0n, 0n]);
  });

  it('handles values smaller than one limb', () => {
    expect(smartBNToArray120(120, 1, 0xffn)).toEqual([0xffn]);
  });
});

describe('splitBy120Bits', () => {
  it('returns 18 limbs for 256-byte (2048-bit) RSA modulus', () => {
    const modulus = new Uint8Array(256).fill(0xff);
    const out = splitBy120Bits(modulus);
    expect(out.length).toBe(18);
  });

  it('reconstructs the original integer when limbs are recombined', () => {
    // Use a non-trivial bigint with bits set across multiple limbs.
    const bytes = new Uint8Array(32); // 256 bits
    for (let i = 0; i < 32; i++) bytes[i] = (i * 7 + 3) & 0xff;
    const original = bytesToBigIntBE(bytes);

    const limbs = splitBy120Bits(bytes); // 3 limbs (256/120 = 2.13)
    expect(limbs.length).toBe(3);

    // limbs[0] + (limbs[1] << 120) + (limbs[2] << 240) === original
    const reconstructed = limbs[0] + (limbs[1] << 120n) + (limbs[2] << 240n);
    expect(reconstructed).toBe(original);
  });

  it('matches the canonical formula from rarime-android-app CircuitUtill.kt', () => {
    // From the Kotlin reference: BigInteger(1, data) is unsigned BE.
    // smartBNToArray120(120, ceil(bits/120), n) gives the limb sequence.
    // We reproduce the formula here and assert byte-for-byte match.
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]); // 32 bits → 1 limb
    const limbs = splitBy120Bits(bytes);
    expect(limbs.length).toBe(1);
    expect(limbs[0]).toBe(0x01020304n);
  });
});

describe('rsaBarrettReductionParam', () => {
  it('computes floor(2^((nBits+2)*2) / n) for a known small modulus', () => {
    // For nBits=8, exp = 20, base = 2^20 = 1048576.
    // n = 0xff (255), 2^20 / 255 = 4112.06... → floor = 4112.
    // (4112 × 255 = 1048560, remainder 16.)
    const limbs = rsaBarrettReductionParam(0xffn, 8);
    // chunkNumber = ceil(8/120) = 1
    expect(limbs.length).toBe(1);
    expect(limbs[0]).toBe(4112n);
  });

  it('produces 18 limbs for RSA-2048', () => {
    // Use 2^2048 - 1 as a representative modulus length.
    const n = (1n << 2048n) - 1n;
    const limbs = rsaBarrettReductionParam(n, 2048);
    expect(limbs.length).toBe(18);
  });

  it('reconstruction of limbs matches floor(2^4100 / n)', () => {
    // Sanity: pick a deterministic 2048-bit n, compute the reference value
    // here, then verify the limb reconstruction equals it.
    let n = 0n;
    for (let i = 0; i < 256; i++) {
      n = (n << 8n) | BigInt(((i * 31 + 7) & 0xff) | 0x80); // ensure high bit set
    }
    const expected = (1n << BigInt((2048 + 2) * 2)) / n;
    const limbs = rsaBarrettReductionParam(n, 2048);
    let reconstructed = 0n;
    for (let i = limbs.length - 1; i >= 0; i--) {
      reconstructed = (reconstructed << 120n) | limbs[i];
    }
    expect(reconstructed).toBe(expected);
  });
});

describe('bytesToBigIntBE', () => {
  it('returns 0n for empty input', () => {
    expect(bytesToBigIntBE(new Uint8Array())).toBe(0n);
  });

  it('reads big-endian — first byte is most significant', () => {
    expect(bytesToBigIntBE(new Uint8Array([0x01, 0x00]))).toBe(0x100n);
  });

  it('handles a full 32-byte field element', () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 0xff;
    bytes[31] = 0x01;
    expect(bytesToBigIntBE(bytes)).toBe(
      (0xffn << (31n * 8n)) | 0x01n,
    );
  });
});
