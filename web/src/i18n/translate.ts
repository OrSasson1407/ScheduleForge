/**
 * The bilingual feature's one piece of real state, and the lookup itself -
 * kept free of React entirely.
 *
 * `LanguageContext.tsx` is how a screen reads and changes the active
 * language; this module is what actually holds it and does the lookup, so
 * that code with no React tree to sit in - a data file parser rejecting a
 * malformed line, the scheduler explaining why nothing could be built, the
 * search summarising how it went - can produce a message in the language the
 * user picked without being turned into a hook or being handed a `t`
 * function through three layers of call sites that have nothing else to do
 * with translation. `LanguageContext.tsx` is a thin subscriber to this
 * module, not the other way around: exactly the split `state/storage.ts`
 * already has from the components that read and write it.
 */

import { en } from "./translations/en";
import { he } from "./translations/he";
import { Dictionary } from "./translations/en";
import { Translated, TranslationKey, TranslationParams } from "./types";

export type Language = "en" | "he";

const STORAGE_KEY = "scheduleforge.v3.language";
const DEFAULT_LANGUAGE: Language = "en";

const DICTIONARIES: Record<Language, Translated<Dictionary>> = { en, he };

/** The one place that knows which of the supported languages read right to left. */
const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(["he"]);

export function directionOf(language: Language): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "he";
}

function loadLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // A browser that refuses storage (private mode, a locked-down profile)
    // simply starts from the default every time, exactly like `state/storage.ts`.
    return DEFAULT_LANGUAGE;
  }
}

function saveLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* The choice just will not survive a reload; nothing else depends on it. */
  }
}

let currentLanguage: Language = loadLanguage();
const listeners = new Set<(language: Language) => void>();

/** The language every call to `translate()` right now would use. */
export function getLanguage(): Language {
  return currentLanguage;
}

/**
 * Changes the active language: saves it, applies `lang`/`dir` to
 * `document.documentElement` immediately (not from a React effect, so the
 * very first paint - and any message an engine function builds before React
 * next renders - already sees it), and tells every subscriber.
 */
export function setLanguage(language: Language): void {
  if (language === currentLanguage) return;
  currentLanguage = language;
  saveLanguage(language);
  document.documentElement.setAttribute("lang", language);
  document.documentElement.setAttribute("dir", directionOf(language));
  for (const listener of listeners) listener(language);
}

/** `LanguageContext.tsx`'s way of re-rendering when the language changes elsewhere. */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

document.documentElement.setAttribute("lang", currentLanguage);
document.documentElement.setAttribute("dir", directionOf(currentLanguage));

/** Reads `"collab.tabConnected"` out of a dictionary; the key system makes this always find a string. */
function resolve(dictionary: Translated<Dictionary>, key: TranslationKey): string {
  return key.split(".").reduce<unknown>((node, segment) => {
    return typeof node === "object" && node !== null ? (node as Record<string, unknown>)[segment] : undefined;
  }, dictionary) as string;
}

function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  let result = text;
  for (const [name, value] of Object.entries(params)) {
    result = result.replaceAll(`{{${name}}}`, String(value));
  }
  return result;
}

/**
 * Looks up `key` in whichever language is active right now. Safe to call from
 * anywhere - a component, a parser, a thrown error's constructor - since it
 * needs no React tree and no argument beyond the key itself.
 */
export function translate(key: TranslationKey, params?: TranslationParams): string {
  return interpolate(resolve(DICTIONARIES[currentLanguage], key), params);
}
