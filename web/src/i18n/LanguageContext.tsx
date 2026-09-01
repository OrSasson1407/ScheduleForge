/**
 * The React side of the bilingual feature: `LanguageProvider` subscribes to
 * `translate.ts`'s one piece of real state so the tree re-renders when it
 * changes, and every component reads it through `useTranslation()` instead of
 * a `language` prop threaded down from `App` - a language choice is a
 * cross-cutting concern exactly like the day/night theme already is, and
 * prop-drilling it through every screen would make every screen's props about
 * something none of them are actually for.
 *
 * The state itself, the lookup, and `document.documentElement`'s `lang`/`dir`
 * live in `translate.ts`, on purpose: code with no React tree to sit in (a
 * data file parser, the scheduler, the search's own summary) needs the exact
 * same translated strings this context hands out, and cannot call a hook to
 * get them.
 */

import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Language, directionOf, getLanguage, onLanguageChange, setLanguage, translate } from "./translate";
import { TranslationKey, TranslationParams } from "./types";

export type { Language };

export interface LanguageContextValue {
  language: Language;
  /** "rtl" for Hebrew, "ltr" for English - already applied to `document.documentElement`, offered here too for a component that lays itself out by hand (`WeekCalendar`'s day order, say) rather than through ordinary CSS flow. */
  dir: "ltr" | "rtl";
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  /** Looks up a key in the active dictionary; `params` fills any `{{token}}` the string carries. */
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getLanguage);

  // `setLanguage` (translate.ts) may also be called from outside the React
  // tree entirely - there is none, for a parser - so the provider does not
  // own the state, it only mirrors it, and this is how it learns of a change
  // it did not itself request.
  useEffect(() => onLanguageChange(setLanguageState), []);

  const value = useMemo<LanguageContextValue>(() => {
    return {
      language,
      dir: directionOf(language),
      setLanguage,
      toggleLanguage: () => setLanguage(language === "en" ? "he" : "en"),
      t: translate,
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The one hook every component reads the active language and its strings through. */
export function useTranslation(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useTranslation() was called outside a <LanguageProvider>");
  }
  return context;
}
