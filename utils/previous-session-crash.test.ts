/**
 * REG-9: a crash in the seconds after a vote must still leave something to
 * send to support, without keeping the ballot.
 *
 * 2.0.1 sent the previous session's file as it was, vote lines included.
 * 2.0.2 rewrote that path properly (rotation at launch, a clean-exit marker,
 * a sanitised tail) and, in the sanitiser, dropped any vote flow that had sent
 * a ballot WHOLE. That was the safe first cut and it had a perverse effect:
 * the single most interesting case for support, an app that disappears just
 * after a vote, became exactly the case that left nothing at all. When the
 * whole tail was inside that flow the function returned null, and the line
 * "envoyer le journal de la session précédente" never appeared in Settings.
 *
 * What R8 protects is the ballot and the ability to line a report up against a
 * public transaction. Neither of those lives in the stack trace of a crash
 * that happened afterwards. So the cut moved from "the whole flow" to
 * "everything through the vote", and the errors that followed survive, floored
 * to the minute.
 *
 * Both halves are pinned here: the crash comes back, and nothing about the
 * ballot does.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { sanitizeTailForReport, VOTE_TRACE_REMOVED_NOTE } from '@/utils/logger';

const T = (s: number) => new Date(Date.UTC(2026, 8, 23, 4, 30, s)).toISOString();

/** A session that voted, then died in the native layer three seconds later. */
const TAIL_CRASH_AFTER_VOTE = [
  `${T(1)} LOG [flow] step → 1 (focus-reset)`,
  `${T(2)} LOG [flow] step → 11 (vote)`,
  `${T(3)} LOG [FreedomTool] Step11: Vote TX hash: 0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface`,
  `${T(4)} LOG [flow] step → 12 (vote-submitted)`,
  `${T(6)} ERROR Fatal Exception: java.lang.UnsatisfiedLinkError: dlopen failed: libnoir_java.so`,
  `${T(6)} ERROR   at com.rarime.noir.NoirModule.setupSrs(NoirModule.kt:41)`,
  `${T(7)} WARN  [device] low memory before the crash`,
].join('\n');

describe('the crash after a vote survives', () => {
  const out = sanitizeTailForReport(TAIL_CRASH_AFTER_VOTE);

  it('there is something to send at all', () => {
    expect(out).not.toBeNull();
    expect((out as string).length).toBeGreaterThan(0);
  });

  it('and it is the crash, which is the whole reason the tail exists', () => {
    expect(out).toContain('UnsatisfiedLinkError');
    expect(out).toContain('libnoir_java.so');
    expect(out).toContain('NoirModule.setupSrs');
  });

  it('a warning that frames the crash survives too', () => {
    expect(out).toContain('low memory before the crash');
  });

  it('and support is told the tail was cut, so it is not read as complete', () => {
    expect(out).toContain(VOTE_TRACE_REMOVED_NOTE);
  });
});

describe('and the ballot does not', () => {
  const out = sanitizeTailForReport(TAIL_CRASH_AFTER_VOTE) as string;

  it('no transaction id, in any form', () => {
    expect(out).not.toContain('feedface');
    expect(out.toLowerCase()).not.toContain('vote tx hash');
  });

  it('no line of the vote flow itself', () => {
    expect(out).not.toContain('step → 11');
    expect(out).not.toContain('vote-submitted');
  });

  it('nothing is timed finer than the minute after the vote', () => {
    // Offsets are computed from the first kept line, and every kept line of a
    // voted flow is floored to the minute, so no sub-minute figure can line a
    // report up against a block timestamp.
    const offsets = [...out.matchAll(/^\+(\d{2}):(\d{2})\.(\d{3})/gm)];
    expect(offsets.length).toBeGreaterThan(0);
    for (const m of offsets) {
      expect(`${m[2]}.${m[3]}`).toBe('00.000');
    }
  });
});

describe('what the change does not touch', () => {
  it('a flow that never sent a vote is kept whole, as before', () => {
    const tail = [
      `${T(1)} LOG [flow] step → 1 (focus-reset)`,
      `${T(2)} LOG [flow] step → 7 (verify)`,
      `${T(3)} ERROR [Step7] Verification error: relayer 500`,
    ].join('\n');
    const out = sanitizeTailForReport(tail) as string;
    expect(out).toContain('step → 7');
    expect(out).toContain('relayer 500');
    expect(out).not.toContain(VOTE_TRACE_REMOVED_NOTE);
  });

  it('a voted flow with nothing after it still yields nothing from that flow', () => {
    // No crash, no error: there is no diagnosis to keep, so none is kept.
    const tail = [
      `${T(1)} LOG [flow] step → 1 (focus-reset)`,
      `${T(3)} LOG [FreedomTool] Step11: Vote TX hash: 0xabc`,
      `${T(4)} LOG [flow] step → 12 (vote-submitted)`,
    ].join('\n');
    expect(sanitizeTailForReport(tail)).toBeNull();
  });

  it('a voted flow followed only by narration keeps none of it', () => {
    const tail = [
      `${T(1)} LOG [flow] step → 1 (focus-reset)`,
      `${T(3)} LOG [flow] step → 12 (vote-submitted)`,
      `${T(5)} LOG [flow] step → 12 (success)`,
      `${T(6)} LOG [Step12] backup card shown`,
    ].join('\n');
    expect(sanitizeTailForReport(tail)).toBeNull();
  });

  it('an earlier clean flow survives alongside a later voted one', () => {
    const tail = [
      `${T(1)} LOG [flow] step → 1 (focus-reset)`,
      `${T(2)} ERROR [Step6] scan cancelled`,
      `${T(10)} LOG [flow] step → 1 (focus-reset)`,
      `${T(12)} LOG [flow] step → 12 (vote-submitted)`,
      `${T(14)} ERROR Fatal Exception: SIGSEGV`,
    ].join('\n');
    const out = sanitizeTailForReport(tail) as string;
    expect(out).toContain('scan cancelled');
    expect(out).toContain('SIGSEGV');
    expect(out).not.toContain('vote-submitted');
  });

  it('the redactor still runs on what survives', () => {
    const tail = [
      `${T(1)} LOG [flow] step → 1 (focus-reset)`,
      `${T(3)} LOG [flow] step → 12 (vote-submitted)`,
      `${T(6)} ERROR crash while reading ${'ab'.repeat(32)}`,
    ].join('\n');
    const out = sanitizeTailForReport(tail) as string;
    expect(out).toContain('crash while reading');
    expect(out).not.toContain('ab'.repeat(32));
  });
});
