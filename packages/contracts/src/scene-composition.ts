import { z } from "zod";
import { IconNameSchema } from "./icons.js";
import { FORMATS, stageSize, type VideoFormat } from "./format.js";
import {
  LAYOUT_ZONE_PADDING,
  SceneMotionKindSchema,
  presentationFields,
  type SceneLayout,
} from "./presentation.js";

/**
 * Грамматика сцены: модель собирает кадр из блоков, а не выбирает шаблон.
 *
 * Семь фиксированных типов сцен дают семь картинок — после двух роликов зритель
 * узнаёт каждую. Двенадцать блоков по одному-пяти в кадре, со своим моментом
 * появления и движением, дают тысячи сочетаний, и модель подбирает сочетание под
 * смысл конкретной фразы.
 *
 * Модель по-прежнему отдаёт данные, а не код: каждый блок — закрытая схема с
 * лимитами, а правила композиции (плотность, порядок, вертикальная ёмкость)
 * проверяются здесь. Поэтому кадр предсказуем, а рендер детерминирован.
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Самое позднее появление блока, доля сцены. Позже зритель не успевает его прочитать до склейки. */
export const BLOCK_AT_MAX = 0.75;

/**
 * Когда и как блок входит в кадр.
 *
 * `at` — доля длительности сцены, а не кадры: длительность известна только после
 * озвучки, и доли переживают любую длину без пересчёта.
 * `motion` не задан → берётся движение сцены.
 */
const entrance = {
  at: z.number().min(0).max(BLOCK_AT_MAX).default(0),
  motion: SceneMotionKindSchema.optional(),
};

/** Заголовок: главная фраза кадра. */
export const HeadingBlockSchema = z.object({
  block: z.literal("heading"),
  text: text(1, 90),
  emphasisWords: z.array(text(1, 24)).max(3).default([]),
  size: z.enum(["xl", "l", "m"]).default("l"),
  ...entrance,
});

/** Поясняющая строка вторичным цветом. */
export const CaptionBlockSchema = z.object({
  block: z.literal("caption"),
  text: text(1, 60),
  ...entrance,
});

/** Крупное число со счётом от `from` до `value`. */
export const NumberBlockSchema = z.object({
  block: z.literal("number"),
  value: z.number(),
  from: z.number().default(0),
  unit: text(1, 8).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
  caption: text(1, 48).optional(),
  ...entrance,
});

/** Кольцевая диаграмма доли: 0–100%. */
export const RingBlockSchema = z.object({
  block: z.literal("ring"),
  percent: z.number().min(0).max(100),
  label: text(1, 40),
  ...entrance,
});

/** Горизонтальные столбцы: 2–4 величины одной размерности. */
export const BarsBlockSchema = z.object({
  block: z.literal("bars"),
  items: z
    .array(z.object({ label: text(1, 18), value: z.number().min(0) }))
    .min(2)
    .max(4),
  unit: text(1, 8).optional(),
  ...entrance,
});

/** Строка-карточка: иконка, метка и тезис. Несколько подряд образуют список. */
export const RowBlockSchema = z.object({
  block: z.literal("row"),
  icon: IconNameSchema.optional(),
  label: text(1, 20).optional(),
  text: text(1, 48),
  emphasis: z.boolean().default(false),
  ...entrance,
});

/** Облако коротких тегов. */
export const ChipsBlockSchema = z.object({
  block: z.literal("chips"),
  items: z.array(text(1, 16)).min(2).max(5),
  ...entrance,
});

/** Плашка-надзаголовок: рубрика, год, категория. */
export const BadgeBlockSchema = z.object({
  block: z.literal("badge"),
  text: text(1, 18),
  ...entrance,
});

/** Крупная иконка-символ сцены. */
export const IconBlockSchema = z.object({
  block: z.literal("icon"),
  icon: IconNameSchema,
  caption: text(1, 30).optional(),
  ...entrance,
});

/** Разделитель: линия, «VS» или стрелка «следовательно». */
export const DividerBlockSchema = z.object({
  block: z.literal("divider"),
  variant: z.enum(["line", "vs", "arrow"]).default("line"),
  ...entrance,
});

/** Цитата с автором. */
export const QuoteBlockSchema = z.object({
  block: z.literal("quote"),
  text: text(1, 90),
  attribution: text(1, 40).optional(),
  ...entrance,
});

/** Две карточки рядом: короткое «было / стало», «A / B». */
export const PairBlockSchema = z.object({
  block: z.literal("pair"),
  items: z
    .array(z.object({ label: text(1, 16), value: text(1, 24), icon: IconNameSchema.optional() }))
    .length(2),
  ...entrance,
});

/**
 * Титульная карточка главы длинного ролика: номер, название, надзаголовок.
 * Генерируется кодом из плана глав, модель её не собирает.
 */
export const ChapterBlockSchema = z.object({
  block: z.literal("chapter"),
  index: z.number().int().min(1).max(99),
  title: text(1, 60),
  kicker: text(1, 32).optional(),
  ...entrance,
});

export const BlockSchema = z.discriminatedUnion("block", [
  HeadingBlockSchema,
  CaptionBlockSchema,
  NumberBlockSchema,
  RingBlockSchema,
  BarsBlockSchema,
  RowBlockSchema,
  ChipsBlockSchema,
  BadgeBlockSchema,
  IconBlockSchema,
  DividerBlockSchema,
  QuoteBlockSchema,
  PairBlockSchema,
  ChapterBlockSchema,
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockType = Block["block"];
export type BlockOf<T extends BlockType> = Extract<Block, { block: T }>;

export const BLOCK_TYPES = [
  "heading",
  "caption",
  "number",
  "ring",
  "bars",
  "row",
  "chips",
  "badge",
  "icon",
  "divider",
  "quote",
  "pair",
  "chapter",
] as const satisfies readonly BlockType[];

/** Блоки с данными: в кадре не больше одного, иначе цифры спорят друг с другом. */
export const DATA_BLOCKS: ReadonlySet<BlockType> = new Set(["number", "ring", "bars"]);

/**
 * Блоки, которые делают кадр картинкой, а не абзацем. Сцена из одних
 * heading + caption — это тот же hook-statement, от которого мы уходим.
 */
export const VISUAL_BLOCKS: ReadonlySet<BlockType> = new Set([
  "number",
  "ring",
  "bars",
  "row",
  "chips",
  "icon",
  "quote",
  "pair",
  "chapter",
]);

/** Сколько раз блок может встретиться в одном кадре. */
export const BLOCK_MAX_PER_SCENE: Record<BlockType, number> = {
  heading: 2,
  caption: 2,
  number: 1,
  ring: 1,
  bars: 1,
  row: 4,
  chips: 1,
  badge: 1,
  icon: 1,
  divider: 1,
  quote: 1,
  pair: 1,
  chapter: 1,
};

export const MAX_BLOCKS_PER_SCENE = 5;

/**
 * Типографика блоков в пикселях кадра 1080×1920.
 *
 * Одна таблица на валидатор и рендер: высота блока оценивается по тем же кеглям,
 * которыми он будет нарисован, поэтому «влезает» в контракте значит «влезает» в MP4.
 */
export const BLOCK_TYPE = {
  gap: 28,
  /** Средняя ширина глифа в долях кегля — с запасом для жирного начертания. */
  glyph: 0.56,
  heading: { xl: 104, l: 84, m: 66, lineHeight: 1.08 },
  caption: { size: 44, lineHeight: 1.25 },
  number: { size: 190, unitSize: 88, captionSize: 44, captionGap: 12 },
  ring: { diameter: 340, stroke: 30, valueSize: 96, labelSize: 44, labelGap: 18 },
  bars: { labelSize: 38, barHeight: 44, labelGap: 8, rowGap: 22 },
  row: { size: 50, labelSize: 32, iconBox: 88, padding: 22, iconGap: 26, lineHeight: 1.15 },
  chips: { size: 48, padX: 32, padY: 18, gap: 18 },
  badge: { size: 34, padX: 26, padY: 12 },
  icon: { box: 220, glyph: 128, captionSize: 42, captionGap: 16 },
  divider: { line: 6, vs: 110, arrow: 90 },
  quote: { size: 62, markHeight: 90, attributionSize: 38, attributionGap: 16, lineHeight: 1.15 },
  pair: { labelSize: 32, valueSize: 48, padding: 26, iconSize: 56, gap: 24, lineHeight: 1.15 },
  chapter: { kickerSize: 38, indexSize: 180, titleSize: 96, gap: 20, lineHeight: 1.08 },
  /** Промежуток между колонками раскладки split. */
  splitGutter: 160,
} as const;

const T = BLOCK_TYPE;

/**
 * Число строк при переносе по словам. Множитель 1.12 — потери на переносе:
 * слово, не влезшее в строку, уходит целиком и оставляет хвост пустоты.
 */
export function estimateLines(value: string, fontSize: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (fontSize * T.glyph)));
  return Math.max(1, Math.ceil((value.length * 1.12) / perLine));
}

/**
 * Реальные пиксели → дизайн-пиксели формата при данном zoom (см. stageSize).
 * Нужна только для `reservePx` — полосы кадра, отданной под бумажный полароид
 * (paper + медиа, см. packages/remotion/src/paper/mediaZone.ts): полоса
 * фиксирована в реальных пикселях, а дизайн-эквивалент зависит от zoom.
 */
function designReserve(format: VideoFormat, zoom: number, reservePx: number): number {
  if (reservePx === 0) return 0;
  return reservePx / (FORMATS[format].scale * zoom);
}

/**
 * Ширина зоны контента для композиции, в дизайн-пикселях формата.
 * У split — ширина одной колонки. `zoom` > 1 — сцена увеличена на кадре, поэтому
 * в дизайн-пикселях ширина зоны меньше (см. stageSize). `reservePx` — см. designReserve.
 */
export function contentWidth(layout: SceneLayout, format: VideoFormat = "shorts", zoom = 1, reservePx = 0): number {
  const available = stageSize(format, zoom).width - designReserve(format, zoom, reservePx);
  if (layout === "split") return Math.floor((available - T.splitGutter) / 2);
  return available - LAYOUT_ZONE_PADDING[layout].left;
}

/** Доступная высота под блоки с учётом сдвига оптического центра и `reservePx` (см. designReserve). */
export function compositionCapacity(layout: SceneLayout, format: VideoFormat = "shorts", zoom = 1, reservePx = 0): number {
  const pad = LAYOUT_ZONE_PADDING[layout];
  return stageSize(format, zoom).height - pad.top - pad.bottom - designReserve(format, zoom, reservePx);
}

/**
 * Блоки левой колонки split: текст. Всё остальное — визуал, правая колонка.
 * Разбиение делает код, а не модель: одна функция на валидатор и рендер.
 */
export const SPLIT_TEXT_BLOCKS: ReadonlySet<BlockType> = new Set(["heading", "caption", "badge", "quote", "chapter"]);

export function splitColumns<B extends Pick<Block, "block">>(blocks: readonly B[]): { text: B[]; visual: B[] } {
  return {
    text: blocks.filter((b) => SPLIT_TEXT_BLOCKS.has(b.block)),
    visual: blocks.filter((b) => !SPLIT_TEXT_BLOCKS.has(b.block)),
  };
}

/** Ожидаемая высота блока в пикселях — без браузера, по таблице кеглей. */
export function estimateBlockHeight(block: Block, width: number): number {
  switch (block.block) {
    case "heading": {
      const size = T.heading[block.size];
      return estimateLines(block.text, size, width) * size * T.heading.lineHeight;
    }
    case "caption":
      return estimateLines(block.text, T.caption.size, width) * T.caption.size * T.caption.lineHeight;
    case "number":
      return (
        T.number.size +
        (block.caption
          ? T.number.captionGap +
            estimateLines(block.caption, T.number.captionSize, width) * T.number.captionSize * 1.25
          : 0)
      );
    case "ring":
      return (
        T.ring.diameter +
        T.ring.labelGap +
        estimateLines(block.label, T.ring.labelSize, width) * T.ring.labelSize * 1.25
      );
    case "bars": {
      const row = T.bars.labelSize * 1.2 + T.bars.labelGap + T.bars.barHeight;
      return block.items.length * row + (block.items.length - 1) * T.bars.rowGap;
    }
    case "row": {
      const textWidth = width - T.row.padding * 2 - T.row.iconBox - T.row.iconGap;
      const lines = estimateLines(block.text, T.row.size, textWidth);
      const body =
        lines * T.row.size * T.row.lineHeight + (block.label ? T.row.labelSize * 1.2 : 0);
      return Math.max(T.row.iconBox, body) + T.row.padding * 2;
    }
    case "chips": {
      let lines = 1;
      let used = 0;
      for (const item of block.items) {
        const chip = item.length * T.chips.size * T.glyph + T.chips.padX * 2;
        if (used > 0 && used + T.chips.gap + chip > width) {
          lines++;
          used = chip;
        } else {
          used += (used > 0 ? T.chips.gap : 0) + chip;
        }
      }
      const chipHeight = T.chips.size * 1.2 + T.chips.padY * 2;
      return lines * chipHeight + (lines - 1) * T.chips.gap;
    }
    case "badge":
      return T.badge.size * 1.2 + T.badge.padY * 2;
    case "icon":
      return (
        T.icon.box +
        (block.caption ? T.icon.captionGap + T.icon.captionSize * 1.25 : 0)
      );
    case "divider":
      return T.divider[block.variant];
    case "quote":
      return (
        T.quote.markHeight +
        estimateLines(block.text, T.quote.size, width) * T.quote.size * T.quote.lineHeight +
        (block.attribution ? T.quote.attributionGap + T.quote.attributionSize * 1.25 : 0)
      );
    case "chapter":
      return (
        (block.kicker ? T.chapter.kickerSize * 1.2 + T.chapter.gap : 0) +
        T.chapter.indexSize +
        T.chapter.gap +
        estimateLines(block.title, T.chapter.titleSize, width) * T.chapter.titleSize * T.chapter.lineHeight
      );
    case "pair": {
      const column = (width - T.pair.gap) / 2 - T.pair.padding * 2;
      const lines = Math.max(
        ...block.items.map((item) => estimateLines(item.value, T.pair.valueSize, column)),
      );
      const hasIcon = block.items.some((item) => item.icon);
      return (
        T.pair.padding * 2 +
        (hasIcon ? T.pair.iconSize + 12 : 0) +
        T.pair.labelSize * 1.2 +
        10 +
        lines * T.pair.valueSize * T.pair.lineHeight
      );
    }
  }
}

const stackHeight = (blocks: readonly Block[], width: number): number =>
  blocks.reduce((sum, block) => sum + estimateBlockHeight(block, width), 0) +
  Math.max(0, blocks.length - 1) * T.gap;

/**
 * Высота всей композиции: блоки плюс зазоры между ними. У split — высота
 * более высокой колонки; если одна колонка пуста, сцена рисуется одной стопкой.
 */
export function estimateCompositionHeight(
  blocks: readonly Block[],
  layout: SceneLayout,
  format: VideoFormat = "shorts",
  zoom = 1,
  reserveWidthPx = 0,
): number {
  if (layout === "split") {
    const { text, visual } = splitColumns(blocks);
    if (text.length > 0 && visual.length > 0) {
      const width = contentWidth("split", format, zoom, reserveWidthPx);
      return Math.round(Math.max(stackHeight(text, width), stackHeight(visual, width)));
    }
    return Math.round(stackHeight(blocks, contentWidth("center", format, zoom, reserveWidthPx)));
  }
  return Math.round(stackHeight(blocks, contentWidth(layout, format, zoom, reserveWidthPx)));
}

/**
 * Во сколько раз можно увеличить сцену из блоков, чтобы она заняла кадр, но влезла.
 * (комментарий по-русски: валидатор гарантирует, что при zoom=1 влезает; крупнее —
 * меньше ширина сцены в дизайн-пикселях, текст переносится, высота растёт; ищем максимум)
 */
/**
 * `reserve` — полоса кадра под бумажный полароид (paper + медиа), в реальных
 * пикселях: по ширине (landscape, сцена сужается) или по высоте (shorts, сцена
 * сдвигается вниз). См. packages/remotion/src/paper/mediaZone.ts.
 */
export function fitZoom(
  blocks: readonly Block[],
  layout: SceneLayout,
  format: VideoFormat,
  maxZoom: number,
  reserve: { widthPx?: number; heightPx?: number } = {},
): number {
  const top = Math.max(1, maxZoom);
  for (let zoom = top; zoom > 1; zoom -= 0.05) {
    const height = estimateCompositionHeight(blocks, layout, format, zoom, reserve.widthPx ?? 0);
    const capacity = compositionCapacity(layout, format, zoom, reserve.heightPx ?? 0);
    if (height <= capacity) return zoom;
  }
  return 1;
}

/**
 * Правила кадра, которые зависят от формата: ёмкость и раскладка split.
 * Схема сцены их не проверяет — формат знает сценарий и манифест, а не сцена.
 */
export function compositionFitIssues(
  scene: { kind: string; layout: SceneLayout; blocks?: readonly Block[] },
  format: VideoFormat = "shorts",
): string[] {
  const issues: string[] = [];
  if (scene.layout === "split") {
    if (format !== "landscape") issues.push('layout "split" is only for 16:9 videos');
    if (scene.kind !== "composed") issues.push('layout "split" is only for scenes composed from blocks');
  }
  if (scene.kind !== "composed" || !scene.blocks) return issues;
  const height = estimateCompositionHeight(scene.blocks, scene.layout, format);
  const capacity = compositionCapacity(scene.layout, format);
  if (height > capacity) {
    issues.push(
      `the blocks do not fit the frame: about ${height}px of ${capacity}px; drop a block or shorten the text`,
    );
  }
  return issues;
}

/**
 * Подпись композиции: последовательность типов блоков. Две сцены с одной
 * подписью зритель воспринимает как один и тот же кадр с другим текстом —
 * по ней планировщик разводит соседние сцены.
 */
export function blockSignature(blocks: readonly Pick<Block, "block">[]): string {
  return blocks.map((b) => b.block).join("+");
}

export const SceneCompositionSchema = z
  .object({
    kind: z.literal("composed"),
    blocks: z.array(BlockSchema).min(1).max(MAX_BLOCKS_PER_SCENE),
    ...presentationFields,
  })
  .superRefine((scene, ctx) => {
    const { blocks } = scene;
    const issue = (message: string, path: (string | number)[] = ["blocks"]) =>
      ctx.addIssue({ code: "custom", message, path });

    if (blocks[0] && blocks[0].at !== 0) {
      issue("the first block must have at: 0, otherwise the scene opens on an empty frame", [
        "blocks",
        0,
        "at",
      ]);
    }
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i]!.at < blocks[i - 1]!.at) {
        issue("blocks must appear top to bottom: at must not decrease", ["blocks", i, "at"]);
      }
    }

    const counts = new Map<BlockType, number>();
    for (const block of blocks) counts.set(block.block, (counts.get(block.block) ?? 0) + 1);
    for (const [type, count] of counts) {
      if (count > BLOCK_MAX_PER_SCENE[type]) {
        issue(`at most ${BLOCK_MAX_PER_SCENE[type]} "${type}" block(s) per scene, got ${count}`);
      }
    }
    const dataCount = blocks.filter((b) => DATA_BLOCKS.has(b.block)).length;
    if (dataCount > 1) issue(`at most one data block (number, ring, bars) per scene, got ${dataCount}`);
    if (!blocks.some((b) => VISUAL_BLOCKS.has(b.block))) {
      issue(
        `the scene needs at least one visual block (${[...VISUAL_BLOCKS].join(", ")}); heading and caption alone are a text slide`,
      );
    }

    blocks.forEach((block, i) => {
      if (block.block === "divider" && (i === 0 || i === blocks.length - 1)) {
        issue("a divider must stand between two blocks", ["blocks", i, "block"]);
      }
      if (block.block === "number" && Math.abs(block.value - block.from) < 2 && block.decimals === 0) {
        issue("number needs a figure worth animating: |value - from| >= 2, or decimals > 0", [
          "blocks",
          i,
          "value",
        ]);
      }
      if (block.block === "bars" && !block.items.some((item) => item.value > 0)) {
        issue("bars need at least one value above zero", ["blocks", i, "items"]);
      }
    });

    // Ёмкость кадра зависит от формата и проверяется в compositionFitIssues —
    // её вызывают схемы сценария и манифеста, которые формат знают.
  });

export type SceneComposition = z.infer<typeof SceneCompositionSchema>;
