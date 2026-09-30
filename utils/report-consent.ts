import { Alert } from 'react-native';
import i18n from 'i18next';

/**
 * The consent screen shown before every report leaves the phone (item 1 j).
 *
 * Why: no filter can promise that a log holds nothing identifying (team
 * call of 21/09), so the person sending it is told, in plain words and
 * every time, what it contains and what happens to it, and chooses. Reports
 * were already only ever sent on a tap; this makes the tap an informed one.
 *
 * A native alert rather than a screen of our own: it works the same over
 * every native build an OTA can land on, sits above the modal stacks the
 * report buttons live in (voting flow, root error boundary), and needs no
 * navigation. Resolves true on "Envoyer" only. "Annuler", a tap outside the
 * alert (Android) or any failure to show it resolve false: nothing is sent.
 *
 * `betaAttachment`: the beta app attaches the vote artifacts JSON (proof and
 * public signals, not anonymised) for the test team. The sentence above
 * would be untrue for that file, so the beta alert says so too.
 */
/** A translation, or the French text when the key does not resolve (i18n not
 *  ready, or a bundle that predates the key): never a raw key, never blank. */
function tr(key: string, fallback: string): string {
  try {
    const v = i18n.t(key, { defaultValue: fallback });
    return typeof v === 'string' && v.length > 0 && v !== key ? v : fallback;
  } catch {
    return fallback;
  }
}

export function confirmReportConsent(opts: { betaAttachment?: boolean } = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const body = tr(
        'errorReport.consentBody',
        "Ce rapport contient des informations techniques sur votre téléphone et le déroulement de l'application, sans votre carte, votre CAN ni votre vote. Le message est supprimé après traitement.",
      );
      const beta = opts.betaAttachment
        ? '\n\n' +
          tr(
            'errorReport.consentBetaAttachment',
            "Version de test : une pièce jointe contient aussi la preuve de vote de ce test, non anonymisée, pour l'équipe technique.",
          )
        : '';
      Alert.alert(
        tr('errorReport.consentTitle', 'Envoyer un rapport ?'),
        body + beta,
        [
          {
            text: tr('errorReport.consentCancel', 'Annuler'),
            style: 'cancel',
            onPress: () => done(false),
          },
          {
            text: tr('errorReport.consentSend', 'Envoyer'),
            onPress: () => done(true),
          },
        ],
        { cancelable: true, onDismiss: () => done(false) },
      );
    } catch {
      done(false);
    }
  });
}

/**
 * Told, rather than dropped: a report built before a vote-trace purge cannot
 * be sent, and the person who tapped Send has to learn that from somewhere.
 *
 * The refusal itself is right. R8 purges a vote flow's lines from the buffer
 * the moment the ballot may be on chain, and a report prepared before that
 * purge still carries them, so it is refused at the door
 * (utils/error-reporter.ts). What was wrong was the silence: `sendErrorReport`
 * returned false without a word, the consent alert never even appeared, and
 * from the outside tapping "Envoyer" did nothing at all. Twice in a row, on a
 * screen whose entire purpose is to send something.
 *
 * So the same native alert says what happened, in plain French, and what to
 * do: the vote has just been recorded and its lines were removed, so this
 * report no longer exists and a new one has to be started. One button, because
 * there is nothing to choose.
 */
export function notifyReportExpired(): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      Alert.alert(
        tr('errorReport.expiredTitle', "Ce rapport n'est plus disponible"),
        tr(
          'errorReport.expiredBody',
          "Votre vote vient d'être enregistré, et les lignes du vote ont été effacées du journal pour qu'il ne soit pas possible de relier ce rapport à votre bulletin. Le rapport préparé avant cet effacement ne peut donc plus être envoyé. Touchez de nouveau le bouton de rapport pour en créer un nouveau.",
        ),
        [{ text: tr('errorReport.expiredOk', "J'ai compris"), onPress: done }],
        { onDismiss: done },
      );
    } catch {
      done();
    }
  });
}
