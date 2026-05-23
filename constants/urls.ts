// Externally-hosted pages linked from the app. Centralised so domain or
// path changes are a one-line edit.
export const LEGAL_URLS = {
  privacyPolicy: 'https://referendumcitoyen.fr/politique-de-confidentialite',
  termsAndConditions: 'https://referendumcitoyen.fr/conditions-generales',
} as const;

export const CONTACT_EMAIL = 'referendumcitoyen@proton.me';

// Address used for developer error reports triggered from the in-app
// "Envoyer un rapport d'erreur" button. Separate from CONTACT_EMAIL so the
// public contact alias is unaffected if we move the dev mailbox.
export const ERROR_REPORT_EMAIL = 'alexis+referendum@roussel-zeter.eu';
