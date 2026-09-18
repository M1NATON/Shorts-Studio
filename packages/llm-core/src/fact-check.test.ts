import { describe, expect, it } from "vitest";
import { collectVisualTexts, extractNumbers, findUnsupportedNumbers, isSupported } from "./fact-check.js";

const values = (text: string) => extractNumbers(text).map((n) => n.value);

describe("extractNumbers", () => {
  it("понимает разделители разрядов, дроби, проценты и масштаб", () => {
    expect(values("1,100,000 cars, 0.24 Wh, 90% and $1.2 billion")).toEqual([1_100_000, 0.24, 90, 1.2e9]);
  });

  it("не путает число с частью слова или версии модели", () => {
    expect(values("GPT4 and COVID19")).toEqual([]);
  });

  it("точность записи: 90 — десятки, 0.24 — сотые, год — точно", () => {
    const [ninety, small, year] = extractNumbers("90 then 0.24 in 2023");
    expect(ninety).toMatchObject({ step: 10, isYear: false });
    expect(small!.step).toBeCloseTo(0.01);
    expect(year).toMatchObject({ value: 2023, isYear: true, step: 1 });
  });
});

describe("isSupported", () => {
  const source = extractNumbers("Pack prices fell 89% to $139 per kWh in 2023, from 1,100 in 2010.");

  it("округление вверх до десятков подтверждается", () => {
    expect(isSupported(extractNumbers("about 90%")[0]!, source)).toBe(true);
  });

  it("точное число подтверждается, соседнее — нет", () => {
    expect(isSupported(extractNumbers("139")[0]!, source)).toBe(true);
    expect(isSupported(extractNumbers("147")[0]!, source)).toBe(false);
  });

  it("масштаб, ушедший в единицу кадра: 2.03 при источнике «2.03 billion»", () => {
    const withScale = extractNumbers("The market was worth $2.03 billion in 2024.");
    expect(isSupported(extractNumbers("2.03")[0]!, withScale)).toBe(true);
    expect(isSupported(extractNumbers("2.03 billion")[0]!, withScale)).toBe(true);
    // Оба с масштабом, но разным — это разные числа.
    expect(isSupported(extractNumbers("2.03 million")[0]!, withScale)).toBe(false);
  });

  it("год проверяется точно", () => {
    expect(isSupported(extractNumbers("since 2010")[0]!, source)).toBe(true);
    expect(isSupported(extractNumbers("since 2012")[0]!, source)).toBe(false);
  });
});

describe("findUnsupportedNumbers", () => {
  const source = extractNumbers("The median prompt uses 0.24 watt-hours, a study from 2025 says.");

  it("возвращает только неподтверждённые, без мелких порядковых", () => {
    expect(
      findUnsupportedNumbers(["3 reasons: 0.24 Wh per prompt, 5 billion prompts a day, since 2025"], source),
    ).toEqual(["5 billion"]);
  });

  it("проверяет и кадр, а не только озвучку", () => {
    const visual = {
      kind: "composed",
      layout: "center",
      blocks: [
        { block: "number", value: 42, unit: "Wh" },
        { block: "ring", percent: 0.24, label: "share" },
        { block: "row", icon: "zap", text: "Since 2019" },
      ],
    };
    expect(findUnsupportedNumbers(collectVisualTexts(visual), source)).toEqual(["42", "2019"]);
  });
});
