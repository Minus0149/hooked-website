import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectLang, isLang, translate, type Lang } from "./i18n";

/**
 * The app's language, per browser.
 *
 * Stored on this device only ("hooked.lang"): "auto" follows the browser, and
 * an explicit pick sticks. Not synced to the account on purpose — the same
 * person can reasonably want Hindi on the phone and English on a work laptop.
 */
const KEY = "hooked.lang";
export type LangSetting = Lang | "auto";

type LangValue = {
  lang: Lang;
  setting: LangSetting;
  setLang: (s: LangSetting) => void;
  t: (text: string, vars?: Record<string, string | number>) => string;
};

const LangContext = createContext<LangValue | null>(null);

function browserLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  return detectLang(navigator.languages?.length ? navigator.languages : navigator.language);
}

function readSetting(): LangSetting {
  try {
    const v = localStorage.getItem(KEY);
    return isLang(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<LangSetting>(readSetting);
  const lang: Lang = setting === "auto" ? browserLang() : setting;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((s: LangSetting) => {
    setSetting(s);
    try {
      if (s === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, s);
    } catch {
      /* private mode: the choice lasts this session */
    }
  }, []);

  const value = useMemo<LangValue>(
    () => ({ lang, setting, setLang, t: (text, vars) => translate(lang, text, vars) }),
    [lang, setting, setLang],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** The translator for the current language. Outside a provider it is English. */
export function useLang(): LangValue {
  return (
    useContext(LangContext) ?? {
      lang: "en",
      setting: "auto",
      setLang: () => undefined,
      t: (text, vars) => translate("en", text, vars),
    }
  );
}

export function useT() {
  return useLang().t;
}
