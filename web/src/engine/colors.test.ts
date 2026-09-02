import { describe, expect, it } from "vitest";
import { PROGRAM_PALETTE, assignProgramColors } from "./colors";

describe("assignProgramColors", () => {
  it("assigns a color to a program that has none", () => {
    const result = assignProgramColors(["83101"], {});
    expect(result["83101"]).toBeDefined();
    expect(PROGRAM_PALETTE).toContain(result["83101"]);
  });

  it("keeps an existing hand-picked color unchanged", () => {
    const result = assignProgramColors(["83101"], { "83101": "#123456" });
    expect(result["83101"]).toBe("#123456");
  });

  it("assigns different palette colors to different programs", () => {
    const result = assignProgramColors(["83101", "83102"], {});
    expect(result["83101"]).not.toBe(result["83102"]);
  });

  it("does not reassign colors already used by an untouched program", () => {
    const first = assignProgramColors(["83101"], {});
    const both = assignProgramColors(["83101", "83102"], first);
    expect(both["83101"]).toBe(first["83101"]);
  });

  it("does not reuse a palette color already in use by another program, while colors remain", () => {
    const result = assignProgramColors(
      PROGRAM_PALETTE.slice(0, PROGRAM_PALETTE.length - 1).map((_, i) => `prog-${i}`),
      {}
    );
    const usedColors = Object.values(result);
    expect(new Set(usedColors).size).toBe(usedColors.length);
  });

  it("falls back to a hashed palette color once every palette color is already used", () => {
    const existing: Record<string, string> = {};
    PROGRAM_PALETTE.forEach((color, i) => {
      existing[`used-${i}`] = color;
    });
    const result = assignProgramColors(["overflow"], existing);
    expect(PROGRAM_PALETTE).toContain(result["overflow"]);
  });

  it("is deterministic: the same program number always hashes to the same fallback color", () => {
    const existing: Record<string, string> = {};
    PROGRAM_PALETTE.forEach((color, i) => {
      existing[`used-${i}`] = color;
    });
    const first = assignProgramColors(["overflow-program"], existing);
    const second = assignProgramColors(["overflow-program"], existing);
    expect(first["overflow-program"]).toBe(second["overflow-program"]);
  });

  it("preserves existing colors for programs no longer in the requested list", () => {
    const result = assignProgramColors([], { "83101": "#123456" });
    expect(result["83101"]).toBe("#123456");
  });

  it("returns an empty object for no programs and no existing colors", () => {
    expect(assignProgramColors([], {})).toEqual({});
  });

  it("does not mutate the existing colors object passed in", () => {
    const existing = { "83101": "#123456" };
    assignProgramColors(["83101", "83102"], existing);
    expect(Object.keys(existing)).toEqual(["83101"]);
  });

  it("assigns colors to several new programs in one call, all distinct while palette allows", () => {
    const result = assignProgramColors(["a", "b", "c", "d"], {});
    const colors = ["a", "b", "c", "d"].map((p) => result[p]);
    expect(new Set(colors).size).toBe(4);
  });
});
