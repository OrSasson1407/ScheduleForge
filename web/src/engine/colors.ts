/**
 * Colours and tags per study program (tagging & theming).
 *
 * Every selected study program gets a colour, so that an exam that belongs to
 * several programs can be told apart on the calendar at a glance, and the
 * legend at the top of the output screen can highlight or dim by program.
 */

/** A palette wide enough for the 5 selectable programs (requirement 2.2) and a
 * few more, chosen to stay legible on both a light and a dark background. */
export const PROGRAM_PALETTE = [
  "#2f6fb0", // blue
  "#2f9e6f", // green
  "#b0752f", // amber
  "#8a4fd1", // violet
  "#c0446b", // rose
  "#2f9ea8", // teal
  "#a3a02f", // olive
  "#d1704f", // orange
] as const;

export type ProgramColors = Record<string, string>;

/** Assigns a colour to every program that does not have one yet.
 *
 * Existing assignments are kept, so a colour a user picked by hand survives a
 * change in the set of selected programs; a freshly selected program takes the
 * first colour of the palette that is not already in use.
 */
export function assignProgramColors(
  programNumbers: string[],
  existing: ProgramColors
): ProgramColors {
  const used = new Set(Object.values(existing));
  const next: ProgramColors = { ...existing };
  for (const number of programNumbers) {
    if (next[number]) continue;
    const free = PROGRAM_PALETTE.find((color) => !used.has(color));
    const color = free ?? PROGRAM_PALETTE[hashIndex(number, PROGRAM_PALETTE.length)];
    next[number] = color;
    used.add(color);
  }
  return next;
}

function hashIndex(text: string, modulo: number): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash % modulo;
}
