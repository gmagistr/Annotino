import { setLang, useLang } from '../i18n';

export function LangSwitch() {
  const lang = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
      <button type="button" aria-pressed={lang === 'it'} onClick={() => setLang('it')}>Italiano</button>
    </div>
  );
}
