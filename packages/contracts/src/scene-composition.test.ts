import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  BlockSchema,
  SceneCompositionSchema,
  blockSignature,
  compositionCapacity,
  estimateCompositionHeight,
} from "./scene-composition.js";
import { SceneVisualSpecSchema } from "./scene-visual-spec.js";

const heading = { block: "heading", text: "Batteries got cheap" } as const;
const ring = { block: "ring", percent: 89, label: "Price drop since 2010", at: 0.2 } as const;

const scene = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: "composed",
  blocks,
  ...extra,
});

const messages = (input: unknown): string[] => {
  const res = SceneCompositionSchema.safeParse(input);
  return res.success ? [] : res.error.issues.map((i) => i.message);
};

describe("SceneComposition: валидные сцены", () => {
  it("разбирает композицию и проставляет дефолты блоков и подачи", () => {
    const parsed = SceneCompositionSchema.parse(scene([heading, ring]));
    expect(parsed.blocks[0]).toEqual({ ...heading, emphasisWords: [], size: "l", at: 0 });
    expect(parsed.blocks[1]).toMatchObject({ block: "ring", at: 0.2 });
    expect(parsed).toMatchObject({ layout: "center", motion: "rise", backdrop: "plain", accentShift: 0 });
  });

  it("проходит через общий SceneVisualSpecSchema как kind: composed", () => {
    const parsed = SceneVisualSpecSchema.parse(scene([heading, ring]));
    expect(parsed.kind).toBe("composed");
  });

  it("принимает богатую сцену из пяти разных блоков", () => {
    const res = SceneCompositionSchema.safeParse(
      scene([
        { block: "badge", text: "Since 2010" },
        { block: "heading", text: "Cells cost less", size: "m", at: 0.05 },
        { block: "divider", variant: "arrow", at: 0.2 },
        {
          block: "bars",
          items: [
            { label: "2010", value: 1100 },
            { label: "2023", value: 139 },
          ],
          unit: "$/kWh",
          at: 0.3,
        },
        { block: "caption", text: "BloombergNEF pack price survey", at: 0.5 },
      ]),
    );
    expect(res.success).toBe(true);
  });

  it("у каждого блока есть своя ветка схемы", () => {
    const fromSchema = BlockSchema.options.map((o) => o.shape.block.value);
    expect([...BLOCK_TYPES].sort()).toEqual([...fromSchema].sort());
  });
});

describe("SceneComposition: правила кадра", () => {
  it("первый блок обязан появиться сразу — иначе сцена начинается с пустого кадра", () => {
    expect(messages(scene([{ ...heading, at: 0.2 }, { ...ring, at: 0.3 }]))).toEqual([
      expect.stringContaining("first block must have at: 0"),
    ]);
  });

  it("блоки не появляются в обратном порядке", () => {
    expect(messages(scene([heading, { ...ring, at: 0.5 }, { block: "caption", text: "x", at: 0.2 }]))).toEqual([
      expect.stringContaining("at must not decrease"),
    ]);
  });

  it("не больше одного блока с данными", () => {
    const res = messages(
      scene([ring, { block: "number", value: 42, at: 0.3 }].map((b, i) => ({ ...b, at: i * 0.2 }))),
    );
    expect(res).toContainEqual(expect.stringContaining("at most one data block"));
  });

  it("сцена из одного текста отвергается: это слайд, а не кадр", () => {
    expect(messages(scene([heading, { block: "caption", text: "Just words", at: 0.3 }]))).toEqual([
      expect.stringContaining("at least one visual block"),
    ]);
  });

  it("лимит повторов блока в кадре", () => {
    const icon = { block: "icon", icon: "zap" };
    expect(messages(scene([icon, icon]))).toContainEqual(expect.stringContaining('"icon"'));
  });

  it("разделитель не может стоять по краям", () => {
    expect(messages(scene([{ ...ring, at: 0 }, { block: "divider", at: 0.3 }]))).toContainEqual(
      expect.stringContaining("divider must stand between"),
    );
  });

  it("число без дельты — фальшивая статистика", () => {
    expect(messages(scene([{ block: "number", value: 1 }]))).toContainEqual(
      expect.stringContaining("worth animating"),
    );
    expect(messages(scene([{ block: "number", value: 0.24, decimals: 2 }]))).toEqual([]);
  });

  it("столбцы из одних нулей отвергаются", () => {
    const bars = { block: "bars", items: [{ label: "A", value: 0 }, { label: "B", value: 0 }] };
    expect(messages(scene([bars]))).toContainEqual(expect.stringContaining("above zero"));
  });

  it("не больше пяти блоков", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ block: "row", text: `Point ${i}`, at: i * 0.1 }));
    expect(SceneCompositionSchema.safeParse(scene(rows)).success).toBe(false);
  });

  it("отвергает неизвестный блок", () => {
    expect(SceneCompositionSchema.safeParse(scene([{ block: "video", src: "x.mp4" }])).success).toBe(false);
  });

  it("at позже 0.75 сцены отвергается", () => {
    expect(SceneCompositionSchema.safeParse(scene([heading, { ...ring, at: 0.9 }])).success).toBe(false);
  });
});

describe("SceneComposition: вертикальная ёмкость", () => {
  const tall = [
    { block: "heading", text: "A very long heading that wraps onto several lines of the frame", size: "xl" },
    { block: "ring", percent: 40, label: "Share of something rather important", at: 0.1 },
    { block: "row", icon: "zap", text: "A long row that wraps onto the second line", at: 0.2 },
    { block: "row", icon: "leaf", text: "Another long row that wraps onto two lines", at: 0.3 },
  ];

  it("переполненная сцена отвергается с цифрами, по которым модель может исправиться", () => {
    expect(messages(scene(tall))).toEqual([expect.stringMatching(/about \d+px of 1060px/)]);
  });

  it("ёмкость зависит от композиции: stacked теснее center", () => {
    expect(compositionCapacity("stacked")).toBeLessThan(compositionCapacity("center"));
    const medium = SceneCompositionSchema.parse(
      scene([
        { block: "heading", text: "Three reasons it matters", size: "l" },
        { block: "row", icon: "zap", text: "Cheaper cells", at: 0.2 },
        { block: "row", icon: "leaf", text: "Cleaner grid", at: 0.3 },
        { block: "row", icon: "truck", text: "Electric trucks", at: 0.4 },
        { block: "row", icon: "factory", text: "Local factories", at: 0.5 },
      ]),
    );
    const height = estimateCompositionHeight(medium.blocks, "center");
    expect(height).toBeLessThanOrEqual(compositionCapacity("center"));
    expect(height).toBeGreaterThan(compositionCapacity("stacked"));
  });
});

describe("blockSignature", () => {
  it("подпись — последовательность типов блоков", () => {
    expect(blockSignature([{ block: "heading" }, { block: "ring" }])).toBe("heading+ring");
  });
});
