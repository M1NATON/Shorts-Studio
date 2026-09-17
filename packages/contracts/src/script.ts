import { z } from "zod";
import { SceneVisualSpecSchema } from "./scene-visual-spec.js";

export const FpsSchema = z.union([z.literal(24), z.literal(25), z.literal(30)]);
export type Fps = z.infer<typeof FpsSchema>;

/**
 * Лимит длины озвучки сцены. При темпе ~2.5 слова/сек и средней длине слова ~5 символов
 * 260 символов ≈ 10 секунд речи — потолок, за которым сцена перестаёт держать внимание
 * в Shorts (Plan.md §5). Валидация жёсткая: LLM получит retry, а не обрезанный смысл.
 */
export const NARRATION_MAX_CHARS = 260;

export const SceneSchema = z.object({
  id: z.string().min(1),
  /** Текст озвучки, английский. Один факт на сцену. */
  narration: z.string().trim().min(1).max(NARRATION_MAX_CHARS),
  visual: SceneVisualSpecSchema,
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** MVP: только английский, но поле явное — язык влияет на TTS и на alignment. */
  language: z.literal("en").default("en"),
  fps: FpsSchema.default(30),
  scenes: z.array(SceneSchema).min(1).max(12),
});
export type Script = z.infer<typeof ScriptSchema>;
