/**
 * P13: a #73 vote refused twice at 02:38 UTC from a phone four hours behind
 * UTC (evening of the previous day locally). The proof input current_date
 * and the app's age pre-check read "today". The contract reads current_date
 * as midnight UTC and requires it within 24 h of the block time.
 *
 * Replays that instant on a phone whose clock reads local time at UTC-4
 * (`Etc/GMT+4`). The jest process time zone cannot be changed from a
 * test, so the phone's local calendar is simulated: Date's local getters and
 * the SDK's Time library read local time shifted by -4 h, their UTC forms read
 * UTC. The SDK build installed in node_modules (the patched one) is run and
 * the inputs handed to the prover are captured.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

// Same idea as a plain require of the ESM build: transpile one file of the
// installed SDK build and run it with chosen mocks for its imports.
function loadSdkFile(file: string, mocks: Record<string, unknown>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const babel = require('@babel/core');
  const pkgDir = dirname(require.resolve('@rarimo/rarime-rn-sdk/package.json'));
  const path = join(pkgDir, 'build', file);
  const { code } = babel.transformSync(readFileSync(path, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
    filename: path,
  });
  const module = { exports: {} as Record<string, any> };
  const req = (id: string) => (id in mocks ? mocks[id] : require(id));
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', code)(req, module, module.exports);
  return module.exports;
}

const INSTANT = new Date('2026-09-21T02:38:00Z'); // 22:38 on 20/09 at UTC-4
const UTC_DAY = '260921';
const OFFSET_MS = -4 * 3600 * 1000;

const yymmdd = (d: Date) =>
  `${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const localView = (d: Date) => new Date(d.getTime() + OFFSET_MS);

/** @distributedlab/tools Time on that phone: local by default, `.utc()` on demand. */
class PhoneTime {
  private d = new Date();
  get timestamp() { return Math.floor(this.d.getTime() / 1000); }
  format(f: string) {
    if (f !== 'YYMMDD') throw new Error('unexpected format ' + f);
    return yymmdd(localView(this.d));
  }
  utc() {
    const d = this.d;
    return { format: (f: string) => { if (f !== 'YYMMDD') throw new Error('unexpected format ' + f); return yymmdd(d); } };
  }
}

/** PublicSignalsTD1Builder.validateDate, as the voting contract applies it. */
function contractAcceptsDate(yymmdd: string, blockTimestamp: number): boolean {
  const parsed =
    Date.UTC(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6))) / 1000;
  return parsed > blockTimestamp - 86400 && parsed < blockTimestamp + 86400;
}

describe('P13: the vote proof and the pre-check read the UTC day', () => {
  const realGetters = {
    getFullYear: Date.prototype.getFullYear,
    getMonth: Date.prototype.getMonth,
    getDate: Date.prototype.getDate,
  };
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(INSTANT);
    // The phone's local calendar (UTC-4).
    Date.prototype.getFullYear = function () { return localView(this).getUTCFullYear(); };
    Date.prototype.getMonth = function () { return localView(this).getUTCMonth(); };
    Date.prototype.getDate = function () { return localView(this).getUTCDate(); };
  });
  afterAll(() => {
    Object.assign(Date.prototype, realGetters);
    jest.useRealTimers();
  });

  it('the simulated phone is behind UTC at that instant', () => {
    expect(new Date().getDate()).toBe(20);
    expect(new Date().getUTCDate()).toBe(21);
    expect(new PhoneTime().format('YYMMDD')).toBe('260920');
  });

  it('the app pre-check date (todayMrz) is the UTC day', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { todayMrz } = require('@/utils/mrz-date-bounds');
    expect(todayMrz()).toBe(UTC_DAY);
  });

  it('the proof input current_date is the UTC day, which the contract accepts', async () => {
    const proveInputs: any[] = [];
    const circuit = {
      prove: async (json: string) => { proveInputs.push(JSON.parse(json)); return { proof: '00', pub_signals: [] }; },
      downloadByteCode: async () => 'bytecode',
    };
    const { Rarime } = loadSdkFile('Rarime.js', {
      './RnNoirModule': {
        NoirCircuitParams: {
          fromName: () => circuit,
          downloadTrustedSetup: async () => undefined,
          formatArray: (a: string[]) => a,
        },
      },
      './RarimeUtils': { RarimeUtils: { getProfileKey: () => 'aa' } },
      './types/contracts': {},
      './helpers/contracts': {},
      './helpers/HashAlgorithm': {},
      './helpers/SignatureAlgorithm': {},
      './utils': { toPaddedHex32: (v: unknown) => String(v), wrapPem: (v: unknown) => v },
      '@iden3/js-crypto': { Poseidon: { hash: () => 0n } },
      'react-native': { Platform: { OS: 'ios' } },
      './RarimePassport': { DocumentStatus: {} },
      '@distributedlab/tools': { Time: PhoneTime },
    });
    const self: any = {
      config: { userConfiguration: { userPrivateKey: '01' } },
      getPassportInfo: async () => [
        { activeIdentity: '0xaa', identityReissueCounter: 0n },
        { issueTimestamp: 0n },
      ],
      getSMTProof: async () => ({ root: '0x01', siblings: [] }),
    };
    const passport = { dataGroup1: new Uint8Array(95), getPassportKey: () => 1n };
    const params = {
      eventId: 1n, eventData: 1n, selector: 1n, timestampLowerbound: 0n, timestampUpperbound: 0n,
      identityCountLowerbound: 0n, identityCountUpperbound: 0n, birthDateLowerbound: 0n,
      birthDateUpperbound: 0n, expirationDateLowerbound: 0n, expirationDateUpperbound: 0n,
      citizenshipMask: 0n,
    };
    await Rarime.prototype.generateQueryProof.call(self, params, passport);
    expect(proveInputs).toHaveLength(1);
    const currentDate = Buffer.from(String(proveInputs[0].current_date).replace(/^0x/, ''), 'hex').toString('ascii');
    expect(currentDate).toBe(UTC_DAY);
    expect(contractAcceptsDate(currentDate, INSTANT.getTime() / 1000)).toBe(true);
  });
});
