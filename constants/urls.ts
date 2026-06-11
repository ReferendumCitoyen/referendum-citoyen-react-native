// Externally-hosted pages linked from the app. Centralised so domain or
// path changes are a one-line edit.
export const LEGAL_URLS = {
  privacyPolicy: 'https://referendumcitoyen.fr/politique-confidentialite',
  termsAndConditions: 'https://referendumcitoyen.fr/conditions-generales',
} as const;

// Per-referendum info pages on the public website. The app builds the URL
// from the on-chain proposal id; the website forwards /referendums/<id> to
// the correct referendum page (e.g. /referendums/52 → ZFE). Linked per-vote
// from the home screen ("En savoir plus").
export const REFERENDUMS_BASE_URL = 'https://referendumcitoyen.fr/referendums/';
export const referendumInfoUrl = (proposalId: string | number): string =>
  `${REFERENDUMS_BASE_URL}${proposalId}`;

export const CONTACT_EMAIL = 'referendumcitoyen@proton.me';

// Address used for developer error reports triggered from the in-app
// "Envoyer un rapport d'erreur" button. Separate from CONTACT_EMAIL so the
// public contact alias is unaffected if we move the dev mailbox.
export const ERROR_REPORT_EMAIL = 'alexis+referendum@roussel-zeter.eu';
