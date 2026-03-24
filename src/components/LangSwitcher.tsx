import { useLang } from '../i18n/LangContext';
import type { Lang } from '../i18n';

const LANGS: { key: Lang; label: string }[] = [
  { key: 'zh', label: '中' },
  { key: 'en', label: 'EN' },
  { key: 'ja', label: '日' },
];

export default function LangSwitcher() {
  const { lang, setLang } = useLang();

  return (
    <div className="lang-switcher">
      {LANGS.map((l) => (
        <button
          key={l.key}
          className={`lang-btn ${lang === l.key ? 'lang-active' : ''}`}
          onClick={() => setLang(l.key)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
