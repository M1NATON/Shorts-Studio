import { z } from "zod";
import { SceneVisualSpecSchema } from "./scene-visual-spec.js";

export const FpsSchema = z.union([z.literal(24), z.literal(25), z.literal(30)]);
export type Fps = z.infer<typeof FpsSchema>;

/**
 * Лимит длины озвучки сцены.
 *
 * Замер на реальном TTS (Fish, голос проекта): 13.2 символа в секунду.
 * Прежний лимит 260 символов означал 20 секунд на сцену — при таком темпе видео
 * физически не может быть динамичным, каким бы ни был компонент. 110 символов ≈ 8 с
 * это потолок, а цель — NARRATION_TARGET_CHARS.
 *
 * Валидация жёсткая: LLM получит retry, а не обрезанный смысл.
 */
export const NARRATION_MAX_CHARS = 110;

/** Ориентир для промпта: 40–70 символов ≈ 3–5 с, то есть один ёмкий тезис на сцену. */
export const NARRATION_TARGET_CHARS = { min: 40, max: 70 } as const;

/** Средняя скорость озвучки, символов в секунду. Замер, не оценка. */
export const SPEECH_CHARS_PER_SEC = 13.2;

export const SceneSchema = z.object({
  id: z.string().min(1),
  /** Текст озвучки, английский. Один факт на сцену. */
  narration: z.string().trim().min(1).max(NARRATION_MAX_CHARS),
  visual: SceneVisualSpecSchema,
});
export type Scene = z.infer<typeof SceneSchema>;

/**
 * Границы числа сцен.
 *
 * Минимум 5 — при меньшем числе сцена неизбежно растягивается и видео становится
 * слайд-шоу. Максимум 9 — дальше при лимите озвучки суммарная длительность уходит
 * за комфортные ~45 с для Shorts, и каждая сцена не успевает прочитаться.
 */
export const SCENE_COUNT_RANGE = { min: 5, max: 9 } as const;

export const ScriptSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** MVP: только английский, но поле явное — язык влияет на TTS и на alignment. */
  language: z.literal("en").default("en"),
  fps: FpsSchema.default(30),
  scenes: z.array(SceneSchema).min(SCENE_COUNT_RANGE.min).max(SCENE_COUNT_RANGE.max),
});
export type Script = z.infer<typeof ScriptSchema>;
