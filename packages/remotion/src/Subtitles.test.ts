import { describe, expect, it } from "vitest";
import { paperOvershoot } from "./Subtitles.js";

describe("paperOvershoot", () => {
  it("начинается и заканчивается без перепрыгивания (масштаб 1)", () => {
    expect(paperOvershoot(0)).toBeCloseTo(1);
    expect(paperOvershoot(1)).toBeCloseTo(1);
  });

  it("перепрыгивает финальный размер в середине входа", () => {
    expect(paperOvershoot(0.5)).toBeCloseTo(1.08);
  });

  it("вне диапазона 0..1 не даёт скачков — прогресс клампится", () => {
    expect(paperOvershoot(-1)).toBeCloseTo(1);
    expect(paperOvershoot(2)).toBeCloseTo(1);
  });
});
