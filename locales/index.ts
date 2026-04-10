import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const frModule = require('./fr.json');
const fr = frModule?.default || frModule;

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
  },
  lng: 'fr',
  fallbackLng: 'fr',
  supportedLngs: ['fr'],
  interpolation: {
    escapeValue: false,
  },
});

export const supportedLanguages = ['fr'];
export const getCurrentLanguageCode = () => 'fr';

export default i18n;
