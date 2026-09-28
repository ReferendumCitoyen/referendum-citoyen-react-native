import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// The multilingual scaffolding (i18next, language picker, per-locale JSON)
// stays in place so adding a language is `npm install … && add a JSON file`,
// but only French and English are shipped today — see the 2026-05-22
// scope-down. French stays the boot default; missing keys in `en` fall
// back to `fr` via i18next's standard fallback chain.
const frModule = require('./fr.json');
const fr = frModule?.default || frModule;
const enModule = require('./en.json');
const en = enModule?.default || enModule;

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: 'fr',
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  interpolation: {
    escapeValue: false,
  },
});

export const supportedLanguages = ['fr', 'en'];

/** Current UI language code as i18next sees it. Falls back to 'fr' if i18n
 * hasn't initialised yet (e.g. very early in the React tree). */
export const getCurrentLanguageCode = (): string =>
  (i18n.language as string | undefined) || 'fr';

export default i18n;
