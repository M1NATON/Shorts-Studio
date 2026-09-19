import { describe, expect, it } from "vitest";
import { speakNumbers } from "./spoken-numbers.js";

describe("speakNumbers", () => {
  it("годы — как их читают", () => {
    expect(speakNumbers("in 1900.")).toBe("in nineteen hundred.");
    expect(speakNumbers("1984")).toBe("nineteen eighty-four");
    expect(speakNumbers("1905")).toBe("nineteen oh five");
    expect(speakNumbers("2000")).toBe("two thousand");
    expect(speakNumbers("2007,")).toBe("two thousand seven,");
    expect(speakNumbers("2026")).toBe("twenty twenty-six");
    expect(speakNumbers("the 1900s")).toBe("the nineteen hundreds");
  });

  it("количества с запятыми и нулями", () => {
    expect(speakNumbers("2,000-year-old")).toBe("two thousand-year-old");
    expect(speakNumbers("1,100")).toBe("one thousand one hundred");
    expect(speakNumbers("40 to 50 meters")).toBe("forty to fifty meters");
    expect(speakNumbers("1,000,000")).toBe("one million");
    expect(speakNumbers("300")).toBe("three hundred");
    expect(speakNumbers("0")).toBe("zero");
    expect(speakNumbers("5000")).toBe("five thousand");
  });

  it("десятичные, доллары, проценты", () => {
    expect(speakNumbers("$8.7")).toBe("eight point seven dollars");
    expect(speakNumbers("32.4%")).toBe("thirty-two point four percent");
    expect(speakNumbers("$2,000")).toBe("two thousand dollars");
    expect(speakNumbers("$1")).toBe("one dollar");
    expect(speakNumbers("$8.7 billion.")).toBe("eight point seven billion dollars.");
  });

  it("не трогает слова без чисел и смешанные токены", () => {
    expect(speakNumbers("A diver finds the wreck")).toBe("A diver finds the wreck");
    expect(speakNumbers("MP4 and 3.5x")).toBe("MP4 and 3.5x");
  });
});
