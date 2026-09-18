import { describe, expect, it } from "vitest";
import { compositionCapacity, estimateLines, stageSize } from "@shorts/contracts";
import { textZoom } from "./styles.js";

describe("textZoom", () => {
  it("короткую фразу увеличивает до потолка, длинную — только пока она влезает", () => {
    expect(textZoom(["Short hook"], 108, "shorts", 1.6)).toBeCloseTo(1.6);

    const long = "Heat pumps move heat instead of making it, so one unit both cools and heats a home";
    const zoom = textZoom([long], 88, "shorts", 1.6, 200);
    expect(zoom).toBeLessThan(1.6);
    const width = Math.min(stageSize("shorts", zoom).width, 920 / zoom);
    expect(estimateLines(long, 88, width) * 88 * 1.15 + 200).toBeLessThanOrEqual(compositionCapacity("center", "shorts", zoom));
  });
});
