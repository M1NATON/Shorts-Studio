import { describe, expect, it } from "vitest";
import { layoutTimeline, rulerStep } from "./timeline";

describe("layoutTimeline", () => {
  it("ширина ∝ длительности, короткий клип не уже минимума, x↔кадр согласованы", () => {
    const clips = [
      { start: 0, dur: 90 },
      { start: 90, dur: 10 },
      { start: 100, dur: 200 },
    ];
    const t = layoutTimeline(clips, 606, 64, 3);
    expect(t.widths[1]).toBe(64);
    expect(t.widths[2]! / t.widths[0]!).toBeCloseTo(200 / 90);
    expect(t.lefts[1]).toBeCloseTo(t.widths[0]! + 3);
    // Середина второго клипа — середина его ширины, не глобальной шкалы.
    expect(t.frameToX(95)).toBeCloseTo(t.lefts[1]! + 32);
    expect(t.xToFrame(t.frameToX(150))).toBeCloseTo(150, -1);
    expect(t.frameToX(10_000)).toBe(t.width);
  });

  it("шаг линейки", () => {
    expect(rulerStep(100)).toBe(1);
    expect(rulerStep(20)).toBe(5);
    expect(rulerStep(1)).toBe(60);
  });
});
