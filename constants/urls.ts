// Externally-hosted pages linked from the app. Centralised so domain or
// path changes are a one-line edit.
//
// Every link to the site carries `?src=app`, so the site can count what
// arrives from the app. It says where a tap came from and nothing else: no
// identifier of any kind rides along, so nothing on the site can be tied to
// a vote. Links open in the system browser (Linking.openURL); the app never
// hosts a form, a payment or an e-mail field itself.
const SITE = 'https://referendumcitoyen.fr';
const fromApp = (path: string): string => `${SITE}/${path}?src=app`;

export const LEGAL_URLS = {
  privacyPolicy: fromApp('politique-confidentialite'),
  termsAndConditions: fromApp('conditions-generales'),
} as const;

// Per-referendum info pages on the public website. The app builds the URL
// from the on-chain proposal id — the site has a page per id
// (/referendums/52 → ZFE) — or, when the signed index names one, from the
// page's own slug (`pages` in public-data/proposals.json:
// /referendums/plan-marianne for the main question). Linked per-vote from
// the home screen ("En savoir plus"), and — for a closed question — as
// "Signer la pétition", which lands on the same page.
export const REFERENDUMS_BASE_URL = `${SITE}/referendums/`;
export const referendumInfoUrl = (idOrPage: string | number): string =>
  `${REFERENDUMS_BASE_URL}${idOrPage}?src=app`;
export const petitionUrl = referendumInfoUrl;

// Linked from the Comprendre header as "Qui sommes-nous ?".
export const ABOUT_URL = fromApp('a-propos');

// The Contribuer tab and the after-vote card. A plain link: no payment in
// the app (App Store rules), nothing about the vote travels with it.
export const CONTRIBUTE_URL = fromApp('contribuer.html');

// "Pétitions en cours" page → the site's petitions, signed with an e-mail
// address, without the app.
export const PETITIONS_URL = fromApp('petitions.html');

// "Rester informé" → the newsletter sign-up, on the site only: the app never
// asks for or stores an e-mail address.
export const NEWSLETTER_URL = fromApp('newsletter.html');

export const CONTACT_EMAIL = 'referendumcitoyen@proton.me';

// Address used for developer error reports triggered from the in-app
// "Envoyer un rapport d'erreur" button. Separate from CONTACT_EMAIL so the
// public contact alias is unaffected if we move the dev mailbox.
export const ERROR_REPORT_EMAIL = 'referendumcitoyen@proton.me';
