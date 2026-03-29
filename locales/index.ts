import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_STORAGE_KEY = 'app_language';

type TranslationResource = { translation: Record<string, unknown> };
type ResourcesMap = Record<string, TranslationResource>;

const getLocaleContext = () => {
  const maybeContext = (require as any).context;
  if (typeof maybeContext !== 'function') {
    return null;
  }
  try {
    return maybeContext('./', false, /\.json$/);
  } catch (_error) {
    // Metro can expose require.context but throw when the experimental feature
    // is not enabled. Fallback to static locales in that case.
    return null;
  }
};

const loadResources = (): ResourcesMap => {
  const context = getLocaleContext();

  if (!context) {
    const enModule = require('./en.json');
    const frModule = require('./fr.json');
    const deModule = require('./de.json');
    const itModule = require('./it.json');
    const nlModule = require('./nl.json');
    const plModule = require('./pl.json');
    const esModule = require('./es.json');
    const en = enModule?.default || enModule;
    const fr = frModule?.default || frModule;
    const de = deModule?.default || deModule;
    const it = itModule?.default || itModule;
    const nl = nlModule?.default || nlModule;
    const pl = plModule?.default || plModule;
    const es = esModule?.default || esModule;
    return {
      en: { translation: en },
      fr: { translation: fr },
      de: { translation: de },
      it: { translation: it },
      nl: { translation: nl },
      pl: { translation: pl },
      es: { translation: es },
    };
  }

  return context.keys().reduce((acc: ResourcesMap, key: string) => {
    const langCode = key.replace('./', '').replace('.json', '').toLowerCase();
    const localeModule = context(key);
    acc[langCode] = { translation: localeModule?.default || localeModule };
    return acc;
  }, {});
};

const resources = loadResources();

const normalizeLang = (lang?: string | null) => (lang || '').toLowerCase().split('-')[0];

const findSupportedLanguage = (inputLang?: string | null) => {
  const normalized = normalizeLang(inputLang);
  const supported = Object.keys(resources);

  if (!normalized) return null;
  if (supported.includes(normalized)) return normalized;
  return null;
};

const getDefaultLanguage = () => {
  const phoneLang = getLocales?.()?.[0]?.languageCode || getLocales?.()?.[0]?.languageTag;
  return findSupportedLanguage(phoneLang) || 'en';
};

const fallbackOrder = ['en', 'fr'];

i18n.use(initReactI18next).init({
  resources,
  lng: getDefaultLanguage(),
  fallbackLng: fallbackOrder,
  supportedLngs: Object.keys(resources),
  interpolation: {
    escapeValue: false,
  },
});

export const languageReady: Promise<void> = AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
  .then((storedLang) => {
    const supportedStoredLang = findSupportedLanguage(storedLang);
    if (supportedStoredLang && supportedStoredLang !== i18n.language) {
      i18n.changeLanguage(supportedStoredLang);
    }
  })
  .catch(() => {
    // Ignore read errors; fallback language is already set.
  });

i18n.on('languageChanged', (lang) => {
  const normalized = normalizeLang(lang);
  AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, normalized).catch(() => {
    // Ignore persistence errors.
  });
});

export const supportedLanguages = Object.keys(resources);
export const getCurrentLanguageCode = () => normalizeLang(i18n.resolvedLanguage || i18n.language) || 'en';

export default i18n;
