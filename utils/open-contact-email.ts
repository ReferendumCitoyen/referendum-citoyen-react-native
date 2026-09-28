/**
 * Opens the user's mail client pre-filled to contact us, with the non-PII debug
 * footer (version, build, device, OS, locale, network, OTA) so support mail
 * carries enough context to triage — e.g. spotting a reporter on an
 * already-fixed build.
 *
 * Lifted out of app/parametres.tsx so the post-vote screen can offer the same
 * action without a second copy of the composer/mailto fallback drifting away
 * from the first.
 */

import * as MailComposer from 'expo-mail-composer';
import { Linking } from 'react-native';
import type { TFunction } from 'i18next';
import { CONTACT_EMAIL } from '@/constants/urls';
import { getContactInfoVars } from '@/utils/contact-info';

export async function openContactEmail(t: TFunction): Promise<void> {
  const vars = getContactInfoVars();
  const subject = t('settings.contactSubject', vars);
  const body = t('settings.contactBody', vars);
  try {
    if (await MailComposer.isAvailableAsync()) {
      await MailComposer.composeAsync({ recipients: [CONTACT_EMAIL], subject, body });
      return;
    }
  } catch {
    // fall through to the mailto: fallback below
  }
  Linking.openURL(
    `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  );
}
