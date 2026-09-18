/**
 * Заготовки для ручного редактора кадра: новый блок и смена типа кадра.
 * Каждая заготовка валидна по схеме — это проверяет visual-defaults.test.ts.
 */
import type { BLOCK_TYPES, SceneVisualSpec } from "@shorts/contracts";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Шаблон нового блока: минимальные валидные поля. */
export const NEW_BLOCK: Record<(typeof BLOCK_TYPES)[number], Record<string, Json>> = {
  heading: { block: "heading", text: "New heading", size: "l" },
  caption: { block: "caption", text: "Caption" },
  number: { block: "number", value: 100, unit: "%" },
  ring: { block: "ring", percent: 50, label: "Share" },
  bars: { block: "bars", items: [{ label: "A", value: 10 }, { label: "B", value: 20 }] },
  row: { block: "row", icon: "zap", text: "Point", emphasis: false },
  chips: { block: "chips", items: ["One", "Two"] },
  badge: { block: "badge", text: "2026" },
  icon: { block: "icon", icon: "sparkles" },
  divider: { block: "divider", variant: "line" },
  quote: { block: "quote", text: "A striking line" },
  pair: { block: "pair", items: [{ label: "Before", value: "A" }, { label: "After", value: "B" }] },
  chapter: { block: "chapter", index: 1, title: "Chapter title" },
};

/** Заготовка каждого типа кадра — смена типа руками, без ИИ. Подача сцены сохраняется. */
export const KIND_DEFAULTS: Record<SceneVisualSpec["kind"], Record<string, Json>> = {
  composed: { kind: "composed", blocks: [{ block: "heading", text: "Heading", size: "l", at: 0 }, { block: "icon", icon: "sparkles", at: 0.2 }] },
  "hook-statement": { kind: "hook-statement", variant: "statement", text: "One striking line", emphasisWords: [] },
  "stat-counter": { kind: "stat-counter", label: "What the number means", fromValue: 0, toValue: 100, unit: "%", decimals: 0 },
  "icon-list": { kind: "icon-list", title: "Title", items: [{ icon: "zap", text: "First point" }, { icon: "leaf", text: "Second point" }] },
  comparison: { kind: "comparison", title: "Title", items: [{ label: "A", value: "First" }, { label: "B", value: "Second" }] },
  "kinetic-text": { kind: "kinetic-text", lines: ["Short line", "Key line"], emphasisLine: 1 },
  timeline: { kind: "timeline", title: "Title", steps: [{ label: "Step 1", text: "First" }, { label: "Step 2", text: "Then" }] },
  "outro-cta": { kind: "outro-cta", text: "The takeaway", subtext: "One more line" },
};

