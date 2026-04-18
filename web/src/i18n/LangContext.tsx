import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Lang } from './index';

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LANG_STORAGE_KEY = 'rocky.lang';
const VALID_LANGS: Lang[] = ['zh', 'en', 'ja'];

function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && (VALID_LANGS as string[]).includes(saved)) return saved as Lang;
  } catch {
    // localStorage unavailable (private mode, SSR, etc.) — fall through.
  }
  return 'en';
}

const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      // ignore — in-memory state is still correct for this session
    }
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
