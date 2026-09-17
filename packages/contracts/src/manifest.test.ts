import { describe, expect, it } from "vitest";
import { findActiveWordIndex } from "./manifest.js";

describe("findActiveWordIndex", () => {
  const words = [
    { text: "Will", start: 0, end: 0.16 },
    { text: "AI", start: 0.24, end: 0.56 },
    { text: "A", start: 2.96, end: 2.96 }, // Fish реально отдаёт слова нулевой длительности
    { text: "rebel", start: 3.2, end: 3.8 },
  ];

  it("до первого слова ничего не подсвечено", () => {
    expect(findActiveWordIndex(words, -1)).toBe(-1);
  });

  it("подсвечивает слово с нулевой длительностью", () => {
    expect(findActiveWordIndex(words, 2.96)).toBe(2);
    expect(findActiveWordIndex(words, 3.0)).toBe(2);
  });

  it("держит подсветку в паузе между словами, а не гасит её", () => {
    // 1.5с — пауза между "AI" (кончилось на 0.56) и "A" (начнётся в 2.96)
    expect(findActiveWordIndex(words, 1.5)).toBe(1);
  });

  it("переключается точно на старте следующего слова", () => {
    expect(findActiveWordIndex(words, 3.19)).toBe(2);
    expect(findActiveWordIndex(words, 3.2)).toBe(3);
  });

  it("после последнего слова держит его подсвеченным", () => {
    expect(findActiveWordIndex(words, 99)).toBe(3);
  });

  it("пустой список не ломает рендер кадра", () => {
    expect(findActiveWordIndex([], 1)).toBe(-1);
  });
});
