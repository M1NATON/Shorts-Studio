import { describe, expect, it } from "vitest";
import { ScriptSchema, type SceneIntent } from "@shorts/contracts";
import { chapterCard, generateLongScript, longShape } from "./long.js";
import { planScenes, type Beat } from "./plan.js";
import { fakeLlm, testContext } from "./test-helpers.js";

const long = (n: number) => `${"This sentence carries one clear idea about batteries and their price. ".repeat(3)}`.slice(0, n);

describe("longShape", () => {
  it("минуты → главы и тезисы в разумных пределах", () => {
    expect(longShape(3)).toEqual({ chapters: 2, beatsPerChapter: 8 });
    const ten = longShape(10);
    expect(ten.chapters).toBe(5);
    expect(ten.beatsPerChapter).toBeGreaterThanOrEqual(3);
    expect(ten.beatsPerChapter).toBeLessThanOrEqual(8);
  });
});

describe("planScenes: 16:9", () => {
  const intents: SceneIntent[] = ["hook", "number", "list", "contrast", "fact", "list", "number", "takeaway"];
  const beats: Beat[] = intents.map((intent) => ({ intent, narration: "x" }));

  it("split только у сцен из блоков со скелетом «текст + визуал»; top и stacked не используются", () => {
    const plans = planScenes(beats, "landscape");
    for (const plan of plans) {
      if (plan.presentation.layout === "split") {
        expect(plan.kind).toBe("composed");
        expect(["classic", "reveal", "kicker"]).toContain(plan.skeleton);
      }
      expect(["top", "stacked"]).not.toContain(plan.presentation.layout);
    }
    expect(plans.some((p) => p.presentation.layout === "split")).toBe(true);
  });

  it("вертикальный план не меняется", () => {
    expect(planScenes(beats).some((p) => p.presentation.layout === "split")).toBe(false);
  });
});

describe("generateLongScript", () => {
  it("главы с карточками, пачка на главу, валидный сценарий 16:9", async () => {
    const llm = fakeLlm((req) => {
      if (req.system.includes("visual identity")) return { error: "skip" };
      if (req.system.includes('"chapters"')) {
        return {
          title: "Why batteries got cheap",
          hook: [{ narration: long(130), intent: "hook", mediaQuery: "lithium mine aerial", mediaKind: "photo" }],
          chapters: [
            { title: "Scale", summary: "Factories grew" },
            { title: "Chemistry", summary: "LFP took over" },
          ],
          takeaway: { narration: long(120), intent: "takeaway" },
        };
      }
      if (req.system.includes("one chapter")) {
        return {
          beats: Array.from({ length: 6 }, (_, i) => ({
            narration: long(120 + i),
            intent: i % 2 ? "list" : "fact",
            ...(i === 0 ? { mediaQuery: "battery factory line", mediaKind: "video" } : {}),
          })),
        };
      }
      if (req.system.includes("several consecutive scenes")) {
        const count = (req.user.match(/\nScene \d+/g) ?? []).length;
        return {
          scenes: Array.from({ length: count }, () => ({
            blocks: [
              { block: "heading", text: "Scale wins", size: "l" },
              { block: "icon", icon: "factory", at: 0.2 },
              { block: "row", text: "Bigger plants", emphasis: false, at: 0.3 },
            ],
          })),
        };
      }
      if (req.system.includes("composing blocks")) {
        return { blocks: [{ block: "icon", icon: "zap" }, { block: "row", text: "Scale", emphasis: true, at: 0.2 }] };
      }
      if (req.system.includes("Scene kind: outro-cta")) return { text: "Scale is the story" };
      if (req.system.includes("Scene kind: kinetic-text")) return { lines: ["Scale", "wins"] };
      if (req.system.includes("Scene kind: timeline")) return { steps: [{ label: "A", text: "First" }, { label: "B", text: "Then" }] };
      return { variant: "statement", text: "Batteries got cheap" };
    });

    const result = await generateLongScript(testContext(llm), "Batteries", { minutes: 3 });
    const { script } = result;
    expect(script.format).toBe("landscape");
    expect(ScriptSchema.safeParse(script).success).toBe(true);
    // хук + (карточка + 6) × 2 + финал
    expect(script.scenes).toHaveLength(1 + 7 * 2 + 1);
    expect(result.chapters).toEqual([
      { title: "Scale", firstScene: 1 },
      { title: "Chemistry", firstScene: 8 },
    ]);
    const card = script.scenes[1]!;
    expect(card.visual.kind === "composed" && card.visual.blocks[0]!.block).toBe("chapter");
    expect(card.narration).toBe("Chapter 1. Scale.");
    // Пачка: по одному запросу наполнения на главу, а не на сцену.
    expect(llm.calls.filter((c) => c.system.includes("several consecutive scenes"))).toHaveLength(2);

    // mediaQuery доходит от хука и от первой сцены каждой главы до готового сценария.
    expect(script.scenes[0]).toMatchObject({ mediaQuery: "lithium mine aerial", mediaKind: "photo" });
    expect(script.scenes[1]).not.toHaveProperty("mediaQuery"); // карточка главы — без медиа
    expect(script.scenes[2]).toMatchObject({ mediaQuery: "battery factory line", mediaKind: "video" });
    expect(script.scenes[3]!.mediaQuery).toBeUndefined(); // не первая сцена главы
    expect(script.scenes[9]).toMatchObject({ mediaQuery: "battery factory line", mediaKind: "video" });
    expect(llm.calls.some((c) => c.system.includes("mediaQuery"))).toBe(true);
  });
});

describe("chapterCard", () => {
  it("карточка главы проходит схему 16:9", () => {
    expect(chapterCard(3, "The grid").kind).toBe("composed");
  });
});
