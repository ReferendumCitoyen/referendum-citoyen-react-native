/**
 * R5 / item 13: one date, UTC, captured once per proof.
 *
 * The contract reads the proof's current_date as midnight UTC of that day and
 * requires it within 24 h of the block time. These tests pin the three places
 * that read "today" (the app pre-check, the SDK pre-check, the proof input) to
 * the UTC day, and check that the calldata carries the proof's own date.
 */
import { hexlify, toUtf8Bytes } from 'ethers';
import { assertBirthDateEligible, birthDateBoundsIssue, todayMrzUtc } from './mrz-date-bounds';
import { loadSdkBuild } from './testing/load-sdk-build';

const packed = (s: string) => BigInt('0x' + Buffer.from(s, 'ascii').toString('hex'));
const UNUSED = 52983525027888n;

/** PublicSignalsTD1Builder.validateDate, from the contract. */
function contractAcceptsDate(yymmdd: string, blockTimestamp: number): boolean {
  const parsed =
    Date.UTC(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6))) / 1000;
  return parsed > blockTimestamp - 86400 && parsed < blockTimestamp + 86400;
}

/** The phone's local calendar date in a time zone, as the old code read it. */
function localMrz(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

describe('todayMrzUtc: the UTC day, whatever the phone says', () => {
  const cases: [string, string, string][] = [
    // [instant, zone where the voter stands, expected UTC day]
    ['2026-09-21T02:30:00Z', 'Etc/GMT+4', '260921'], // 22:30 on 20/09 locally
    ['2026-09-21T01:00:00Z', 'Pacific/Tahiti', '260921'], // 15:00 on 20/09 locally
    ['2026-09-20T22:30:00Z', 'Europe/Paris', '260920'], // 00:30 on 21/09 locally
  ];

  it.each(cases)('%s in %s → %s, which the contract accepts', (iso, zone, utcDay) => {
    const instant = new Date(iso);
    expect(todayMrzUtc(instant)).toBe(utcDay);
    expect(contractAcceptsDate(todayMrzUtc(instant), instant.getTime() / 1000)).toBe(true);
    // The local day is what the old proof carried.
    const local = localMrz(instant, zone);
    if (zone !== 'Europe/Paris') {
      // West of UTC in the evening: the local day is behind, and the contract
      // refuses it. This is the shape of the refusals P13 replays.
      expect(local).not.toBe(utcDay);
      expect(contractAcceptsDate(local, instant.getTime() / 1000)).toBe(false);
    } else {
      // East of UTC after midnight: ahead, and accepted before and after the fix.
      expect(contractAcceptsDate(local, instant.getTime() / 1000)).toBe(true);
    }
  });
});

describe('the age rule reads the same UTC day in the app, the SDK and the proof', () => {
  // The patched SDK's own pre-check, run as shipped (build/RarimePassport.js).
  const { RarimePassport } = loadSdkBuild(
    'RarimePassport.js',
    {
      asn1js: {},
      '@iden3/js-crypto': { Poseidon: {} },
      './helpers/HashAlgorithm': {},
      './utils': {},
      '@li0ard/tsemrtd': {},
      './Freedomtool': { MRZ_ZERO_DATE: UNUSED },
      './helpers/CircuitSuite': {},
      './helpers/SuiteResolver': {},
      './helpers/SODAlgorithm': {},
    },
    require,
  );
  const sdkVerdict = (birthDate: string, upper: bigint, lower: bigint, current?: string) => {
    const proposalInfo = {
      criteria: {
        citizenshipWhitelist: [],
        sex: 0n,
        birthDateLowerbound: lower,
        birthDateUpperbound: upper,
        expirationDateLowerbound: UNUSED,
      },
    };
    const self = { getMRZData: () => ({ birthDate, issuingCountry: 'FRA', sex: '0', expiryDate: '350101' }) };
    try {
      RarimePassport.prototype.verifyPassport.call(self, proposalInfo, current);
      return null;
    } catch (e: any) {
      return e.message as string;
    }
  };
  const appVerdict = (birthDate: string, upper: bigint, lower: bigint, current: string) =>
    birthDateBoundsIssue({ birthDate, lowerbound: lower, upperbound: upper, current });

  const eighteenPlus = packed('080915'); // #73's birthDateUpperbound on chain

  afterEach(() => jest.useRealTimers());

  it('18th birthday at the bound: born the day before is in, born on it is out, either side of midnight UTC', () => {
    for (const iso of ['2026-09-20T23:59:00Z', '2026-09-21T00:01:00Z']) {
      const day = todayMrzUtc(new Date(iso));
      expect(appVerdict('080914', eighteenPlus, UNUSED, day)).toBeNull();
      expect(sdkVerdict('080914', eighteenPlus, UNUSED, day)).toBeNull();
      expect(appVerdict('080915', eighteenPlus, UNUSED, day)).toBe('above-upperbound');
      expect(sdkVerdict('080915', eighteenPlus, UNUSED, day)).toMatch(/higher than upperbound/);
    }
  });

  it('a person turning 100 today: app and SDK agree at 00:30 in Paris and at 22:30 at UTC-4', () => {
    // 00:30 in Paris on 21/09 is 22:30 UTC on 20/09. Born 21/09/1926.
    const paris = todayMrzUtc(new Date('2026-09-20T22:30:00Z'));
    expect(paris).toBe('260920');
    expect(appVerdict('260921', eighteenPlus, UNUSED, paris)).toBeNull();
    expect(sdkVerdict('260921', eighteenPlus, UNUSED, paris)).toBeNull();
    // 22:30 at UTC-4 on 20/09 is 02:30 UTC on 21/09. Born 20/09/1926: the
    // circuit's two-digit-year rule reads a date before today as 20xx, so the
    // proof would fail; what matters is that the app says so first, with the
    // same day the proof would use, instead of spending five minutes on it.
    const westOfUtc = todayMrzUtc(new Date('2026-09-21T02:30:00Z'));
    expect(westOfUtc).toBe('260921');
    expect(appVerdict('260920', eighteenPlus, UNUSED, westOfUtc)).toBe('above-upperbound');
    expect(sdkVerdict('260920', eighteenPlus, UNUSED, westOfUtc)).toMatch(/higher than upperbound/);
  });

  it('without an explicit date, the SDK pre-check uses the UTC day, not the local one', () => {
    jest.useFakeTimers();
    // 22:30 on 20/09 at UTC-4. Born 21/09/1926: at/after the UTC day
    // "260921" → 19xx → adult. Read with the local day it would still be
    // 19xx; the point is the day the SDK compares against.
    jest.setSystemTime(new Date('2026-09-21T02:30:00Z'));
    expect(sdkVerdict('260921', eighteenPlus, UNUSED)).toBeNull();
    expect(() =>
      assertBirthDateEligible('260920', { birthDateLowerbound: UNUSED, birthDateUpperbound: eighteenPlus }),
    ).toThrow(/majeures/);
  });

  it('a minor is refused in every time zone', () => {
    for (const iso of ['2026-09-21T02:30:00Z', '2026-09-21T01:00:00Z', '2026-09-20T22:30:00Z']) {
      const day = todayMrzUtc(new Date(iso));
      expect(appVerdict('100101', eighteenPlus, UNUSED, day)).toBe('above-upperbound');
      expect(sdkVerdict('100101', eighteenPlus, UNUSED, day)).toMatch(/higher than upperbound/);
    }
  });
});

describe('the proof carries the UTC day (patched build/Rarime.js)', () => {
  const prove = jest.fn(async (_inputs: string) => ({ proof: 'ab', pub_signals: [] as string[] }));
  const sdk = loadSdkBuild(
    'Rarime.js',
    {
      './RarimePassport': { DocumentStatus: {} },
      './types/contracts': {},
      './RnNoirModule': {
        NoirCircuitParams: {
          fromName: () => ({ prove, downloadByteCode: async () => 'bytecode' }),
          downloadTrustedSetup: async () => undefined,
          formatArray: (a: string[]) => a,
        },
      },
      'react-native': { Platform: { OS: 'ios' } },
      './helpers/HashAlgorithm': {},
      './helpers/contracts': {},
      './RarimeUtils': { RarimeUtils: { getProfileKey: () => '11' } },
      './helpers/SignatureAlgorithm': {},
      './utils': { toPaddedHex32: (v: unknown) => String(v), wrapPem: () => '' },
      '@iden3/js-crypto': { Poseidon: { hash: () => 0n } },
    },
    require,
  );
  const makeRarime = () => {
    const r = new sdk.Rarime({ userConfiguration: { userPrivateKey: '01'.repeat(32) } });
    r.getPassportInfo = async () => [
      { activeIdentity: '0x11', identityReissueCounter: 0n },
      { issueTimestamp: 0n },
    ];
    r.getSMTProof = async () => ({ root: '0xroot', siblings: [] });
    return r;
  };
  const passport = { dataGroup1: new Uint8Array(95), getPassportKey: () => 1n };
  const params = {
    eventId: '1', eventData: '2', selector: '3', timestampLowerbound: '0', timestampUpperbound: '0',
    identityCountLowerbound: '0', identityCountUpperbound: '0', birthDateLowerbound: '0',
    birthDateUpperbound: '0', expirationDateLowerbound: '0', expirationDateUpperbound: '0', citizenshipMask: '0',
  };
  const currentDateOf = () => JSON.parse(prove.mock.calls[prove.mock.calls.length - 1][0]).current_date;

  afterEach(() => {
    jest.useRealTimers();
    prove.mockClear();
  });

  it('formats current_date in UTC (22:30 at UTC-4 is already the 21st)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-21T02:30:00Z'));
    await makeRarime().generateQueryProof(params, passport);
    expect(currentDateOf()).toBe(hexlify(toUtf8Bytes('260921')));
  });

  it("uses the attempt's own date when one is given, and refuses a malformed one", async () => {
    await makeRarime().generateQueryProof({ ...params, currentDate: '260920' }, passport);
    expect(currentDateOf()).toBe(hexlify(toUtf8Bytes('260920')));
    await expect(makeRarime().generateQueryProof({ ...params, currentDate: '2026-09-20' }, passport)).rejects.toThrow(
      /invalid current date/,
    );
  });

  it('the src copy carries the same UTC expression', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs');
    const src = readFileSync(require.resolve('@rarimo/rarime-rn-sdk/src/Rarime.ts'), 'utf8');
    expect(src).toContain('new Time().utc().format("YYMMDD")');
    expect(src).not.toContain('new Time().format("YYMMDD")');
  });
});
