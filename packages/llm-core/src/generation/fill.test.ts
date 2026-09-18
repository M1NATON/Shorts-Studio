import { describe, expect, it } from "vitest";
import { compositionIssues, fillComposed, fillScene } from "./fill.js";
import type { ScenePlan } from "./plan.js";
import { fakeLlm, testContext } from "./test-helpers.js";

const presentation = { layout: "center", motion: "rise", backdrop: "spotlight", accentShift: 0 } as const;
const ringPlan: ScenePlan = { kind: "composed", fallbackKind: "stat-counter", hero: "ring", skeleton: "lead", presentation };
const input = { topic: "EVs", narration: "Electric cars were 22 percent of sales in 2025.", brief: "", plan: ringPlan, index: 2 };

const leadRing = { blocks: [{ block: "ring", percent: 22, label: "EV share of sales", at: 0 }, { block: "caption", text: "Global, 2025", at: 0.4 }] };
const classicRing = { blocks: [{ block: "heading", text: "EVs are rising", size: "l" }, { block: "ring", percent: 22, label: "EV share", at: 0.2 }] };

describe("fillComposed", () => {
  it("скелет в промпте, кадр по скелету принимается с первой попытки", async () => {
    const llm = fakeLlm(() => leadRing);
    const visual = await fillComposed(testContext(llm), input);
    expect(visual.kind).toBe("composed");
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.system).toContain("open with the main block");
    expect(llm.calls[0]!.system).toContain("Today is 2026-09-18");
  });

  it("нарушение скелета уходит обратно замечанием; на последней попытке кадр принимается как есть", async () => {
    const llm = fakeLlm(() => classicRing);
    const visual = await fillComposed(testContext(llm), input);
    expect(llm.calls).toHaveLength(3);
    expect(llm.calls[1]!.user).toContain('skeleton "lead"');
    expect(visual.kind === "composed" && visual.blocks[0]!.block).toBe("heading");
  });

  it("без главного блока — откат на шаблонный тип сцены", async () => {
    const llm = fakeLlm((req) =>
      req.system.includes("Scene kind: stat-counter")
        ? { label: "EV share of sales", fromValue: 0, toValue: 22, unit: "%", decimals: 0 }
        : { blocks: [{ block: "heading", text: "EVs" }, { block: "icon", icon: "zap", at: 0.2 }] },
    );
    const ctx = testContext(llm);
    const visual = await fillComposed(ctx, input);
    expect(visual.kind).toBe("stat-counter");
    expect(ctx.logs.some((l) => l.includes("откат на stat-counter"))).toBe(true);
  });

  it("свободный главный блок: подсказки про кольцо и скелет в промпт не идут", async () => {
    const llm = fakeLlm(() => ({ blocks: [{ block: "icon", icon: "zap" }, { block: "caption", text: "Charging", at: 0.3 }] }));
    const visual = await fillComposed(testContext(llm), { ...input, freeHero: true, instruction: "сделай иконкой" });
    expect(visual.kind).toBe("composed");
    expect(llm.calls[0]!.system).not.toContain("built around");
    expect(llm.calls[0]!.user).toContain("USER REQUEST");
    expect(llm.calls[0]!.user).toContain("сделай иконкой");
  });

  it("разворачивает ответ, завёрнутый в visual", async () => {
    const llm = fakeLlm(() => ({ visual: leadRing }));
    expect((await fillComposed(testContext(llm), input)).kind).toBe("composed");
  });
});

describe("fillScene", () => {
  it("шаблон: kind из плана перетирает kind из ответа модели", async () => {
    const llm = fakeLlm(() => ({ kind: "hook-statement", lines: ["Ten years away", "for fifty years"], emphasisLine: 1 }));
    const plan: ScenePlan = { kind: "kinetic-text", fallbackKind: "kinetic-text", presentation };
    const visual = await fillScene(testContext(llm), { ...input, plan });
    expect(visual.kind).toBe("kinetic-text");
    expect(llm.calls[0]!.system).toContain('"lines"');
  });

  it("три ошибки шаблона — детерминированный hook-statement из озвучки", async () => {
    const llm = fakeLlm(() => new Error("LLM HTTP 504"));
    const plan: ScenePlan = { kind: "timeline", fallbackKind: "timeline", presentation };
    const visual = await fillScene(testContext(llm), { ...input, plan });
    expect(visual).toMatchObject({ kind: "hook-statement", text: input.narration });
  });
});

describe("выдуманные числа", () => {
  it("блок данных на фразе без числа уходит на повтор с замечанием", async () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "icon-list", presentation };
    const llm = fakeLlm((_, call) =>
      call === 1
        ? { blocks: [{ block: "number", value: 88, unit: "%" }, { block: "caption", text: "Cheaper", at: 0.3 }] }
        : { blocks: [{ block: "icon", icon: "battery" }, { block: "caption", text: "Cheaper chemistry", at: 0.3 }] },
    );
    const visual = await fillComposed(testContext(llm), {
      ...input,
      narration: "Lower-cost LFP chemistry pushed pack prices down further.",
      plan,
      freeHero: true,
    });
    expect(llm.calls[0]!.system).toContain("no figure");
    expect(llm.calls[1]!.user).toContain("the narration has no figure");
    expect(visual.kind === "composed" && visual.blocks[0]!.block).toBe("icon");
  });
});

describe("кольцо без доли в озвучке", () => {
  const numberPlan: ScenePlan = { kind: "composed", fallbackKind: "stat-counter", hero: "number", presentation };
  const ringBlocks = [{ block: "ring", percent: 99, label: "Price drop", at: 0 }, { block: "caption", text: "This year", at: 0.4 }];

  it("нет доли в тексте — кольцо получает замечание, а не проходит как число", () => {
    const issues = compositionIssues(ringBlocks as never, numberPlan, true, "Battery prices fell another $500 per kWh this year.");
    expect(issues.some((i) => i.includes('"ring"'))).toBe(true);
  });

  it("доля есть в тексте — кольцо замечаний не получает", () => {
    const issues = compositionIssues(ringBlocks as never, numberPlan, true, "Battery prices fell 20% this year.");
    expect(issues.some((i) => i.includes('"ring"'))).toBe(false);
  });
});
