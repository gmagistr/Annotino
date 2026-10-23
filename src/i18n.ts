import { useSyncExternalStore } from 'react';
import { IT } from './i18n.it';

/**
 * English strings are the keys; other languages map them to translations.
 * `t('Hello {name}', { name })` interpolates `{name}`.
 */

export type Lang = 'en' | 'it';

const LANG_KEY = 'annotino.lang';
const dictionaries: Record<Lang, Record<string, string>> = { en: {}, it: IT };

function initial(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'en' || stored === 'it') return stored;
  return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en';
}

let lang: Lang = initial();
const listeners = new Set<() => void>();
document.documentElement.lang = lang;

export function setLang(l: Lang) {
  lang = l;
  localStorage.setItem(LANG_KEY, l);
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function getLang(): Lang {
  return lang;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Re-render on language change. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}
