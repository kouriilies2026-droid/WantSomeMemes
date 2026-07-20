const STORAGE_KEY = 'wantSomeMemesLang';

const LANGUAGES = {
  en: { label: 'EN', dir: 'ltr', full: 'English' },
  ar: { label: 'ع', dir: 'rtl', full: 'العربية' }
};

export function getLanguage() {
  try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch (e) { return 'en'; }
}

export function setLanguage(lang) {
  if (!LANGUAGES[lang]) return;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  applyLanguage(lang);
}

export function applyLanguage(lang) {
  const cfg = LANGUAGES[lang];
  if (!cfg) return;
  document.documentElement.lang = lang;
  document.documentElement.dir = cfg.dir;
}

export function getCurrentConfig() {
  return LANGUAGES[getLanguage()] || LANGUAGES.en;
}

export function createLangToggle() {
  const current = getLanguage();
  const toggle = document.createElement('button');
  toggle.id = 'langToggle';
  toggle.textContent = LANGUAGES[current].label;
  toggle.className = 'lang-toggle-btn';
  toggle.setAttribute('title', 'Switch language / تبديل اللغة');
  toggle.addEventListener('click', () => {
    const next = getLanguage() === 'en' ? 'ar' : 'en';
    setLanguage(next);
    toggle.textContent = LANGUAGES[next].label;
  });
  return toggle;
}

export function initLanguage() {
  const lang = getLanguage();
  applyLanguage(lang);
}

export { LANGUAGES };
