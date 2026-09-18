import {
  NARRATION_MAX_CHARS,
  NARRATION_TARGET_CHARS,
  SCENE_COUNT_RANGE,
  SceneIntentSchema,
  SPEECH_CHARS_PER_SEC,
  type VideoStyle,
} from "@shorts/contracts";
import { z } from "zod";
import { dateRule, log, withFeedback, type GenerationContext } from "./context.js";
import type { Beat } from "./plan.js";
import { narrationTells, skill } from "./skills.js";

export const DEFAULT_SCENE_COUNT = 8;

/** Правило mediaQuery для промпта: каждой сцене у "documentary", иначе только хуку и 1-2 ключевым. */
export function mediaQueryRule(style: VideoStyle): string {
  return [
    'mediaQuery: OPTIONAL, 2-4 English words describing a CONCRETE filmable subject for a stock',
    'photo/video search (e.g. "lithium mine aerial", "server room lights"), not an abstract idea.',
    'mediaKind: "video" when motion matters, otherwise "photo".',
    style === "documentary"
      ? "Give mediaQuery (and mediaKind) to every beat."
      : "Give mediaQuery (and mediaKind) only to the hook beat and 1-2 other key beats; leave it out for the rest.",
  ].join("\n");
}

export function outlineSystem(today: string, sceneCount: number, style: VideoStyle = "tech"): string {
  return [
    "You plan informative vertical short videos (9:16), in English.",
    "",
    'Return JSON: { "title": string (max 110 chars),',
    '  "beats": [ { "narration": string, "intent": string, "mediaQuery"?: string, "mediaKind"?: "photo" | "video" } ] }',
    `Exactly ${sceneCount} beats.`,
    "",
    `narration: ONE spoken sentence, ${NARRATION_TARGET_CHARS.min}-${NARRATION_TARGET_CHARS.max} characters,`,
    `hard maximum ${NARRATION_MAX_CHARS}. Speech runs at ~${SPEECH_CHARS_PER_SEC} characters per second,`,
    "so a long sentence freezes the scene. One idea per beat, no filler.",
    "",
    `intent: one of ${SceneIntentSchema.options.join(", ")}.`,
    'The first beat is "hook", the last is "takeaway".',
    'Use "number" only for a real, widely documented figure worth animating; never invent one.',
    'Use "contrast" for A-versus-B, "list" for two to four parallel points,',
    '"sequence" for ordered steps or a chronology, "punch" for a short emotional line',
    'that works split across two or three lines, "fact" otherwise.',
    "Aim for a mix: at least one number or contrast, and at least two lists.",
    "",
    mediaQueryRule(style),
    "",
    dateRule(today),
    "",
    skill("narration"),
  ].join("\n");
}

export interface Outline {
  readonly title: string;
  readonly beats: Beat[];
}

const OutlineSchema = z.object({
  title: z.string().trim().min(1).transform((t) => t.slice(0, 120)),
  beats: z
    .array(
      z.object({
        narration: z.string().trim().min(1).max(NARRATION_MAX_CHARS),
        // Неизвестный замысел — не повод перегенерировать весь план.
        intent: SceneIntentSchema.catch("fact"),
        mediaQuery: z.string().trim().min(2).max(60).optional(),
        mediaKind: z.enum(["photo", "video"]).optional(),
      }),
    )
    .min(SCENE_COUNT_RANGE.min),
});

export function sourcesBlock(brief: string): string {
  return brief
    ? ["", "SOURCES (use only facts and numbers that appear here; do not invent figures):", brief].join("\n")
    : "";
}

/**
 * План ролика: заголовок и тезисы озвучки. Длина тезиса проверяется здесь, а не
 * при сборке сценария: слишком длинная фраза уходит на повтор с замечанием.
 */
export async function outline(
  ctx: GenerationContext,
  topic: string,
  brief: string,
  sceneCount = DEFAULT_SCENE_COUNT,
  style: VideoStyle = "tech",
): Promise<Outline> {
  const feedback: string[] = [];
  let lastError = "no attempts";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await ctx.llm.askJson({
        system: outlineSystem(ctx.today, sceneCount, style),
        user: withFeedback(`Topic: ${topic}${sourcesBlock(brief)}`, feedback),
        maxTokens: 1600,
        timeoutMs: 180000,
      });
      const parsed = OutlineSchema.safeParse(raw);
      if (parsed.success) {
        const beats = parsed.data.beats.slice(0, Math.min(sceneCount, SCENE_COUNT_RANGE.max));
        // Штампы — мягкое требование: один повтор с замечаниями, дальше принимаем как есть.
        const tells = attempt === 1 ? beatTells(parsed.data.title, beats) : [];
        if (tells.length === 0) return { title: parsed.data.title, beats };
        feedback.splice(0, feedback.length, ...tells);
        lastError = `штампы: ${tells.join("; ")}`;
        log(ctx, `план attempt ${attempt}: ${lastError}`);
        continue;
      }
      feedback.splice(
        0,
        feedback.length,
        ...parsed.error.issues.slice(0, 4).map((i) => `${i.path.map(String).join(".")}: ${i.message}`),
      );
      lastError = feedback.join("; ");
    } catch (error) {
      lastError = (error as Error).message;
    }
    log(ctx, `план attempt ${attempt}: ${lastError}`);
  }
  throw new Error(`outline failed: ${lastError}`);
}

/** Штампы в заголовке и тезисах — замечания для повтора (не больше пяти). */
export function beatTells(title: string, beats: readonly { narration: string }[]): string[] {
  return [
    ...narrationTells(title).map((t) => `title: ${t}`),
    ...beats.flatMap((b, i) => narrationTells(b.narration).map((t) => `beat ${i + 1}: ${t}`)),
  ].slice(0, 5);
}
