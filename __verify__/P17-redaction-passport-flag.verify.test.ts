/**
 * P17: the missing-data watchdog line must keep the `passport` boolean.
 * Replays the exact line Step 7 logs (both BASE and candidate spell it
 * `passport=${bool}`), through the logger's redaction.
 */
import { redact } from '@/utils/logger';

describe('P17: redaction keeps the passport flag of the missing-data line', () => {
  it.each([true, false])('keeps passport=%s readable', (flag) => {
    const line = `[Step7] missing-data timeout (30s) — refs never arrived (rarime=false, passport=${flag})`;
    const out = redact(line);
    expect(out).toContain(`passport=${flag}`);
    expect(out).not.toContain('<redacted>');
  });

  it('still hides a real passport value', () => {
    const out = redact('passport=12AB34567');
    expect(out).not.toContain('12AB34567');
  });
});
