import { describe, expect, it } from "vitest";
import { sheetEdgeX, sheetPath } from "./PaperSheetTransition.js";

describe("sheetEdgeX", () => {
  it("на старте кромка закрывает весь кадр (с запасом справа)", () => {
    expect(sheetEdgeX(0, 1000, 60)).toBeCloseTo(1060);
  });

  it("в конце кромка уходит за левый край", () => {
    expect(sheetEdgeX(1, 1000, 60)).toBeCloseTo(-60);
  });

  it("монотонно уменьшается: лист едет в одну сторону, не дёргаясь", () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map((p) => sheetEdgeX(p, 1000, 60));
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeLessThan(xs[i - 1]!);
    }
  });
});

describe("sheetPath", () => {
  it("детерминирован: одинаковый seed и progress дают одинаковый path", () => {
    expect(sheetPath(0.4, 1080, 1920, "scene-1")).toEqual(sheetPath(0.4, 1080, 1920, "scene-1"));
  });

  it("разный seed даёт разную волну кромки", () => {
    expect(sheetPath(0.4, 1080, 1920, "scene-1")).not.toEqual(sheetPath(0.4, 1080, 1920, "scene-2"));
  });

  it("path замкнут и начинается с M за левым краем кадра", () => {
    const path = sheetPath(0.5, 1080, 1920, "scene-1");
    expect(path.startsWith("M -")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });
});
