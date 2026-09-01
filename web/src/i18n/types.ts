/**
 * The two small type utilities the whole type-safe dictionary system rests on.
 *
 * Kept apart from `translations/en.ts` so neither translation file has to
 * import the other, and apart from `LanguageContext.tsx` so a translation file
 * never has to import React just to be type-checked.
 */

import type { Dictionary } from "./translations/en";

/**
 * The shape of `en`, with every leaf string widened from a literal type back
 * to plain `string`. `en.ts` needs its literals (interpolation placeholders
 * like "{{room}}" are meaningful text, not a type to enforce), but a second
 * language obviously does not have to say the same words - only occupy the
 * same keys.
 */
export type Translated<T> = { [K in keyof T]: T[K] extends string ? string : Translated<T[K]> };

/**
 * Every legal translation key, as the dotted path a lookup actually uses -
 * `"nav.output"`, `"collab.tabConnected"` - derived straight from the real
 * shape of `en`, so a renamed or removed key is a compile error at every call
 * site of `t()` instead of a silently blank label in the running app.
 */
export type TranslationKey = DotPaths<Dictionary>;

type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DotPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** The values `{{placeholder}}` tokens in a translated string are filled with. */
export type TranslationParams = Record<string, string | number>;
