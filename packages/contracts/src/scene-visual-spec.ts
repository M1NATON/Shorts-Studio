import { z } from "zod";
import { presentationFields } from "./presentation.js";

/**
 * Визуальная спецификация сцены — контракт между LLM, Remotion и инспектором.
 *
 * Принципы:
 * - LLM отвечает только за СМЫСЛ (что показать) и ПОДАЧУ из закрытых enum
 *   (presentationFields). Палитра, шрифты, тайминги анимации — зона приложения,
 *   иначе ролик разъедется по стилю от сцены к сцене.
 * - Лимиты жёсткие (без тихой обрезки): превышение → ошибка валидации → retry с уточнением.
 *   Тихий slice испортил бы смысл текста, а не спас бы кадр.
 * - Union расширяемый: добавление ветки не ломает существующие, а `assertNever` в switch
 *   подсветит все места, которые надо дописать.
 */

/**
 * Закрытый список иконок. LLM видит только его (промпт генерируется из схемы),
 * поэтому не может попросить несуществующую иконку.
 * Имена — kebab-case из lucide; соответствие реальному пакету закреплено тестом
 * в @shorts/remotion (icon-registry.test.ts).
 */
export const IconNameSchema = z.enum([
  "activity", "alarm-clock", "atom", "battery", "book-open", "brain", "building-2",
  "calendar", "chart-column", "chart-line", "circle-check", "circle-x", "clock", "coins",
  "cpu", "database", "dollar-sign", "droplet", "eye", "factory", "flame", "globe",
  "graduation-cap", "heart", "leaf", "lightbulb", "lock", "map-pin", "microscope", "moon",
  "percent", "plane", "rocket", "scale", "search", "shield", "smartphone", "sparkles",
  "sun", "target", "thermometer", "timer", "trending-down", "trending-up", "triangle-alert",
  "truck", "users", "wifi", "wrench", "zap",
]);
export type IconName = z.infer<typeof IconNameSchema>;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Хук и универсальный текстовый тип.
 * Он же — обязательный escape hatch: если LLM не уверен в цифрах, он выбирает
 * hook-statement вместо графика с выдуманными числами (см. Plan.md §5).
 */
export const HookStatementSpecSchema = z.object({
  kind: z.literal("hook-statement"),
  /**
   * Подача текста. Замер на 125 сценах показал, что текстовые сцены — 39–48% ролика
   * (см. docs/scene-kinds-measurement.md), из них примерно треть по смыслу является цитатой.
   * Вариант даёт им отдельную визуальную подачу, не заводя шестой тип сцены.
   */
  variant: z.enum(["statement", "quote"]).default("statement"),
  text: text(1, 90),
  /** Слова из `text`, которые выделяются акцентом. Максимум 3, иначе акцент теряет смысл. */
  emphasisWords: z.array(text(1, 24)).max(3).default([]),
  /** Автор цитаты. Осмыслен только при variant: "quote"; для statement рендер его игнорирует. */
  attribution: text(1, 40).optional(),
  ...presentationFields,
});

/**
 * Одно число крупным планом с анимацией счёта.
 *
 * Проверка дельты — защита от фальшивой статистики: модель уже присылала счётчик
 * «1 required» со счётом 0→1. Это и не факт, и анимировать там нечего. Дробная
 * дельта разрешена: 0 → 0.24 Wh — нормальный замер.
 */
export const StatCounterSpecSchema = z
  .object({
    kind: z.literal("stat-counter"),
    label: text(1, 48),
    fromValue: z.number(),
    toValue: z.number(),
    /** "%", "x", "km", "$" — короткий суффикс. */
    unit: text(1, 8).optional(),
    /** Знаков после запятой при анимации счёта. */
    decimals: z.number().int().min(0).max(2).default(0),
    icon: IconNameSchema.optional(),
    ...presentationFields,
  })
  .refine((spec) => Math.abs(spec.toValue - spec.fromValue) >= 2 || spec.decimals > 0, {
    message:
      "stat-counter needs a number worth animating: |toValue - fromValue| >= 2, or decimals > 0",
    path: ["toValue"],
  });

/** 2–4 тезиса с иконками, появляются по очереди (stagger). */
export const IconListSpecSchema = z.object({
  kind: z.literal("icon-list"),
  title: text(1, 48).optional(),
  items: z
    .array(z.object({ icon: IconNameSchema, text: text(1, 48) }))
    .min(2)
    .max(4),
  ...presentationFields,
});

/**
 * "A vs B" / "до–после". Не список: акцент на противопоставлении.
 *
 * Замер на AI-темах (docs/scene-kinds-measurement.md) показал, что сравнение чаще
 * концептуальное, а не числовое: "Level 4: restricted operating domain" против
 * "Level 5: all roads and conditions". Поэтому value — короткая фраза (до 36 символов),
 * а не только число: с лимитом в 24 символа реальные сцены не помещались.
 */
export const ComparisonSpecSchema = z.object({
  kind: z.literal("comparison"),
  title: text(1, 48).optional(),
  items: z
    .array(
      z.object({
        /** Заголовок стороны: "Level 4", "Before", "GPT-4". */
        label: text(1, 20),
        /** Что именно противопоставляется: число с единицей или короткая формулировка. */
        value: text(1, 36),
        icon: IconNameSchema.optional(),
      }),
    )
    .min(2)
    .max(3),
  ...presentationFields,
});

/** Финальный экран: вывод + призыв к действию. */
export const OutroCtaSpecSchema = z.object({
  kind: z.literal("outro-cta"),
  text: text(1, 70),
  subtext: text(1, 60).optional(),
  ...presentationFields,
});

export const SceneVisualSpecSchema = z.discriminatedUnion("kind", [
  HookStatementSpecSchema,
  StatCounterSpecSchema,
  IconListSpecSchema,
  ComparisonSpecSchema,
  OutroCtaSpecSchema,
]);

export type SceneVisualSpec = z.infer<typeof SceneVisualSpecSchema>;
export type SceneVisualKind = SceneVisualSpec["kind"];

export type HookStatementSpec = z.infer<typeof HookStatementSpecSchema>;
export type StatCounterSpec = z.infer<typeof StatCounterSpecSchema>;
export type IconListSpec = z.infer<typeof IconListSpecSchema>;
export type ComparisonSpec = z.infer<typeof ComparisonSpecSchema>;
export type OutroCtaSpec = z.infer<typeof OutroCtaSpecSchema>;

/** Порядок веток union — источник истины для промпта и для UI-селектора типа сцены. */
export const SCENE_VISUAL_KINDS = [
  "hook-statement",
  "stat-counter",
  "icon-list",
  "comparison",
  "outro-cta",
] as const satisfies readonly SceneVisualKind[];

/**
 * Делает switch по `kind` исчерпывающим: при добавлении нового типа сцены
 * компилятор укажет каждое место, где его забыли обработать.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled scene visual kind: ${JSON.stringify(value)}`);
}
