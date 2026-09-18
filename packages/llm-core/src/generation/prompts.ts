/**
 * Контракты и примеры для промптов наполнения — компактно, только нужный кусок.
 *
 * Пример ответа обязателен: без него модель на расплывчатом тезисе отвечала
 * описанием вместо данных ({"visual": "1. Extract and prepare materials"}).
 */
import { BLOCK_AT_MAX, IconNameSchema, type SceneVisualKind } from "@shorts/contracts";
import type { HeroBlock } from "./plan.js";

export const KIND_CONTRACT: Partial<Record<SceneVisualKind, string>> = {
  "hook-statement": [
    '{ "variant": "statement" | "quote", "text": string max 90,',
    '  "emphasisWords": array of up to 3 words copied exactly from text,',
    '  "attribution": string max 40, only with variant "quote" }',
  ].join("\n"),
  "stat-counter": [
    '{ "label": string max 48, "fromValue": number, "toValue": number,',
    '  "unit": string max 8 (optional), "decimals": 0 | 1 | 2, "icon": icon name (optional) }',
    "fromValue is where the counter starts (usually 0), toValue is the real documented figure.",
    "|toValue - fromValue| must be at least 2, unless decimals > 0.",
  ].join("\n"),
  "icon-list": '{ "title": string max 48 (optional), "items": 2 to 4 of { "icon": icon name, "text": string max 48 } }',
  comparison: [
    '{ "title": string max 48 (optional),',
    '  "items": 2 or 3 of { "label": string max 20, "value": string max 36, "icon": icon name (optional) } }',
  ].join("\n"),
  // В .mjs-версии контракта для этих двух типов не было — в промпт уходило "undefined".
  "kinetic-text": '{ "lines": 2 to 4 strings, each max 28, "emphasisLine": index of the key line (optional) }',
  timeline: '{ "title": string max 48 (optional), "steps": 2 to 4 of { "label": string max 18, "text": string max 44 } }',
  "outro-cta": '{ "text": string max 70, "subtext": string max 60 (optional) }',
};

export const KIND_EXAMPLE: Partial<Record<SceneVisualKind, string>> = {
  "hook-statement": '{"variant":"statement","text":"Fusion has missed every deadline","emphasisWords":["every"]}',
  "stat-counter": '{"label":"Median prompt energy","fromValue":0,"toValue":0.24,"unit":"Wh","decimals":2,"icon":"zap"}',
  "icon-list": '{"title":"What drives cost","items":[{"icon":"cpu","text":"Chip supply"},{"icon":"factory","text":"Plant capacity"}]}',
  comparison: '{"title":"Two approaches","items":[{"label":"Tokamak","value":"Magnetic confinement"},{"label":"Laser","value":"Inertial confinement"}]}',
  "kinetic-text": '{"lines":["Ten years away","for fifty years"],"emphasisLine":1}',
  timeline: '{"title":"Electrode line","steps":[{"label":"Coating","text":"Apply active material"},{"label":"Drying","text":"Remove solvent"}]}',
  "outro-cta": '{"text":"Watch the energy, not the hype","subtext":"Numbers beat promises"}',
};

export const NEEDS_ICONS = new Set<SceneVisualKind>(["stat-counter", "icon-list", "comparison"]);

export const BLOCK_CONTRACT = [
  '{ "blocks": [ 1 to 5 blocks, top to bottom ] }',
  "Every block may carry:",
  `  "at": when it appears, share of the scene 0..${BLOCK_AT_MAX} (first block 0; never decreasing),`,
  '  "motion": "rise" | "slide" | "pop" | "fade" (optional).',
  "Blocks:",
  '  { "block": "heading", "text": max 90, "emphasisWords": up to 3 words from text, "size": "xl" | "l" | "m" }',
  '  { "block": "caption", "text": max 60 }  secondary line',
  '  { "block": "number", "value": number, "from": number (default 0), "unit": max 8, "decimals": 0..2, "caption": max 48 }',
  '  { "block": "ring", "percent": 0..100, "label": max 40 }  share of a whole',
  '  { "block": "bars", "items": 2-4 of { "label": max 18, "value": number >= 0 }, "unit": max 8 }',
  '  { "block": "row", "icon": icon name (optional), "label": max 20 (optional), "text": max 48, "emphasis": boolean }',
  '  { "block": "chips", "items": 2-5 strings, each max 16 }  tags, names, categories',
  '  { "block": "badge", "text": max 18 }  small kicker above a heading: year, rubric',
  '  { "block": "icon", "icon": icon name, "caption": max 30 (optional) }  one big symbol',
  '  { "block": "divider", "variant": "line" | "vs" | "arrow" }  only between two blocks',
  '  { "block": "quote", "text": max 90, "attribution": max 40 (optional) }',
  '  { "block": "pair", "items": exactly 2 of { "label": max 16, "value": max 24, "icon": optional } }',
  "Rules checked by code:",
  "- at most one of number / ring / bars; at least one block that is not heading, caption, badge or divider;",
  "- the frame holds about 1000px: two rows plus a ring already fill it, so prefer 2-4 blocks;",
  "- number: |value - from| >= 2 unless decimals > 0.",
].join("\n");

/** Что главный блок значит для модели: без пояснения она ставит кольцо на любое число. */
export const HERO_HINT: Record<HeroBlock, string> = {
  ring: "a ring: the narration states a share or percentage of a whole",
  number: "a number: one real figure from the narration or sources, counted up",
  bars: "bars: two to four comparable values of the same unit",
  pair: "a pair: two sides, before/after or A versus B",
  divider: 'a "vs" or "arrow" divider between two contrasting blocks',
  row: "rows: one to four short points, the key one with emphasis",
  chips: "chips: several short names, tags or categories",
  icon: "a big icon: one symbol that carries the idea",
  quote: "a quote: a striking line, attributed only if the narration names who said it",
};

/**
 * Точная форма главного блока. Общего примера мало: на «pair» модель трижды
 * присылала то неизвестный блок, то pair без items, и сцена уходила в откат.
 */
export const HERO_EXAMPLE: Record<HeroBlock, object> = {
  ring: { block: "ring", percent: 62, label: "Share of new cars that are electric" },
  number: { block: "number", value: 139, unit: "$/kWh", caption: "Average pack price in 2023" },
  bars: { block: "bars", unit: "GW", items: [{ label: "China", value: 216 }, { label: "EU", value: 56 }] },
  pair: { block: "pair", items: [{ label: "2015", value: "$390/kWh", icon: "trending-down" }, { label: "2023", value: "$139/kWh" }] },
  divider: { block: "divider", variant: "vs" },
  row: { block: "row", icon: "zap", label: "Cost", text: "Cells got 90% cheaper", emphasis: true },
  chips: { block: "chips", items: ["Tesla", "BYD", "CATL"] },
  icon: { block: "icon", icon: "rocket", caption: "Launch cadence" },
  quote: { block: "quote", text: "Batteries are the new oil", attribution: "IEA" },
};

export const ICON_LIST = IconNameSchema.options.join(", ");
