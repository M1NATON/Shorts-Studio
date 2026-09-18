import { describe, expect, it } from "vitest";
import type { Block, SceneIntent } from "@shorts/contracts";
import { assignHeroes, assignSkeletons, dataHeroesFor, planScenes, SKELETONS, type Beat, type HeroBlock } from "./plan.js";

const beats = (intents: SceneIntent[]): Beat[] => intents.map((intent, i) => ({ intent, narration: `Beat ${i}` }));
const TYPICAL = beats(["hook", "number", "list", "contrast", "fact", "list", "number", "takeaway"]);

describe("planScenes", () => {
  it("хук и финал — шаблоны, середина собирается из блоков", () => {
    const plans = planScenes(TYPICAL);
    expect(plans[0]!.kind).toBe("hook-statement");
    expect(plans.at(-1)!.kind).toBe("outro-cta");
    expect(plans.filter((p) => p.kind === "composed").length).toBeGreaterThanOrEqual(4);
  });

  it("у каждой собранной сцены есть главный блок и скелет, у шаблонной — нет", () => {
    for (const plan of planScenes(TYPICAL)) {
      if (plan.kind === "composed") {
        expect(plan.hero).toBeDefined();
        expect(plan.skeleton).toBeDefined();
      } else {
        expect(plan.skeleton).toBeUndefined();
      }
    }
  });

  it("соседние сцены не делят фактуру фона", () => {
    const plans = planScenes(TYPICAL);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]!.presentation.backdrop).not.toBe(plans[i - 1]!.presentation.backdrop);
    }
  });

  it("детерминирована: тот же план на тех же тезисах", () => {
    expect(planScenes(TYPICAL)).toEqual(planScenes(TYPICAL));
  });
});

describe("assignSkeletons", () => {
  it("соседние собранные сцены получают разные скелеты, и их хотя бы три вида на ролик", () => {
    const heroes: HeroBlock[] = ["ring", "row", "pair", "icon", "chips", "quote"];
    const skeletons = assignSkeletons(heroes);
    for (let i = 1; i < skeletons.length; i++) expect(skeletons[i]).not.toBe(skeletons[i - 1]);
    expect(new Set(skeletons).size).toBeGreaterThanOrEqual(3);
  });

  it("разделитель не получает скелет, где главный блок стоит первым", () => {
    const skeletons = assignSkeletons(["divider", "divider", "divider", "divider"]);
    expect(skeletons).not.toContain("lead");
  });

  it("шаблонные сцены пропускаются", () => {
    expect(assignSkeletons([undefined, "ring", undefined])).toEqual([undefined, "lead", undefined]);
  });
});

describe("SKELETONS.check", () => {
  const heading = { block: "heading", text: "Cheaper", size: "l", at: 0 } as Block;
  const ring = (at: number) => ({ block: "ring", percent: 60, label: "Share", at }) as Block;
  const caption = { block: "caption", text: "Source", at: 0.5 } as Block;
  const row = { block: "row", text: "Point", emphasis: false, at: 0.3 } as Block;

  it("lead: главный блок первым; блок данных засчитывается за кольцо", () => {
    expect(SKELETONS.lead.check([ring(0), caption], "ring")).toBeUndefined();
    expect(SKELETONS.lead.check([{ block: "number", value: 5, from: 0, decimals: 0, at: 0 } as Block], "ring")).toBeUndefined();
    expect(SKELETONS.lead.check([heading, ring(0.2)], "ring")).toMatch(/first block/);
  });

  it("duo: без заголовка и два разных визуальных блока", () => {
    expect(SKELETONS.duo.check([ring(0), row], "ring")).toBeUndefined();
    expect(SKELETONS.duo.check([heading, ring(0), row], "ring")).toMatch(/heading/);
    expect(SKELETONS.duo.check([ring(0), caption], "ring")).toMatch(/second visual/);
  });

  it("reveal: заголовок первым, главный блок не раньше 0.35", () => {
    expect(SKELETONS.reveal.check([heading, ring(0.4)], "ring")).toBeUndefined();
    expect(SKELETONS.reveal.check([heading, ring(0.1)], "ring")).toMatch(/0\.35/);
  });

  it("kicker: бейдж и заголовок", () => {
    const badge = { block: "badge", text: "2026", at: 0 } as Block;
    expect(SKELETONS.kicker.check([badge, heading, ring(0.2)], "ring")).toBeUndefined();
    expect(SKELETONS.kicker.check([heading, ring(0.2)], "ring")).toMatch(/badge/);
  });
});

describe("dataHeroesFor", () => {
  it("кольцо только для доли, столбцы только для нескольких чисел", () => {
    expect(dataHeroesFor("About $500 more upfront than central AC")).toEqual(["number"]);
    expect(dataHeroesFor("Heat pumps cut emissions by 20% today")).toEqual(["ring", "number"]);
    expect(dataHeroesFor("China installed 216 GW, the EU 56 GW")).toEqual(["bars", "number"]);
    // Год — не второе число для столбцов.
    expect(dataHeroesFor("Sales hit 98,345 units in 2025")).toEqual(["number"]);
  });

  it("сцене с числом без доли код не назначает кольцо", () => {
    const heroes = assignHeroes(
      [
        { intent: "hook", narration: "x" },
        { intent: "number", narration: "It costs about $500 more upfront." },
        { intent: "number", narration: "It costs about $600 more upfront." },
        { intent: "takeaway", narration: "y" },
      ],
      ["hook-statement", "stat-counter", "stat-counter", "outro-cta"],
    );
    expect(heroes.slice(1, 3)).toEqual(["number", "number"]);
  });
});
