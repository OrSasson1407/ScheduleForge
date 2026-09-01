/**
 * The language switch in the header, next to the day/night toggle it is
 * visually paired with (`App.tsx`) - the two are the same kind of control:
 * one button, one piece of global, persisted state, no menu to open.
 */

import { useTranslation } from "../i18n/LanguageContext";

/**
 * The name of the *other* language, written in its own script - "עברית" is
 * never itself translated, the way a real language switcher never translates
 * "Deutsch" into "German" for an English reader. It just needs to be found.
 */
const OTHER_LANGUAGE_LABEL = { en: "עברית", he: "EN" } as const;

export function LanguageToggle() {
  const { language, toggleLanguage, t } = useTranslation();
  const title = language === "en" ? t("language.switchToHebrew") : t("language.switchToEnglish");

  return (
    <button type="button" className="icon-button lang-toggle" title={title} aria-label={title} onClick={toggleLanguage}>
      <span className="lang-toggle-label">{OTHER_LANGUAGE_LABEL[language]}</span>
    </button>
  );
}
