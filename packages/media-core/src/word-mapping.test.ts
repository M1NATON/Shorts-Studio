import { describe, expect, it } from "vitest";
import shortFixture from "./fixtures/fish-short.json" with { type: "json" };
import numbersFixture from "./fixtures/fish-numbers.json" with { type: "json" };
import { assembleFishStream, type FishStreamEvent } from "./fish-stream.js";
import { estimateTimings, mapTimingsToOriginalText } from "./word-mapping.js";

describe("mapTimingsToOriginalText", () => {
  it("возвращает субтитрам оригинальную пунктуацию, забирая тайминги у провайдера", () => {
    const { words, unmatched } = mapTimingsToOriginalText("By 2026, AI can't rebel.", [
      { text: "By", start: 0, end: 0.1 },
      { text: "2026", start: 0.1, end: 1.6 },
      { text: "AI", start: 1.7, end: 1.9 },
      { text: "cant", start: 1.9, end: 2.3 },
      { text: "rebel", start: 2.3, end: 2.9 },
    ]);
    expect(unmatched).toBe(0);
    expect(words.map((w) => w.text)).toEqual(["By", "2026,", "AI", "can't", "rebel."]);
    expect(words[3]).toMatchObject({ text: "can't", start: 1.9, end: 2.3 });
  });

  it("склеивает числа, которые Fish режет по точке и запятой (реальный ответ)", () => {
    // Fish: "$8.7" → "8" + "7", "1,100" → "1" + "100", "3.5x" → "3" + "5x".
    const { words, unmatched } = mapTimingsToOriginalText(numbersFixture.text, numbersFixture.words);
    expect(unmatched).toBe(0);
    const byText = new Map(words.map((w) => [w.text, w]));
    const provider = numbersFixture.words;
    const at = (t: string) => provider.findIndex((w) => w.text === t);
    expect(byText.get("$8.7")).toMatchObject({ start: provider[at("8")]!.start, end: provider[at("7")]!.end });
    expect(byText.get("1,100")!.end).toBe(provider[at("100")]!.end);
    expect(byText.get("3.5x")!.end).toBe(provider[at("5x")]!.end);
  });

  it("находит тайминг числа, озвученного словами (speakNumbers)", () => {
    const { words, unmatched } = mapTimingsToOriginalText("A 2,000-year-old wreck in 1900.", [
      { text: "A", start: 0, end: 0.1 },
      { text: "two", start: 0.1, end: 0.3 },
      { text: "thousand", start: 0.3, end: 0.6 },
      { text: "year", start: 0.6, end: 0.8 },
      { text: "old", start: 0.8, end: 1 },
      { text: "wreck", start: 1, end: 1.3 },
      { text: "in", start: 1.3, end: 1.4 },
      { text: "nineteen", start: 1.4, end: 1.8 },
      { text: "hundred", start: 1.8, end: 2.2 },
    ]);
    expect(unmatched).toBe(0);
    expect(words[1]).toMatchObject({ text: "2,000-year-old", start: 0.1, end: 1 });
    expect(words[4]).toMatchObject({ text: "1900.", start: 1.4, end: 2.2 });
  });

  it("не склеивает соседние слова в чужое число", () => {
    const { words, unmatched } = mapTimingsToOriginalText("12 5", [
      { text: "12", start: 0, end: 0.4 },
      { text: "5", start: 0.5, end: 0.8 },
    ]);
    expect(unmatched).toBe(0);
    expect(words[0]).toMatchObject({ start: 0, end: 0.4 });
  });

  it("переживает точки в аббревиатурах и регистр", () => {
    const { words, unmatched } = mapTimingsToOriginalText("A.I. Systems WON'T stop.", [
      { text: "ai", start: 0, end: 0.5 },
      { text: "systems", start: 0.5, end: 1 },
      { text: "wont", start: 1, end: 1.4 },
      { text: "stop", start: 1.4, end: 1.8 },
    ]);
    expect(unmatched).toBe(0);
    expect(words[0]).toMatchObject({ text: "A.I.", start: 0 });
  });

  it("интерполирует пропущенное провайдером слово, а не роняет сцену", () => {
    const { words, unmatched } = mapTimingsToOriginalText("one two three", [
      { text: "one", start: 0, end: 1 },
      { text: "three", start: 2, end: 3 },
    ]);
    expect(unmatched).toBe(1);
    expect(words).toHaveLength(3);
    expect(words[1]!.start).toBeGreaterThanOrEqual(1);
    expect(words[1]!.end).toBeLessThanOrEqual(2 + 1e-9);
    expect(words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))).toBe(true);
  });

  it("монотонно возрастает на реальном ответе Fish", () => {
    const original = "By 2026, AI systems still cannot set their own goals.";
    const { words, unmatched } = mapTimingsToOriginalText(
      original,
      assembleFishStream(shortFixture as FishStreamEvent[]).words,
    );
    expect(unmatched).toBe(0);
    expect(words.map((w) => w.text).join(" ")).toBe(original);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
    }
  });
});

describe("estimateTimings", () => {
  it("укладывается в реальную длительность аудио", () => {
    const words = estimateTimings("one two three four five", 5);
    expect(words).toHaveLength(5);
    expect(words[0]!.start).toBe(0);
    expect(words.at(-1)!.end).toBeLessThanOrEqual(5);
    expect(words.at(-1)!.end).toBeGreaterThan(4);
  });

  it("длинные слова получают больше времени, чем короткие", () => {
    const [short, long] = estimateTimings("a extraordinary", 4);
    expect(long!.end - long!.start).toBeGreaterThan(short!.end - short!.start);
  });

  it("пустой текст не ломает пайплайн", () => {
    expect(estimateTimings("   ", 3)).toEqual([]);
  });
});
