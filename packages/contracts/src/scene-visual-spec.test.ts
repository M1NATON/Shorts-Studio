import { describe, expect, it } from "vitest";
import {
  SCENE_VISUAL_KINDS,
  SceneVisualSpecSchema,
  assertNever,
  type SceneVisualSpec,
} from "./scene-visual-spec.js";

const hook = { kind: "hook-statement", text: "Ocean covers 71% of Earth" } as const;

describe("SceneVisualSpec", () => {
  it("разбирает валидную сцену и проставляет default для emphasisWords", () => {
    const parsed = SceneVisualSpecSchema.parse(hook);
    expect(parsed).toEqual({
      ...hook,
      emphasisWords: [],
      variant: "statement",
      layout: "center",
      motion: "rise",
      backdrop: "plain",
      accentShift: 0,
    });
  });

  it("различает ветки по kind", () => {
    const stat = SceneVisualSpecSchema.parse({
      kind: "stat-counter",
      label: "Species undiscovered",
      fromValue: 0,
      toValue: 91,
      unit: "%",
    });
    expect(stat.kind).toBe("stat-counter");
    if (stat.kind === "stat-counter") expect(stat.decimals).toBe(0);
  });

  it("отвергает неизвестный kind, а не пропускает молча", () => {
    expect(SceneVisualSpecSchema.safeParse({ kind: "bar-chart", values: [1, 2] }).success).toBe(false);
  });

  it("отвергает иконку вне закрытого списка (защита от галлюцинации LLM)", () => {
    const res = SceneVisualSpecSchema.safeParse({
      kind: "icon-list",
      items: [
        { icon: "neural-network", text: "Made up icon" },
        { icon: "brain", text: "Real icon" },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("не обрезает текст молча, а отвергает превышение лимита", () => {
    const res = SceneVisualSpecSchema.safeParse({ kind: "hook-statement", text: "x".repeat(91) });
    expect(res.success).toBe(false);
  });

  it.each([
    ["icon-list мало элементов", { kind: "icon-list", items: [{ icon: "brain", text: "one" }] }],
    [
      "icon-list слишком много элементов",
      {
        kind: "icon-list",
        items: Array.from({ length: 5 }, () => ({ icon: "brain", text: "item" })),
      },
    ],
    ["comparison один элемент", { kind: "comparison", items: [{ label: "A", value: "1" }] }],
    ["hook-statement больше 3 акцентов", { kind: "hook-statement", text: "a b c d", emphasisWords: ["a", "b", "c", "d"] }],
  ])("отвергает: %s", (_name, input) => {
    expect(SceneVisualSpecSchema.safeParse(input).success).toBe(false);
  });

  it("SCENE_VISUAL_KINDS покрывает все ветки union", () => {
    const fromSchema = SceneVisualSpecSchema.options.map((o) => o.shape.kind.value);
    expect([...SCENE_VISUAL_KINDS].sort()).toEqual([...fromSchema].sort());
  });

  it("assertNever бросает, если тип не обработан", () => {
    const render = (spec: SceneVisualSpec): string => {
      switch (spec.kind) {
        case "hook-statement":
        case "stat-counter":
        case "icon-list":
        case "comparison":
        case "outro-cta":
          return spec.kind;
        default:
          return assertNever(spec);
      }
    };
    expect(render(SceneVisualSpecSchema.parse(hook))).toBe("hook-statement");
    expect(() => render({ kind: "bar-chart" } as unknown as SceneVisualSpec)).toThrow(/Unhandled/);
  });
});

describe("hook-statement variant", () => {
  it("по умолчанию statement", () => {
    const spec = SceneVisualSpecSchema.parse({ kind: "hook-statement", text: "Nothing here" });
    expect(spec).toMatchObject({ variant: "statement" });
  });

  it("принимает цитату с автором", () => {
    const spec = SceneVisualSpecSchema.parse({
      kind: "hook-statement",
      variant: "quote",
      text: "We know more about Mars than our own seabed",
      attribution: "NOAA",
    });
    expect(spec).toMatchObject({ variant: "quote", attribution: "NOAA" });
  });

  it("отвергает неизвестный variant", () => {
    const res = SceneVisualSpecSchema.safeParse({ kind: "hook-statement", text: "x", variant: "karaoke" });
    expect(res.success).toBe(false);
  });
});

describe("comparison вмещает реальные сцены из замера", () => {
  it("принимает концептуальное сравнение, а не только числа", () => {
    const res = SceneVisualSpecSchema.safeParse({
      kind: "comparison",
      title: "Autonomy levels",
      items: [
        { label: "Level 4", value: "restricted operating domain" },
        { label: "Level 5", value: "all roads and conditions" },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("принимает числовое сравнение с единицами", () => {
    const res = SceneVisualSpecSchema.safeParse({
      kind: "comparison",
      items: [
        { label: "Gemini prompt", value: "0.24 Wh", icon: "zap" },
        { label: "LED bulb", value: "10 W for 86 seconds", icon: "lightbulb" },
      ],
    });
    expect(res.success).toBe(true);
  });
});
