import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  BlockSchema,
  SceneCompositionSchema,
  blockSignature,
  compositionCapacity,
  compositionFitIssues,
  contentWidth,
  estimateCompositionHeight,
  fitZoom,
  splitColumns,
} from "./scene-composition.js";
import { SceneVisualSpecSchema, visualSpecSchemaFor } from "./scene-visual-spec.js";
import { stageSize } from "./format.js";

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
    // Ёмкость зависит от формата, поэтому её проверяет схема формата, а не схема сцены.
    expect(messages(scene(tall))).toEqual([]);
    const result = visualSpecSchemaFor("shorts").safeParse(scene(tall));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message)).toEqual([expect.stringMatching(/about \d+px of 1060px/)]);
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

describe("fitZoom", () => {
  const dense = SceneCompositionSchema.parse(
    scene([
      { block: "heading", text: "Three reasons it matters", size: "l" },
      { block: "row", icon: "zap", text: "Cheaper cells", at: 0.2 },
      { block: "row", icon: "leaf", text: "Cleaner grid", at: 0.3 },
      { block: "row", icon: "truck", text: "Electric trucks", at: 0.4 },
      { block: "row", icon: "factory", text: "Local factories", at: 0.5 },
    ]),
  ).blocks;

  it("одиночный короткий heading укрупняется сильно", () => {
    const blocks = [BlockSchema.parse(heading)];
    const zoom = fitZoom(blocks, "center", "shorts", 1.6);
    expect(zoom).toBeGreaterThan(1.3);
    expect(estimateCompositionHeight(blocks, "center", "shorts", zoom)).toBeLessThanOrEqual(
      compositionCapacity("center", "shorts", zoom),
    );
  });

  it("плотная сцена укрупняется заметно меньше, чем одиночный heading", () => {
    const zoom = fitZoom(dense, "center", "shorts", 1.6);
    expect(zoom).toBeLessThan(fitZoom([BlockSchema.parse(heading)], "center", "shorts", 1.6));
    expect(estimateCompositionHeight(dense, "center", "shorts", zoom)).toBeLessThanOrEqual(
      compositionCapacity("center", "shorts", zoom),
    );
  });
});

describe("blockSignature", () => {
  it("подпись — последовательность типов блоков", () => {
    expect(blockSignature([{ block: "heading" }, { block: "ring" }])).toBe("heading+ring");
  });
});

describe("форматы: 16:9", () => {
  const split = (blocks: unknown[]) => ({ kind: "composed", layout: "split", blocks });
  const textAndRing = [
    { block: "heading", text: "Battery packs got cheaper every single year", size: "l" },
    { block: "caption", text: "Average pack price, BloombergNEF", at: 0.1 },
    { block: "ring", percent: 89, label: "Drop since 2010", at: 0.2 },
  ];

  it("сцена 16:9 в дизайн-пикселях: шире вертикальной, той же высоты", () => {
    expect(stageSize("shorts")).toEqual({ width: 920, height: 1060 });
    expect(stageSize("landscape").width).toBeGreaterThan(2000);
    expect(Math.abs(stageSize("landscape").height - 1060)).toBeLessThan(10);
  });

  it("zoom уменьшает сцену в дизайн-пикселях вдвое при zoom=2", () => {
    const base = stageSize("shorts");
    const zoomed = stageSize("shorts", 2);
    expect(zoomed).toEqual({ width: base.width / 2, height: base.height / 2 });
  });

  it("split: текст слева, визуал справа, высота — по более высокой колонке", () => {
    const parsed = SceneCompositionSchema.parse(split(textAndRing));
    const { text, visual } = splitColumns(parsed.blocks);
    expect(text.map((b) => b.block)).toEqual(["heading", "caption"]);
    expect(visual.map((b) => b.block)).toEqual(["ring"]);
    expect(contentWidth("split", "landscape")).toBeGreaterThan(contentWidth("center", "shorts"));
    expect(estimateCompositionHeight(parsed.blocks, "split", "landscape")).toBeLessThan(
      estimateCompositionHeight(parsed.blocks, "center", "shorts"),
    );
  });

  it("split только в 16:9 и только у сцены из блоков", () => {
    expect(visualSpecSchemaFor("landscape").safeParse(split(textAndRing)).success).toBe(true);
    expect(compositionFitIssues(SceneCompositionSchema.parse(split(textAndRing)), "shorts")).toEqual([
      expect.stringMatching(/only for 16:9/),
    ]);
    const hook = { kind: "hook-statement", text: "Hi", layout: "split" };
    expect(visualSpecSchemaFor("landscape").safeParse(hook).success).toBe(false);
  });

  it("глава — визуальный блок: сцена из одной карточки главы валидна", () => {
    const chapter = { kind: "composed", layout: "center", blocks: [{ block: "chapter", index: 2, title: "Why prices fell", kicker: "Chapter" }] };
    expect(visualSpecSchemaFor("landscape").safeParse(chapter).success).toBe(true);
  });
});
