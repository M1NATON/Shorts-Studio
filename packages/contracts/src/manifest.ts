import { z } from "zod";
import { FpsSchema } from "./script.js";
import { SceneVisualSpecSchema } from "./scene-visual-spec.js";

/**
 * Откуда взяты тайминги слов.
 * - native: пришли от TTS-провайдера (Fish `/v1/tts/stream/with-timestamp`) — точные.
 * - estimated: расчёт по длине слов, калиброванный под реальную длительность аудио.
 *   Всегда помечается в UI, никогда не выдаётся молча за точный тайминг.
 * Ветка "aligned" (forced alignment) вне MVP, но AlignmentProvider зарезервирован.
 */
export const TimingSourceSchema = z.enum(["native", "estimated"]);
export type TimingSource = z.infer<typeof TimingSourceSchema>;

/**
 * Слово озвучки. start/end — СЕКУНДЫ от начала аудио своей сцены, не глобальные.
 * Глобальный кадр считается как `scene.startFrame + Math.round(word.start * fps)`.
 * Хранить секунды, а не кадры, — чтобы не терять точность при смене fps.
 */
export const WordTimingSchema = z.object({
  text: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type WordTiming = z.infer<typeof WordTimingSchema>;

export const ManifestSceneSchema = z.object({
  sceneId: z.string().min(1),
  visual: SceneVisualSpecSchema,
  narration: z.string().min(1),
  /** Источник кадрового времени. Всё остальное (startSec) — производное. */
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().min(1),
  /** Реальная длительность аудиофайла по ffprobe, не оценка TTS-ответа. */
  audioDurationSec: z.number().min(0),
  /** Путь относительно storage, не абсолютный: манифест переносим между машинами. */
  audioSrc: z.string().min(1),
  words: z.array(WordTimingSchema),
  timingSource: TimingSourceSchema,
});
export type ManifestScene = z.infer<typeof ManifestSceneSchema>;

export const ManifestSchema = z.object({
  /** Версия формата: старые снапшоты не должны молча ломаться о новый код. */
  version: z.literal(1),
  projectId: z.string().min(1),
  /** Хеш Script + tts-параметров: одинаковый hash → результат берётся из кеша. */
  sourceHash: z.string().min(1),
  title: z.string().min(1),
  fps: FpsSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  totalDurationInFrames: z.number().int().min(1),
  scenes: z.array(ManifestSceneSchema).min(1),
  /**
   * Источники, на которых построен сценарий. Хранятся, чтобы цифру из кадра можно
   * было проверить по ссылке спустя время. Поле с дефолтом — старые манифесты
   * остаются валидными без смены версии формата.
   */
  sources: z
    .array(z.object({ url: z.string().url(), title: z.string().min(1) }))
    .default([]),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** Разрешение Shorts 9:16. */
export const SHORTS_SIZE = { width: 1080, height: 1920 } as const;

/**
 * Чистые хелперы над WordTiming живут здесь, а не в media-core, сознательно:
 * media-core содержит ffprobe и сетевые адаптеры (node:child_process, fetch),
 * поэтому Remotion-компоненты не могут его импортировать — webpack не бандлит
 * "node:" схемы. Правило: Remotion зависит только от @shorts/contracts.
 */
/**
 * Индекс слова, которое подсвечивается в субтитрах в момент `timeSec`.
 *
 * Наивное условие `start <= t < end` не годится на реальных данных Fish:
 * - провайдер отдаёт слова с нулевой длительностью (start == end) — такое слово
 *   не подсветилось бы никогда;
 * - между словами есть паузы (на сцене из 16 слов — 1.2 с суммарно), и в паузах
 *   подсветка гасла бы, из-за чего субтитры мигают.
 *
 * Поэтому активным считается последнее НАЧАВШЕЕСЯ слово: подсветка держится
 * до начала следующего слова. Бинарный поиск — функция вызывается на каждом кадре.
 */
export function findActiveWordIndex(words: readonly WordTiming[], timeSec: number): number {
  if (words.length === 0 || timeSec < words[0]!.start) return -1;

  let low = 0;
  let high = words.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (words[mid]!.start <= timeSec) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}
