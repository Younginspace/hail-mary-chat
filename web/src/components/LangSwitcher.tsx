import { useLang } from '../i18n/LangContext';
import type { Lang } from '../i18n';

// Public language options. ja was hidden 2026-04-29 because no
// Japanese users had registered (0 sessions in lang='ja' across the
// whole user base) — the option was real estate that nobody used and
// took attention away from zh/en. The full ja translation set is
// retained in i18n/index.ts in case we re-enable later (re-add the
// entry below + ship). The Lang type itself still includes 'ja' so
// any user with lang persisted to localStorage from a previous build
// keeps their setting; the UI just hides the toggle.
const LANGS: { key: Lang; label: string }[] = [
  { key: 'zh', label: '中' },
  { key: 'en', label: 'EN' },
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
