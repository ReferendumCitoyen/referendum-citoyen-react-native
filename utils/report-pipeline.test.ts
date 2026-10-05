/**
 * The report pipeline end to end (2.0.2 item 1, item 7, rule R8): what a
 * generated report may contain, the vote-trace purge, the crash-tail
 * lifecycle and the consent screen. File system, mail composer and share
 * sheet are in-memory fakes; the logger, the redactor and the report builder
 * are the real ones.
 */
import { Alert } from 'react-native';

type MemFs = Map<string, string>;
const memfs = (): MemFs => (global as unknown as { __reportsMemfs: MemFs }).__reportsMemfs;

jest.mock('expo-file-system/legacy', () => {
  const g = global as unknown as { __reportsMemfs?: Map<string, string> };
  g.__reportsMemfs = g.__reportsMemfs ?? new Map<string, string>();
  const files = g.__reportsMemfs;
  return {
    cacheDirectory: 'file:///cache/',
    EncodingType: { UTF8: 'utf8' },
    getInfoAsync: async (p: string) => ({ exists: files.has(p) }),
    readAsStringAsync: async (p: string) => {
      if (!files.has(p)) throw new Error('not found');
      return files.get(p) as string;
    },
    writeAsStringAsync: async (p: string, s: string) => {
      files.set(p, s);
    },
    deleteAsync: async (p: string) => {
      files.delete(p);
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      if (!files.has(from)) throw new Error('not found');
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
    readDirectoryAsync: async (dir: string) =>
      [...files.keys()].filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length)),
    getFreeDiskStorageAsync: async () => 37_640_000_000,
  };
});

jest.mock('expo-application', () => ({
  applicationId: 'app.referendumcitoyen.fr',
  nativeApplicationVersion: '2.0.2',
  nativeBuildVersion: '30',
}));

jest.mock('expo-device', () => ({
  manufacturer: 'Apple',
  modelName: 'iPhone 16',
  totalMemory: 7.73 * 1024 ** 3,
}));

jest.mock('expo-mail-composer', () => ({
  isAvailableAsync: jest.fn(async () => true),
  composeAsync: jest.fn(async () => ({ status: 'sent' })),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Application = require('expo-application') as { applicationId: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require('expo-mail-composer') as {
  isAvailableAsync: jest.Mock;
  composeAsync: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sharing = require('expo-sharing') as { shareAsync: jest.Mock };

import {
  __testing,
  beginVoteTrace,
  endVoteTrace,
  purgeVoteTrace,
  formatSessionHeader,
  languageOnly,
  roundedGb,
  minuteStamp,
  formatOffset,
  sanitizeTailForReport,
  rotateCrashTailAtLaunch,
  noteAppStateForCrashTail,
  readPreviousSessionLog,
  closedCode,
  loggableTxHash,
} from './logger';
import {
  prepareErrorReport,
  prepareSuccessReport,
  prepareRecoveredSessionReport,
  sendErrorReport,
  sendPreviousSessionReport,
  freeDiskBand,
  reportEnvelope,
} from './error-reporter';
import { recordVoteArtifact, recordRegistrationArtifact, clearArtifacts, hasArtifacts } from './vote-artifacts';

const CACHE = 'file:///cache/';
const CURRENT_TAIL = CACHE + 'last-session-log.txt';
const PREVIOUS_TAIL = CACHE + 'previous-session-log.txt';
const MARKER = CACHE + 'clean-exit.marker';

type AlertButton = { text?: string; onPress?: () => void; style?: string };
let consentAnswer: 'send' | 'cancel' = 'send';
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  memfs().clear();
  __testing.reset();
  clearArtifacts();
  Application.applicationId = 'app.referendumcitoyen.fr';
  MailComposer.isAvailableAsync.mockClear();
  MailComposer.isAvailableAsync.mockImplementation(async () => true);
  MailComposer.composeAsync.mockClear();
  MailComposer.composeAsync.mockImplementation(async () => ({ status: 'sent' }));
  Sharing.shareAsync.mockClear();
  consentAnswer = 'send';
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const list = (buttons ?? []) as AlertButton[];
    const pick = consentAnswer === 'send' ? list.find((b) => b.style !== 'cancel') : list.find((b) => b.style === 'cancel');
    pick?.onPress?.();
  });
});

afterEach(() => {
  alertSpy.mockRestore();
  jest.useRealTimers();
});

/** What the report files written so far contain, all of them joined. */
function writtenReports(): string {
  return [...memfs().entries()]
    .filter(([k]) => /\/(error-report|vote-report|vote-artifacts)-/.test(k))
    .map(([, v]) => v)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Synthetic secrets, in every form a report has carried or could carry
// ---------------------------------------------------------------------------

const HASH = '0x' + '5a7c'.repeat(16); // a registration tx hash // nosec: synthetic test vector
const LONG_HEX = 'c0ffee'.repeat(12);
const CAN = '483920';
const SURNAME = 'VALDEMORO';
const DOC_NO = 'X4RTBPFN6';
const B64 = 'UDxGUkFWQUxERU1PUk88PEpFQU48PDw8PDw8PDw8PDw8PDw8PDw8';
const SECRETS = [HASH, HASH.slice(2), LONG_HEX, CAN, SURNAME, DOC_NO, B64];

function logSecretsInEveryForm(): void {
  const p = (m: string) => __testing.push('log', m);
  p(`[Step7][mainnet] registerViaNoir submitted tx:${HASH}`); // the old KEPT marker
  p(`[registerViaNoir] relayer accepted tx:${HASH}`);
  p(`[smt] blob ${LONG_HEX}`);
  p(`[debug] passport: {"documentNumber":"${DOC_NO}","surname":"${SURNAME}"}`); // nested JSON
  p(`[debug] userCan=${CAN}`); // compound label
  p(`[debug] {"data":{"accessKey":"${CAN}"}}`); // nested, label one level down
  p(`[debug] dg1: ${B64}`); // base64 under a sensitive label
  p(`[debug] chip ${B64}`); // bare base64
}

function expectNoSecret(text: string): void {
  for (const s of SECRETS) expect(text).not.toContain(s);
  expect(text).not.toMatch(/0x[0-9a-fA-F]{64}/);
  // Only contract addresses on the allow-list may appear as 0x+40.
  const addrs = text.match(/0x[0-9a-fA-F]{40,64}/g) ?? [];
  for (const a of addrs) expect(a).toHaveLength(42);
}

function recordBetaArtifacts(): void {
  recordRegistrationArtifact({
    network: 'mainnet',
    circuitName: 'Z_NOIR_PASSPORT_TEST',
    zkType: HASH,
    pubSignals: [HASH],
    passportHash: HASH,
    dgCommit: HASH,
    identityKey: HASH,
    certificatesRoot: HASH,
    proofHex: LONG_HEX,
  });
  recordVoteArtifact({
    document: 'idCard',
    proposalId: '73',
    proposalEventId: '1',
    selector: '1',
    queryProof: { proof: { pi_a: [], pi_b: [], pi_c: [], protocol: 'groth16' }, pub_signals: [] },
    nullifier: HASH,
    registrationRoot: HASH,
    currentDate: '260922',
    effectiveCitizenship: 'FRA',
    citizenshipWhitelist: [],
    destination: '0x0000000000000000000000000000000000000000',
    calldata: '0x' + LONG_HEX,
  });
}

describe('a generated report carries no synthetic secret', () => {
  it('in PROD, where the artifacts are never collected in the first place', async () => {
    recordBetaArtifacts();
    // C2: the collection is beta-only, so PROD holds nothing to leak.
    expect(hasArtifacts()).toBe(false);
    logSecretsInEveryForm();
    const report = await prepareErrorReport(new Error(`boom tx:${HASH} can: ${CAN}`), {
      step: 13,
      network: 'mainnet',
      can: CAN, // a scalar CAN in the context
      payload: { dg1: B64 },
    });
    expectNoSecret(writtenReports());
    // PROD never attaches the artifacts JSON (item 1 f).
    expect(report.attachments).toHaveLength(1);
    expect(report.attachments[0]).toMatch(/error-report-.*\.txt$/);
    expect([...memfs().keys()].some((k) => k.endsWith('.json'))).toBe(false);
  });

  it('in PROD, for the success report too', async () => {
    recordBetaArtifacts();
    logSecretsInEveryForm();
    const report = await prepareSuccessReport({ step: 12, network: 'mainnet', proposalId: '73' });
    expectNoSecret(writtenReports());
    expect(report.attachments).toHaveLength(1);
    // The question just voted is not written next to the sender's address.
    expect(writtenReports()).not.toMatch(/proposalId/);
  });

  it('in the BETA text file (the JSON attachment is the beta-only exception)', async () => {
    Application.applicationId = 'app.referendumcitoyen.fr.beta';
    recordBetaArtifacts();
    logSecretsInEveryForm();
    const report = await prepareErrorReport(new Error('boom'), { step: 13 });
    expect(report.attachments).toHaveLength(2);
    expectNoSecret(memfs().get(report.uri) as string);
  });

  it('in a previous-session report made from an old 2.0.1 tail', async () => {
    const old = [
      `2026-09-21T07:58:10.101Z LOG   [Step7][mainnet] registerViaNoir submitted tx:${HASH}`,
      `2026-09-21T07:58:11.202Z LOG   [debug] userCan=${CAN} passport: {"surname":"${SURNAME}"}`,
      `2026-09-21T07:58:12.303Z LOG   [smt] ${LONG_HEX} ${B64}`,
    ].join('\n');
    memfs().set(PREVIOUS_TAIL, old);
    const text = await readPreviousSessionLog();
    expect(text).not.toBeNull();
    const report = await prepareRecoveredSessionReport(text as string);
    expectNoSecret(memfs().get(report.uri) as string);
    // Clock times became offsets.
    expect(memfs().get(report.uri)).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    expect(memfs().get(report.uri)).toContain('+00:01.101');
  });

  it('even when raw text is handed to the recovered-session builder', async () => {
    const report = await prepareRecoveredSessionReport(`registerViaNoir submitted tx:${HASH} can: ${CAN}`);
    expectNoSecret(memfs().get(report.uri) as string);
  });
});

describe('header and file names', () => {
  it('rounds RAM to the GB and bands the free disk', async () => {
    const report = await prepareErrorReport(new Error('x'), {});
    const text = memfs().get(report.uri) as string;
    expect(text).toContain('Memory  : 8 GB');
    // 37.64 GB of the fake file system, as a band and not as a figure.
    expect(text).toContain('Disk    : 20-50 GB free');
    expect(text).not.toMatch(/\d+\.\d+ GB/);
  });

  it('says the language only, never the region', () => {
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(() => ({ resolvedOptions: () => ({ locale: 'en-US' }) }) as unknown as Intl.DateTimeFormat);
    try {
      const header = formatSessionHeader('mainnet');
      expect(header).toContain('Locale  : en');
      expect(header).not.toMatch(/[a-z]{2}-[A-Z]{2}/);
    } finally {
      spy.mockRestore();
    }
    expect(languageOnly('fr-FR')).toBe('fr');
    expect(languageOnly('fr_CA')).toBe('fr');
    expect(languageOnly(null)).toBe('?');
  });

  it('stamps the header and the attachment name to the hour, not the minute', async () => {
    const report = await prepareErrorReport(new Error('x'), {});
    expect(report.uri).toMatch(/error-report-\d{4}-\d{2}-\d{2}T\d{2}Z\.txt$/);
    // The minute must NOT come back through the file name: the attachment
    // travels with the mail.
    expect(report.uri).not.toMatch(/T\d{2}-\d{2}Z/);
    const text = memfs().get(report.uri) as string;
    expect(text).toMatch(/Time {4}: \d{4}-\d{2}-\d{2}T\d{2}Z\n/);
    expect(text).not.toMatch(/Time {4}: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    // To the HOUR since 23/09/2026, not the minute: offsets plus this header
    // resolved every log line to an absolute time, and a vote carries its
    // block's timestamp on chain.
    expect(minuteStamp(new Date('2026-09-22T10:31:45.678Z'))).toBe('2026-09-22T10Z');
    // Two reports made in the same hour carry the same stamp. That is the point.
    expect(minuteStamp(new Date('2026-09-22T10:59:59.999Z'))).toBe('2026-09-22T10Z');
    expect(minuteStamp(new Date('2026-09-22T11:00:00.000Z'))).toBe('2026-09-22T11Z');
  });

  it('roundedGb never shows a decimal', () => {
    expect(roundedGb(3.74 * 1024 ** 3, 1024 ** 3)).toBe('4 GB');
    expect(roundedGb(0, 1e9)).toBe('?');
  });

  it('writes log times as offsets from the first line', async () => {
    const now = Date.now() - 5 * 60_000;
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(now);
    __testing.push('log', 'first');
    spy.mockReturnValue(now + 83_456);
    __testing.push('log', 'second');
    spy.mockRestore();
    const report = await prepareErrorReport(new Error('x'), {});
    const text = memfs().get(report.uri) as string;
    expect(text).toContain('+00:00.000 LOG   first');
    expect(text).toContain('+01:23.456 LOG   second');
    expect(formatOffset(75 * 60_000)).toBe('+75:00.000');
  });

  it('ends with the footer sentence', async () => {
    const report = await prepareErrorReport(new Error('x'), {});
    expect(memfs().get(report.uri)).toContain("supprimés après traitement");
  });
});

// ---------------------------------------------------------------------------
// The vote trace
// ---------------------------------------------------------------------------

function voteRun(): void {
  const p = (m: string) => __testing.push('log', m);
  p('[flow] step → 1 (focus-reset)');
  p('[Step10] Confirming vote for proposal #73');
  p('[FreedomTool] Step11: Submitting vote...');
  p('[FreedomTool] Step11: Vote TX hash: <hex64>');
  p('[flow] step → 12 (vote-submitted)');
}
const VOTE_LINE = /Submitting vote|vote-submitted|Confirming vote|Vote TX hash/;

describe('purgeVoteTrace', () => {
  it('drops the vote run from the buffer and keeps what came before', async () => {
    __testing.push('log', '[Accueil][mainnet] Loaded 6/6 proposals');
    beginVoteTrace();
    voteRun();
    await purgeVoteTrace();
    const msgs = __testing.snapshot().map((e) => e.msg);
    expect(msgs).toEqual(['[Accueil][mainnet] Loaded 6/6 proposals']);
  });

  it('rewrites the crash tail so the purged lines are not on disk either', async () => {
    __testing.push('log', 'before');
    beginVoteTrace();
    voteRun();
    await __testing.flushTail();
    expect(memfs().get(CURRENT_TAIL)).toMatch(VOTE_LINE);
    await purgeVoteTrace();
    expect(memfs().get(CURRENT_TAIL)).toContain('before');
    expect(memfs().get(CURRENT_TAIL)).not.toMatch(VOTE_LINE);
  });

  it('deletes the tail when the buffer is left empty', async () => {
    beginVoteTrace();
    voteRun();
    await __testing.flushTail();
    expect(memfs().has(CURRENT_TAIL)).toBe(true);
    await purgeVoteTrace();
    expect(memfs().has(CURRENT_TAIL)).toBe(false);
  });

  it('is not undone by a tail write that was already queued', async () => {
    beginVoteTrace();
    voteRun();
    // A periodic write is queued, then the purge, before either has run.
    const write = __testing.flushTail();
    const purge = purgeVoteTrace();
    await Promise.all([write, purge]);
    await __testing.drainTail();
    expect(memfs().get(CURRENT_TAIL) ?? '').not.toMatch(VOTE_LINE);
  });

  it('with no mark, purges the whole buffer (the safe side)', async () => {
    endVoteTrace();
    __testing.push('log', 'anything');
    await purgeVoteTrace();
    expect(__testing.snapshot()).toHaveLength(0);
  });

  it('a report prepared after the purge has no vote line; one prepared before is refused', async () => {
    beginVoteTrace();
    voteRun();
    const stale = await prepareErrorReport(new Error('later'), { step: 13 });
    await purgeVoteTrace();
    __testing.push('log', '[Step11] a later error');
    expect(await sendErrorReport(stale)).toBe(false);
    expect(MailComposer.composeAsync).not.toHaveBeenCalled();
    const fresh = await prepareErrorReport(new Error('later'), { step: 13 });
    expect(memfs().get(fresh.uri)).not.toMatch(VOTE_LINE);
    expect(await sendErrorReport(fresh)).toBe(true);
  });
});

describe('repeated purges (Step11 at the outcome, voting-flow at step 12/13 and on leaving)', () => {
  it('a purge that removes nothing keeps a report prepared since the last purge valid', async () => {
    beginVoteTrace();
    voteRun();
    await purgeVoteTrace();
    const report = await prepareSuccessReport({ step: 12 });
    await purgeVoteTrace();
    expect(memfs().has(report.uri)).toBe(true);
    expect(await sendErrorReport(report)).toBe(true);
  });

  it('a purge that removes a later vote line still refuses the older report', async () => {
    beginVoteTrace();
    voteRun();
    await purgeVoteTrace();
    const report = await prepareErrorReport(new Error('x'), { step: 13 });
    __testing.push('log', '[flow] step → 13 (vote-error)');
    await purgeVoteTrace();
    expect(__testing.snapshot().map((e) => e.msg)).not.toContain('[flow] step → 13 (vote-error)');
    expect(await sendErrorReport(report)).toBe(false);
  });
});

describe('old tails are filtered at read time', () => {
  it('drops a run that sent a vote, keeps the other runs', () => {
    const tail = [
      '2026-09-21T07:50:00.000Z LOG   [Accueil][mainnet] Loaded 6/6 proposals',
      '2026-09-21T07:51:00.000Z LOG   [flow] step → 1 (focus-reset)',
      '2026-09-21T07:52:00.000Z LOG   [FreedomTool] Step11: Submitting vote...',
      '2026-09-21T07:52:10.000Z LOG   [flow] step → 12 (vote-submitted)',
      '2026-09-21T07:53:00.000Z LOG   [flow] step → 1 (focus-reset)',
      '2026-09-21T07:54:00.000Z ERROR [Step7] missing-data timeout after 30s',
    ].join('\n');
    const out = sanitizeTailForReport(tail) as string;
    expect(out).not.toMatch(VOTE_LINE);
    expect(out).toContain('Loaded 6/6');
    expect(out).toContain('missing-data');
    expect(out.split('\n')[0]).toMatch(/^\+00:00\.000 /);
  });

  /* -----------------------------------------------------------------------
   * The window the 23/09/2026 audit found: the app dies between the POST and
   * the relayer's answer. None of the four "already came back" markers was
   * ever written, so before the fix the purge found nothing to cut on and
   * kept the whole run, proposal number and instant of the POST included.
   * VOTE_POST_TIMEOUT_MS is 90 s, so the window is not theoretical.
   * ---------------------------------------------------------------------------*/
  it('drops a run killed between the POST and the relayer answer', () => {
    const tail = [
      '2026-09-21T07:50:00.000Z LOG   [Accueil][mainnet] Loaded 6/6 proposals',
      '2026-09-21T07:51:00.000Z LOG   [flow] step → 1 (focus-reset)',
      '2026-09-21T07:52:00.000Z LOG   [Step11][mainnet] casting vote on proposal #73',
      '2026-09-21T07:52:01.000Z LOG   [submitVote] POST https://relayer.example/vote (destination=0xabc, calldataLen=1234)',
    ].join('\n');
    const out = sanitizeTailForReport(tail);
    // Everything from the vote onwards is gone; what came before may stay.
    if (out !== null) {
      expect(out).not.toContain('casting vote');
      expect(out).not.toContain('submitVote');
      expect(out).not.toContain('#73');
    }
  });

  it('drops a run whose only vote line is the relayer acceptance', () => {
    // "relayer accepted: txId=" is NOT matched by /vote tx id/i: no space in
    // "txId". That single detail is what left this window open.
    const tail = [
      '2026-09-21T07:51:00.000Z LOG   [flow] step → 1 (focus-reset)',
      '2026-09-21T07:52:02.000Z LOG   [submitVote] relayer accepted: txId=0xdeadbeef',
      '2026-09-21T07:52:30.000Z ERROR [Step11] confirmation read failed',
    ].join('\n');
    const out = sanitizeTailForReport(tail);
    if (out !== null) {
      expect(out).not.toContain('relayer accepted');
      expect(out).not.toContain('0xdeadbeef');
    }
  });

  it('drops a vote whose run began before the tail did', () => {
    const tail = [
      '2026-09-21T07:52:00.000Z LOG   [FreedomTool] Step11: Submitting vote...',
      '2026-09-21T07:52:10.000Z LOG   [flow] step → 12 (vote-submitted)',
    ].join('\n');
    expect(sanitizeTailForReport(tail)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tail lifecycle (item 7)
// ---------------------------------------------------------------------------

/** A fresh process: the logger module reloaded, the files kept. */
function relaunch(): typeof import('./logger') {
  let mod!: typeof import('./logger');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('./logger');
  });
  return mod;
}

async function tick(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  // Let the queued async file operations run.
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('the previous session is the previous session', () => {
  it('write A, relaunch, write B for more than 10 s: Settings exports A, not B', async () => {
    jest.useFakeTimers();
    // Session 1 writes A, and dies in the foreground (no marker).
    const s1 = relaunch();
    s1.__testing.push('log', 'LINE-A from session one');
    s1.startCrashTail();
    await tick(10_500);
    await s1.__testing.drainTail();
    s1.stopCrashTail();
    expect(memfs().get(CURRENT_TAIL)).toContain('LINE-A');

    // Session 2: rotation at launch, then B is written for > 10 s.
    const s2 = relaunch();
    await s2.rotateCrashTailAtLaunch();
    s2.__testing.push('log', 'LINE-B from session two');
    s2.startCrashTail();
    await tick(12_000);
    await s2.__testing.drainTail();
    s2.stopCrashTail();
    expect(memfs().get(CURRENT_TAIL)).toContain('LINE-B');

    const offered = await s2.readPreviousSessionLog();
    expect(offered).toContain('LINE-A');
    expect(offered).not.toContain('LINE-B');
  });

  it('a clean marker at launch deletes marker and previous tail', async () => {
    memfs().set(CURRENT_TAIL, '2026-09-22T08:00:00.000Z LOG   left in the background');
    await noteAppStateForCrashTail('background');
    expect(memfs().has(MARKER)).toBe(true);
    await rotateCrashTailAtLaunch();
    expect(memfs().has(MARKER)).toBe(false);
    expect(memfs().has(PREVIOUS_TAIL)).toBe(false);
    expect(await readPreviousSessionLog()).toBeNull();
  });

  it('coming back to the foreground removes the marker; inactive never writes one', async () => {
    await noteAppStateForCrashTail('inactive');
    expect(memfs().has(MARKER)).toBe(false);
    await noteAppStateForCrashTail('background');
    await noteAppStateForCrashTail('active');
    expect(memfs().has(MARKER)).toBe(false);
  });

  it('a death in the foreground keeps the offer', async () => {
    memfs().set(CURRENT_TAIL, '2026-09-22T08:00:00.000Z ERROR died during step 7');
    await rotateCrashTailAtLaunch();
    expect(await readPreviousSessionLog()).toContain('died during step 7');
  });
});

// ---------------------------------------------------------------------------
// Consent (item 1 j)
// ---------------------------------------------------------------------------

describe('the consent screen', () => {
  it('is shown before the mail composer, with the agreed text', async () => {
    const report = await prepareErrorReport(new Error('x'), {});
    expect(await sendErrorReport(report)).toBe(true);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message, buttons] = alertSpy.mock.calls[0];
    expect(message).toContain('sans votre carte, votre CAN ni votre vote');
    expect((buttons as AlertButton[]).map((b) => b.text)).toEqual(['Annuler', 'Envoyer']);
    expect(MailComposer.composeAsync).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.invocationCallOrder[0]).toBeLessThan(
      MailComposer.composeAsync.mock.invocationCallOrder[0],
    );
  });

  it('Cancel sends nothing, by mail or by the share sheet', async () => {
    consentAnswer = 'cancel';
    const report = await prepareErrorReport(new Error('x'), {});
    expect(await sendErrorReport(report)).toBe(false);
    MailComposer.isAvailableAsync.mockImplementation(async () => false);
    expect(await sendErrorReport(report)).toBe(false);
    expect(MailComposer.composeAsync).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('guards the share-sheet fallback too', async () => {
    MailComposer.isAvailableAsync.mockImplementation(async () => false);
    const report = await prepareErrorReport(new Error('x'), {});
    expect(await sendErrorReport(report)).toBe(true);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
  });

  it('is shown every time', async () => {
    const report = await prepareErrorReport(new Error('x'), {});
    await sendErrorReport(report);
    await sendErrorReport(report);
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it('says so when the beta attaches the unanonymised proof', async () => {
    Application.applicationId = 'app.referendumcitoyen.fr.beta';
    recordBetaArtifacts();
    const report = await prepareSuccessReport({ step: 12 });
    await sendErrorReport(report);
    expect(alertSpy.mock.calls[0][1]).toContain('non anonymisée');
  });

  it('Cancel in Settings keeps the previous-session log; Send consumes it', async () => {
    memfs().set(PREVIOUS_TAIL, '2026-09-22T08:00:00.000Z ERROR died during step 7');
    consentAnswer = 'cancel';
    expect(await sendPreviousSessionReport()).toBe('cancelled');
    expect(MailComposer.composeAsync).not.toHaveBeenCalled();
    expect(memfs().has(PREVIOUS_TAIL)).toBe(true);
    consentAnswer = 'send';
    expect(await sendPreviousSessionReport()).toBe('sent');
    expect(MailComposer.composeAsync).toHaveBeenCalledTimes(1);
    expect(memfs().has(PREVIOUS_TAIL)).toBe(false);
  });

  it('a composer dismissed without sending keeps the previous-session log', async () => {
    memfs().set(PREVIOUS_TAIL, '2026-09-22T08:00:00.000Z ERROR died during step 7');
    MailComposer.composeAsync.mockImplementation(async () => ({ status: 'cancelled' }));
    expect(await sendPreviousSessionReport()).toBe('cancelled');
    expect(memfs().has(PREVIOUS_TAIL)).toBe(true);
  });
});

describe('the locale texts', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fr = require('../locales/fr.json').errorReport;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const en = require('../locales/en.json').errorReport;

  it('carry the consent screen in both languages', () => {
    expect(fr.consentBody).toBe(
      "Ce rapport contient des informations techniques sur votre téléphone et le déroulement de l'application, sans votre carte, votre CAN ni votre vote. Le message est supprimé après traitement.",
    );
    expect(fr.consentSend).toBe('Envoyer');
    expect(fr.consentCancel).toBe('Annuler');
    for (const k of ['consentTitle', 'consentBody', 'consentBetaAttachment', 'consentSend', 'consentCancel']) {
      expect(typeof fr[k]).toBe('string');
      expect(typeof en[k]).toBe('string');
    }
  });

  // Item 1 (m): the mail body promised "no personal data" and "anonymised".
  it('no longer promise what the report cannot guarantee', () => {
    for (const body of [fr.body, en.body]) {
      expect(body).not.toMatch(/anonymi|Aucune donnée personnelle|No personal data/i);
      expect(body).not.toContain('—');
    }
    expect(fr.body).toContain('sans votre carte, votre CAN ni votre vote');
    expect(fr.body).toContain('supprimés après traitement');
  });
});

describe('closedCode', () => {
  it('passes only an exact code from the list', () => {
    const codes = ['SessionTimeout', 'SystemResourceUnavailable'] as const;
    expect(closedCode('SessionTimeout', codes)).toBe('SessionTimeout');
    expect(closedCode('SessionTimeout for CAN 483920', codes)).toBe('other');
    expect(closedCode({ x: 1 }, codes)).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// June parity (D-1, 22/09): no report may carry sensitive data that the June
// public release (commit 4349134, 15/06/2026) did not already carry.
// ---------------------------------------------------------------------------
//
// June's report was: a 5-line session header (App, Platform, Locale, Network,
// Time), an Error block, a Context block that printed EVERY field the caller
// passed, and five minutes of log lines each stamped with an absolute clock
// time to the millisecond. 2.0.2 sends far more technical detail than that,
// which is wanted; these tests pin the other half of the bargain, that none of
// the additions is an identifier and that June's own identifiers are gone.
//
// Each test names the June (or 2.0.1) field it is holding down. They run with
// the beta artifacts in memory wherever that is the harder case, because the
// beta build attaches an unredacted JSON and the text report must stay clean
// next to it.
describe('June parity: no sensitive field that June did not have', () => {
  /** The header block of a report file: everything before the first blank. */
  function headerKeys(text: string): string[] {
    const keys: string[] = [];
    for (const line of text.split('\n').slice(1)) {
      if (line.trim() === '') break;
      const m = /^([A-Za-z]+)\s*:/.exec(line);
      if (m) keys.push(m[1]);
    }
    return keys;
  }

  it('sends exactly the agreed header fields, and no new one slips in', async () => {
    recordBetaArtifacts();
    const report = await prepareErrorReport(new Error('x'), { step: 13 });
    expect(headerKeys(memfs().get(report.uri) as string)).toEqual([
      'App', 'Version', 'Commit', 'Bundle', 'Device',
      'Platform', 'Memory', 'Locale', 'Network', 'Flags', 'Time', 'Disk',
    ]);
  });

  // June: every log line carried `new Date(e.t).toISOString()` and the header
  // and the file name carried the millisecond too. That is what lets a report
  // be lined up against a VoteCast or a registration on chain.
  it('carries no absolute clock time, in any report kind, with artifacts present', async () => {
    Application.applicationId = 'app.referendumcitoyen.fr.beta';
    recordBetaArtifacts();
    logSecretsInEveryForm();
    // Each builder starts by clearing the cache directory, so read each file
    // before the next one is prepared.
    const made: Array<[string, string]> = [];
    const take = (r: { uri: string }) => made.push([r.uri, memfs().get(r.uri) as string]);
    take(await prepareErrorReport(new Error('x'), { step: 13 }));
    take(await prepareSuccessReport({ step: 12 }));
    // Handed in RAW, the hard case: an unsanitised tail must still lose its
    // clock times, not merely its hashes.
    take(
      await prepareRecoveredSessionReport(
        '2026-09-21T07:58:10.101Z LOG   [Step7] something\n2026-09-21T07:58:12.303Z LOG   [Step7] later',
      ),
    );
    expect(made).toHaveLength(3);
    for (const [uri, text] of made) {
      // No hh:mm:ss anywhere: the header stops at the minute, the lines are
      // offsets. (The artifacts JSON is not a text report and is exempt.)
      expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(uri).not.toMatch(/T\d{2}-\d{2}-\d{2}/);
      expect(text).toMatch(/Time {4}: \d{4}-\d{2}-\d{2}T\d{2}Z/);
    }
    // The recovered tail kept its durations: 2.202 s between the two lines.
    expect(made[2][1]).toContain('+00:02.202');
  });

  // June printed the resolved locale whole, region included. A rare region
  // tag is close to a per-phone identifier, so only the language goes out.
  it('carries no locale region', async () => {
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(() => ({ resolvedOptions: () => ({ locale: 'en-US' }) }) as unknown as Intl.DateTimeFormat);
    try {
      const report = await prepareErrorReport(new Error('x'), { step: 13 });
      const text = memfs().get(report.uri) as string;
      expect(text).toContain('Locale  : en');
      expect(text).not.toContain('en-US');
    } finally {
      spy.mockRestore();
    }
  });

  // June had no disk line at all, so every value here is data June never sent.
  // Below 10 GB the exact figure answers the only question asked of it (can
  // the ~1 GB of circuits land?); above it, a figure to the GB was ~500
  // distinguishable values, i.e. a per-phone fingerprint.
  it('bands the free disk above 10 GB and keeps the low range exact', () => {
    expect(freeDiskBand(0)).toBe('0 GB free');
    expect(freeDiskBand(0.2e9)).toBe('0 GB free');
    expect(freeDiskBand(0.7e9)).toBe('1 GB free');
    expect(freeDiskBand(4.9e9)).toBe('4 GB free');
    expect(freeDiskBand(9.7e9)).toBe('9 GB free');
    expect(freeDiskBand(10e9)).toBe('10-20 GB free');
    expect(freeDiskBand(19.9e9)).toBe('10-20 GB free');
    expect(freeDiskBand(37.64e9)).toBe('20-50 GB free');
    expect(freeDiskBand(63.69e9)).toBe('50-100 GB free');
    expect(freeDiskBand(240e9)).toBe('100+ GB free');
    expect(freeDiskBand(null)).toBe('unavailable');
    // Two phones of the same class are never told apart by this line.
    expect(freeDiskBand(63.69e9)).toBe(freeDiskBand(88.01e9));
  });

  // Context fields go through an allow-list: redacting the value alone would
  // hide the field name from the label rules. proposalId stays off it.
  it('writes only the allow-listed context fields, whatever the caller passes', async () => {
    Application.applicationId = 'app.referendumcitoyen.fr.beta';
    recordBetaArtifacts();
    const report = await prepareErrorReport(new Error('x'), {
      step: 13,
      network: 'mainnet',
      can: CAN,
      proposalId: '73',
      surname: SURNAME,
      documentNumber: DOC_NO,
      email: 'someone@example.org',
      deviceName: "Jean's iPhone",
    });
    const text = memfs().get(report.uri) as string;
    for (const key of ['can', 'proposalId', 'surname', 'documentNumber', 'email', 'deviceName']) {
      expect(text).not.toMatch(new RegExp(`^${key}:`, 'm'));
    }
    for (const value of [CAN, SURNAME, DOC_NO, 'someone@example.org', "Jean's iPhone"]) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain('step: 13');
    expect(text).toContain('network: mainnet');
    expect(text).toContain('not included)');
  });

  // A registration hash next to the sender's address would identify their
  // on-chain registration.
  it('carries no registration transaction hash, only the fact of one', async () => {
    __testing.push('log', `[registerViaNoir] relayer accepted ${loggableTxHash(HASH)}`);
    const report = await prepareErrorReport(new Error('x'), { step: 13 });
    const text = memfs().get(report.uri) as string;
    expect(text).not.toContain(HASH);
    expect(text).not.toContain(HASH.slice(2));
    expect(text).toContain('relayer accepted tx:<hex64>');
  });

  // Neither June nor 2.0.1 touched these; they are a stable id for one install
  // across every report it sends, and they arrive inside ordinary stack frames.
  it('carries no install identifier from a stack frame', async () => {
    const uuid = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const report = await prepareErrorReport(
      new Error(`boom at file:///var/mobile/Containers/Data/Application/${uuid}/Library/x.js`),
      { step: 13 },
    );
    const text = memfs().get(report.uri) as string;
    expect(text).not.toContain(uuid);
    expect(text).toContain('<uuid>');
  });

  // The one thing 2.0.2 sends that June had no equivalent for. It is gated on
  // the beta binary and announced in the consent screen; what must never drift
  // is that its values stay OUT of the text report and off production.
  it('keeps the beta artifacts out of the text report, and off PROD entirely', async () => {
    Application.applicationId = 'app.referendumcitoyen.fr.beta';
    recordBetaArtifacts();
    const beta = await prepareErrorReport(new Error('x'), { step: 13 });
    expect(beta.attachments).toHaveLength(2);
    const betaText = memfs().get(beta.uri) as string;
    for (const s of [HASH, HASH.slice(2), LONG_HEX, 'nullifier', 'identityKey', 'proofHex']) {
      expect(betaText).not.toContain(s);
    }
    // The JSON is the only place those values live, and it says so.
    const json = [...memfs().entries()].find(([k]) => k.endsWith('.json'))?.[1] as string;
    expect(json).toContain('Unredacted');

    memfs().clear();
    __testing.reset();
    Application.applicationId = 'app.referendumcitoyen.fr';
    recordBetaArtifacts();
    const prod = await prepareErrorReport(new Error('x'), { step: 13 });
    expect(prod.attachments).toHaveLength(1);
    expect([...memfs().keys()].some((k) => k.endsWith('.json'))).toBe(false);
  });

  // June put nothing about the person in the envelope; 2.0.2 must not either.
  // The envelope is readable by every mail relay without opening a file.
  it('puts nothing about the person or the phone in the error mail envelope', () => {
    // i18n is not initialised in this suite, so the translated middle comes
    // back empty; the envelope's SHAPE is what this test is about.
    const { subject, body } = reportEnvelope('error', '2.0.2', '30');
    expect(subject).toMatch(/^\[PROD\]\[iOS\] .* — v2\.0\.2 \(build 30\)$/);
    for (const text of [subject, body ?? '']) {
      expect(text).not.toMatch(/iPhone|Samsung|Pixel|GB|passeport|carte d'identité/);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});
