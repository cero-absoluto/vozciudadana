import { createI18n } from 'vue-i18n';
import es from './locales/es.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';

const SUPPORTED = ['es', 'en', 'fr', 'zh'];

function detectLocale() {
  const saved = localStorage.getItem('vc_lang');
  if (saved && SUPPORTED.includes(saved)) return saved;
  const browser = navigator.language?.split('-')[0];
  return SUPPORTED.includes(browser) ? browser : 'es';
}

const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'es',
  messages: { es, en, fr, zh },
});

export default i18n;
