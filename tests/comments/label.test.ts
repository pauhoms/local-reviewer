import { describe, expect, it } from "vitest";
import { lineRangeLabel, summarize, SUMMARY_LIMIT } from "@/comments/label";

describe("lineRangeLabel", () => {
  it("names a single line in the singular", () => {
    expect(lineRangeLabel(35, 35)).toBe("Línea 35");
  });

  it("names a range with both ends", () => {
    expect(lineRangeLabel(35, 48)).toBe("Líneas 35-48");
  });

  it("orders the ends so a backwards anchor still reads forwards", () => {
    expect(lineRangeLabel(48, 35)).toBe("Líneas 35-48");
  });
});

describe("summarize", () => {
  it("leaves a short text exactly as it is", () => {
    expect(summarize("Evitar duplicación del try/catch.")).toBe("Evitar duplicación del try/catch.");
  });

  it("folds every kind of whitespace into single spaces", () => {
    expect(summarize("primera línea\nsegunda\tlínea\r\ntercera")).toBe(
      "primera línea segunda línea tercera",
    );
  });

  it("trims the ends so the summary never starts with a blank", () => {
    expect(summarize("   nota al margen  ")).toBe("nota al margen");
  });

  it("cuts a long text and marks the cut with an ellipsis", () => {
    const long = "x".repeat(SUMMARY_LIMIT + 40);

    const shown = summarize(long);

    expect(shown.length).toBeLessThan(long.length);
    expect(shown.endsWith("…")).toBe(true);
    expect(long.startsWith(shown.slice(0, -1))).toBe(true);
  });

  it("does not leave a dangling space before the ellipsis", () => {
    const long = `${"palabra ".repeat(20)}final`;

    const shown = summarize(long);

    expect(shown.endsWith(" …")).toBe(false);
    expect(long.startsWith(shown.slice(0, -1))).toBe(true);
  });

  it("answers an empty string for a text of nothing but blanks", () => {
    expect(summarize("   \n\t ")).toBe("");
    expect(summarize("")).toBe("");
  });

  it("counts characters and not code units, so emoji do not shorten the cut", () => {
    const shown = summarize("🚀".repeat(SUMMARY_LIMIT + 10));

    expect([...shown]).toHaveLength(SUMMARY_LIMIT + 1);
  });
});
