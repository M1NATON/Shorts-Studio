import { describe, expect, it } from "vitest";
import { acceptComposed, compositionIssues, fillComposed, fillScene, fillStatsSummary, fillTemplate, newFillStats, repairIcon } from "./fill.js";
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

describe("ремонт сырого JSON перед валидацией", () => {
  it("пустая строка в необязательном поле шаблона удаляется — сцена проходит с первой попытки", async () => {
    const plan: ScenePlan = { kind: "stat-counter", fallbackKind: "stat-counter", presentation };
    const llm = fakeLlm(() => ({ label: "Pack price", fromValue: 0, toValue: 139, unit: "", decimals: 0 }));
    const visual = await fillTemplate(testContext(llm), {
      ...input,
      narration: "Battery packs now cost $139 per kWh.",
      plan,
    });
    expect(llm.calls).toHaveLength(1);
    expect(visual.kind === "stat-counter" && visual.unit).toBeUndefined();
  });

  it("неизвестная иконка меняется на ближайшую из реестра, а не уходит в повтор", async () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "icon-list", hero: "icon", presentation };
    const llm = fakeLlm(() => ({
      blocks: [
        { block: "icon", icon: "chart-bar", caption: "Costs", at: 0 },
        { block: "caption", text: "Falling fast", at: 0.3 },
      ],
    }));
    const visual = await fillComposed(testContext(llm), { ...input, plan });
    expect(llm.calls).toHaveLength(1);
    expect(visual.kind === "composed" && visual.blocks[0]).toMatchObject({ block: "icon", icon: "chart-column" });
  });

  it("repairIcon: точное совпадение, иначе подстрока/общее слово, иначе нейтральный fallback", () => {
    expect(repairIcon("Zap")).toBe("zap");
    expect(repairIcon("chart-bar")).toBe("chart-column");
    expect(repairIcon("nonexistent-symbol")).toBe("sparkles");
  });

  it("блок неизвестного типа отбрасывается вместо отказа всей композиции", async () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "icon-list", hero: "row", presentation };
    const llm = fakeLlm(() => ({
      blocks: [
        { block: "row", text: "Bigger plants", emphasis: false, at: 0 },
        { block: "stat", value: 42, at: 0.2 }, // тип, которого нет в BLOCK_TYPES
      ],
    }));
    const visual = await fillComposed(testContext(llm), { ...input, plan });
    expect(llm.calls).toHaveLength(1);
    expect(visual.kind === "composed" && visual.blocks).toHaveLength(1);
  });

  it("divider в начале и конце удаляется — стоять он должен только между блоками", async () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "comparison", hero: "row", presentation };
    const llm = fakeLlm(() => ({
      blocks: [
        { block: "divider", variant: "line", at: 0 },
        { block: "row", text: "Point one", at: 0 },
        { block: "row", text: "Point two", emphasis: true, at: 0.3 },
        { block: "divider", variant: "line", at: 0.6 },
      ],
    }));
    const visual = await fillComposed(testContext(llm), { ...input, plan });
    expect(llm.calls).toHaveLength(1);
    expect(visual.kind === "composed" && visual.blocks.every((b) => b.block !== "divider")).toBe(true);
  });

  it("подряд идущие divider'ы схлопываются в один", async () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "comparison", hero: "divider", presentation };
    const llm = fakeLlm(() => ({
      blocks: [
        { block: "row", text: "Before", at: 0 },
        { block: "divider", variant: "vs", at: 0.2 },
        { block: "divider", variant: "vs", at: 0.2 },
        { block: "row", text: "After", at: 0.3 },
      ],
    }));
    const visual = await fillComposed(testContext(llm), { ...input, plan });
    expect(llm.calls).toHaveLength(1);
    expect(visual.kind === "composed" && visual.blocks.filter((b) => b.block === "divider")).toHaveLength(1);
  });

  it("пакетная приёмка глав (acceptComposed) чинит так же", () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "comparison", hero: "row", presentation };
    const result = acceptComposed(
      {
        blocks: [
          { block: "divider", variant: "line", at: 0 },
          { block: "row", text: "Point one", at: 0.1 },
          { block: "row", text: "Point two", emphasis: true, at: 0.3 },
        ],
      },
      { ...input, plan },
    );
    expect(result.issues).toEqual([]);
    expect(result.visual?.kind === "composed" && result.visual.blocks.every((b) => b.block !== "divider")).toBe(true);
  });
});

describe("итог по ролику: попытки и откаты", () => {
  it("успех с первой попытки", async () => {
    const plan: ScenePlan = { kind: "hook-statement", fallbackKind: "hook-statement", presentation };
    const llm = fakeLlm(() => ({ variant: "statement", text: "Batteries got cheap" }));
    const stats = newFillStats();
    await fillTemplate(testContext(llm), { ...input, plan, stats });
    expect(stats).toEqual({ attempts: 1, fellBack: false });
  });

  it("успех после повтора — не «с первой попытки», но и не откат", async () => {
    const plan: ScenePlan = { kind: "hook-statement", fallbackKind: "hook-statement", presentation };
    const llm = fakeLlm((_, call) => (call === 1 ? { text: "" } : { variant: "statement", text: "Batteries got cheap" }));
    const stats = newFillStats();
    await fillTemplate(testContext(llm), { ...input, plan, stats });
    expect(stats).toEqual({ attempts: 2, fellBack: false });
  });

  it("три неудачи шаблона — откат, попытки не в счёт", async () => {
    const plan: ScenePlan = { kind: "timeline", fallbackKind: "timeline", presentation };
    const llm = fakeLlm(() => new Error("LLM HTTP 504"));
    const stats = newFillStats();
    await fillTemplate(testContext(llm), { ...input, plan, stats });
    expect(stats.fellBack).toBe(true);
  });

  it("композиция не собралась — откат считается, даже если наполнение шаблоном после этого проходит сразу", async () => {
    const plan: ScenePlan = { kind: "composed", fallbackKind: "stat-counter", hero: "ring", presentation };
    const llm = fakeLlm((req) =>
      req.system.includes("Scene kind: stat-counter")
        ? { label: "EV share", fromValue: 0, toValue: 22, unit: "%", decimals: 0 }
        : { blocks: [{ block: "heading", text: "EVs" }] }, // без кольца — три попытки провалены
    );
    const stats = newFillStats();
    await fillComposed(testContext(llm), { ...input, plan, stats });
    expect(stats.fellBack).toBe(true);
  });

  it("fillStatsSummary формирует итоговую строку по трём категориям", () => {
    const line = fillStatsSummary([
      { attempts: 1, fellBack: false },
      { attempts: 2, fellBack: false },
      { attempts: 3, fellBack: true },
    ]);
    expect(line).toBe("кадры: 1 с первой попытки, 1 с повторами, 1 откатов из 3");
  });
});
