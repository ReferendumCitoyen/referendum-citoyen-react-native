/**
 * A report prepared before a vote-trace purge is refused, and the person who
 * tapped Send is told why (wave 2b, section 4, point 2).
 *
 * The refusal is right and stays: R8 purges a vote flow's lines the moment the
 * ballot may be on chain, and a report built before that purge still carries
 * them. What was wrong was the silence. `sendErrorReport` returned false
 * without a word, the consent alert never appeared, and from the outside
 * tapping "Envoyer" did nothing at all, on a screen whose entire purpose is to
 * send something. The natural reading is that the app is broken.
 */
import { Alert } from 'react-native';
import { sendErrorReport } from '@/utils/error-reporter';
import { notifyReportExpired } from '@/utils/report-consent';
import { currentPurgeGeneration } from '@/utils/logger';
import fr from '@/locales/fr.json';
import en from '@/locales/en.json';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '2.0.2', nativeBuildVersion: '1' }));
jest.mock('expo-mail-composer', () => ({
  isAvailableAsync: jest.fn(async () => true),
  composeAsync: jest.fn(async () => ({ status: 'sent' })),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** Press the first button of whatever Alert was raised. */
function autoDismissAlerts(): jest.SpyInstance {
  return jest.spyOn(Alert, 'alert').mockImplementation(((_t: string, _m: string, buttons: any[]) => {
    buttons?.[0]?.onPress?.();
  }) as never);
}

const staleReport = {
  uri: 'file:///tmp/report.txt',
  errorMessage: 'boom',
  attachments: ['file:///tmp/report.txt'],
  kind: 'error' as const,
  // Built one purge ago: the vote lines it holds are gone from the buffer.
  generation: currentPurgeGeneration() - 1,
};

afterEach(() => jest.restoreAllMocks());

describe('a report built before a purge', () => {
  it('is still refused: the purge is not weakened', async () => {
    autoDismissAlerts();
    await expect(sendErrorReport(staleReport)).resolves.toBe(false);
  });

  it('never reaches the mail composer', async () => {
    autoDismissAlerts();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mail = require('expo-mail-composer');
    await sendErrorReport(staleReport);
    expect(mail.composeAsync).not.toHaveBeenCalled();
  });

  it('but the person is told, instead of nothing happening', async () => {
    const alert = autoDismissAlerts();
    await sendErrorReport(staleReport);
    expect(alert).toHaveBeenCalled();
    const [title, body] = alert.mock.calls[0];
    expect(String(title)).toBe(fr.errorReport.expiredTitle);
    expect(String(body)).toBe(fr.errorReport.expiredBody);
  });

  it('and the consent alert is not the one that was shown', async () => {
    const alert = autoDismissAlerts();
    await sendErrorReport(staleReport);
    // One alert only, and it is the refusal, not the consent screen.
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0][1])).not.toContain('Ce rapport contient');
  });
});

describe('a current report is untouched', () => {
  it('still goes through consent and out', async () => {
    autoDismissAlerts(); // first button of the consent alert is Annuler…
    const fresh = { ...staleReport, generation: currentPurgeGeneration() };
    // …so this resolves false through CANCELLATION, not through the purge
    // check: what matters is that the expiry notice is not what was shown.
    const alert = jest.spyOn(Alert, 'alert');
    await sendErrorReport(fresh);
    const titles = alert.mock.calls.map((c) => String(c[0]));
    expect(titles).not.toContain(fr.errorReport.expiredTitle);
  });

  it('a report with no generation at all is never refused for this reason', async () => {
    const alert = autoDismissAlerts();
    const { generation: _drop, ...noGeneration } = staleReport;
    await sendErrorReport(noGeneration);
    const titles = alert.mock.calls.map((c) => String(c[0]));
    expect(titles).not.toContain(fr.errorReport.expiredTitle);
  });
});

describe('what the notice says', () => {
  it('exists in both locales', () => {
    for (const dict of [fr, en]) {
      expect(typeof dict.errorReport.expiredTitle).toBe('string');
      expect(typeof dict.errorReport.expiredBody).toBe('string');
      expect(typeof dict.errorReport.expiredOk).toBe('string');
    }
  });

  it('says why, in plain French, without naming the mechanism', () => {
    const body = fr.errorReport.expiredBody;
    expect(body).toMatch(/vote vient d'être enregistré/);
    expect(body).toMatch(/effac/);
    expect(body).toMatch(/bulletin/);
    for (const jargon of ['purge', 'generation', 'buffer', 'R8', 'AsyncStorage']) {
      expect(body).not.toContain(jargon);
    }
  });

  it('says what to do next, which is the part that unblocks the person', () => {
    expect(fr.errorReport.expiredBody).toMatch(/[Tt]ouchez de nouveau/);
    expect(en.errorReport.expiredBody).toMatch(/[Tt]ap the report button again/);
  });

  it('carries no em dash', () => {
    for (const dict of [fr, en]) {
      expect(dict.errorReport.expiredBody).not.toContain('—');
    }
  });
});

describe('the notice on its own', () => {
  it('resolves even when the alert cannot be shown', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((() => {
      throw new Error('no UI');
    }) as never);
    await expect(notifyReportExpired()).resolves.toBeUndefined();
  });

  it('resolves once, whatever the alert does', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(((_t: string, _m: string, buttons: any[], opts: any) => {
      buttons?.[0]?.onPress?.();
      opts?.onDismiss?.();
    }) as never);
    await expect(notifyReportExpired()).resolves.toBeUndefined();
  });
});
