import { z } from "zod";
import { FORMATS, VideoFormatSchema, type VideoFormat } from "./format.js";
import { compositionFitIssues } from "./scene-composition.js";
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

/**
 * Замысел сцены — что тезис делает в ролике. Хранится, чтобы пересборка одной
 * сцены знала, какие главные блоки ей подходят (кольцо — доле, пара — контрасту),
 * а не угадывала по готовому кадру.
 */
export const SceneIntentSchema = z.enum([
  "hook",
  "fact",
  "number",
  "contrast",
  "list",
  "sequence",
  "punch",
  "takeaway",
]);
export type SceneIntent = z.infer<typeof SceneIntentSchema>;

export const SceneSchema = z.object({
  id: z.string().min(1),
  intent: SceneIntentSchema.optional(),
  /**
   * Текст озвучки, английский. Потолок здесь — самый широкий из форматов (16:9);
   * лимит конкретного формата проверяет сценарий, который формат знает.
   */
  narration: z.string().trim().min(1).max(FORMATS.landscape.pacing.narration.hardMax),
  visual: SceneVisualSpecSchema,
  /** Короткий поисковый запрос для фото/видео фона сцены на Pexels; не у каждой сцены. */
  mediaQuery: z.string().trim().min(2).max(60).optional(),
  mediaKind: z.enum(["photo", "video"]).optional(),
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

/**
 * Правила формата для списка сцен: число сцен, длина озвучки, ёмкость кадров.
 * Общие для сценария и манифеста — оба знают формат ролика.
 */
export function addFormatIssues(
  format: VideoFormat,
  scenes: readonly { narration: string; visual: Parameters<typeof compositionFitIssues>[0] }[],
  ctx: z.RefinementCtx,
): void {
  const { pacing } = FORMATS[format];
  if (scenes.length < pacing.sceneCount.min || scenes.length > pacing.sceneCount.max) {
    ctx.addIssue({
      code: "custom",
      message: `a ${format} video has ${pacing.sceneCount.min}-${pacing.sceneCount.max} scenes, got ${scenes.length}`,
      path: ["scenes"],
    });
  }
  scenes.forEach((scene, i) => {
    if (scene.narration.length > pacing.narration.hardMax) {
      ctx.addIssue({
        code: "custom",
        message: `narration is ${scene.narration.length} characters; a ${format} scene allows ${pacing.narration.hardMax}`,
        path: ["scenes", i, "narration"],
      });
    }
    for (const message of compositionFitIssues(scene.visual, format)) {
      ctx.addIssue({ code: "custom", message, path: ["scenes", i, "visual"] });
    }
  });
}

export const ScriptSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    /** MVP: только английский, но поле явное — язык влияет на TTS и на alignment. */
    language: z.literal("en").default("en"),
    fps: FpsSchema.default(30),
    /** Дефолт shorts: сценарии, записанные до 16:9, остаются валидными. */
    format: VideoFormatSchema.default("shorts"),
    scenes: z.array(SceneSchema).min(1),
  })
  .superRefine((script, ctx) => addFormatIssues(script.format, script.scenes, ctx));
export type Script = z.infer<typeof ScriptSchema>;
