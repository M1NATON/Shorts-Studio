import { describe, expect, it } from "vitest";
import { clipLabelLevel, layoutTimeline, rulerStep, zoomAtAnchor } from "./timeline";

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

describe("zoomAtAnchor", () => {
  it("точка под курсором остаётся на месте после зума", () => {
    const r = zoomAtAnchor(10, 2, 50, 100, 1, 400);
    expect(r.pxPerSecond).toBe(20);
    // время под курсором: (100+50)/10 = 15с; при новом масштабе оно должно быть на x = anchorX
    expect(r.scrollLeft + 50).toBeCloseTo(15 * 20, 5);
  });

  it("зажимает масштаб границами min/max", () => {
    expect(zoomAtAnchor(10, 100, 0, 0, 1, 400).pxPerSecond).toBe(400);
    expect(zoomAtAnchor(10, 0.001, 0, 0, 5, 400).pxPerSecond).toBe(5);
  });
});

describe("clipLabelLevel", () => {
  it("широкий клип — номер и длительность, средний — только номер, узкий — ничего", () => {
    expect(clipLabelLevel(120)).toBe("full");
    expect(clipLabelLevel(90)).toBe("full");
    expect(clipLabelLevel(50)).toBe("number");
    expect(clipLabelLevel(30)).toBe("number");
    expect(clipLabelLevel(20)).toBe("none");
  });
});
