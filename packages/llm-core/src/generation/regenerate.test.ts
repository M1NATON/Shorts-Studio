import { describe, expect, it } from "vitest";
import type { SceneVisualSpec } from "@shorts/contracts";
import { hasFigure, inferIntent, regenerateSceneVisual, rewriteNarration, variantPlans } from "./regenerate.js";
import { fakeLlm, testContext } from "./test-helpers.js";

const pres = { layout: "left", motion: "pop", backdrop: "dots", accentShift: 12 } as const;
const composedRow: SceneVisualSpec = {
  kind: "composed",
  ...pres,
  blocks: [
    { block: "heading", text: "Three reasons", size: "l", at: 0 },
    { block: "row", text: "Cheaper cells", emphasis: false, at: 0.2 },
  ],
} as SceneVisualSpec;
const hook: SceneVisualSpec = { kind: "hook-statement", variant: "statement", text: "Batteries got cheap", ...pres } as SceneVisualSpec;

const scenes = [
  { narration: "Batteries got cheap.", visual: hook },
  { narration: "Three things drove the price down.", visual: composedRow, intent: "list" as const },
  { narration: "Packs cost 115 dollars per kWh in 2024.", visual: composedRow },
];

/** Отвечает кадром с тем главным блоком, который просит промпт. */
const answerByHero = fakeLlm((req) => {
  if (req.system.includes("Scene kind: hook-statement")) return { variant: "statement", text: "Batteries are cheap now" };
  const hero = /built around (?:a |an )?"?(\w+)/.exec(req.system)?.[1] ?? "icon";
  const main: Record<string, object> = {
    rows: { block: "row", text: "Scale", emphasis: true },
    chips: { block: "chips", items: ["Scale", "Chemistry"] },
    big: { block: "icon", icon: "zap" },
    quote: { block: "quote", text: "Scale wins" },
    pair: { block: "pair", items: [{ label: "Then", value: "$1000" }, { label: "Now", value: "$115" }] },
    ring: { block: "ring", percent: 50, label: "Share" },
  };
  return { blocks: [{ ...(main[hero] ?? { block: "icon", icon: "zap" }), at: 0 }, { block: "caption", text: "Why", at: 0.4 }] };
});

describe("variantPlans", () => {
  it("главные блоки, которых нет в кадре; без числа в озвучке — без блоков данных", () => {
    const plans = variantPlans(scenes[1]!, "list", 3);
    expect(plans.map((p) => p.hero)).not.toContain("row");
    expect(plans.map((p) => p.hero)).not.toContain("ring");
    expect(new Set(plans.map((p) => p.hero)).size).toBe(3);
  });

  it("с числом в озвучке — один вариант с данными, а не три", () => {
    const plans = variantPlans(scenes[2]!, "number", 3);
    const data = plans.filter((p) => ["ring", "number", "bars"].includes(p.hero));
    expect(data).toHaveLength(1);
    expect(plans).toHaveLength(3);
  });
});

describe("inferIntent / hasFigure", () => {
  it("по кадру и позиции", () => {
    expect(inferIntent(hook, 0, 5)).toBe("hook");
    expect(inferIntent(composedRow, 2, 5)).toBe("list");
    expect(inferIntent(hook, 4, 5)).toBe("takeaway");
  });
  it("год и мелкие числа не считаются цифрой для кадра", () => {
    expect(hasFigure("In 2024 three firms led")).toBe(false);
    expect(hasFigure("Packs cost 115 dollars")).toBe(true);
  });
});

describe("regenerateSceneVisual", () => {
  it("с пожеланием: первый вариант свободный, подача сцены сохраняется", async () => {
    const ctx = testContext(answerByHero);
    const variants = await regenerateSceneVisual(ctx, {
      topic: "Batteries", brief: "", scenes, index: 1, instruction: "меньше текста", variants: 3,
    });
    expect(variants).toHaveLength(3);
    expect(variants[0]!.label).toBe("По пожеланию");
    for (const v of variants) {
      expect(v.visual.layout).toBe("left");
      expect(v.visual.motion).toBe("pop");
    }
    const prompts = answerByHero.calls.slice(-3);
    expect(prompts.every((c) => c.user.includes("previous scene"))).toBe(true);
    expect(prompts.every((c) => c.user.includes("меньше текста"))).toBe(true);
  });

  it("шаблонная сцена получает вариант своего типа", async () => {
    const variants = await regenerateSceneVisual(testContext(answerByHero), {
      topic: "Batteries", brief: "", scenes, index: 0, variants: 2,
    });
    expect(variants[0]!.visual.kind).toBe("hook-statement");
    expect(variants[1]!.visual.kind).toBe("composed");
  });

  it("индекс вне ролика — ошибка", async () => {
    await expect(regenerateSceneVisual(testContext(answerByHero), { topic: "x", brief: "", scenes, index: 9 })).rejects.toThrow();
  });
});

describe("rewriteNarration", () => {
  it("слишком длинный текст уходит на повтор с замечанием", async () => {
    const llm = fakeLlm((_, call) => ({ narration: call === 1 ? "x".repeat(200) : "Three forces cut battery prices by ninety percent." }));
    const text = await rewriteNarration(testContext(llm), { topic: "Batteries", brief: "", scenes, index: 1, instruction: "короче" });
    expect(text).toMatch(/^Three forces/);
    expect(llm.calls[1]!.user).toContain("rejected");
    expect(llm.calls[0]!.user).toContain("<- rewrite this one");
  });
});
