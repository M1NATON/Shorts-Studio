import type { Fps } from "@shorts/contracts";

export interface TimelineInput {
  sceneId: string;
  /** Реальная длительность аудио сцены (ffprobe), секунды. */
  audioDurationSec: number;
}

export interface TimelineSlot {
  sceneId: string;
  startFrame: number;
  durationInFrames: number;
}

export interface TimelineResult {
  slots: TimelineSlot[];
  totalDurationInFrames: number;
}

export interface TimelineOptions {
  /**
   * Пауза после озвучки каждой сцены, кроме последней, в кадрах. Голос молчит, кадр
   * сцены держится: без неё фраза следующей сцены начинается встык и режет слух.
   * Пауза входит в durationInFrames сцены, а не пустая дыра между сценами. По умолчанию 0.
   */
  gapFrames?: number;
}

/**
 * Пересчёт кадрового таймлайна. Чистая функция — вызывается после любого изменения
 * длительности аудио любой сцены (перегенерация озвучки, правка текста, reorder).
 *
 * Два инварианта, на которых держится синхронизация:
 * 1. ceil, а не round: недобор кадра обрезал бы хвост слова в озвучке.
 * 2. startFrame следующей сцены = сумма ПРЕДЫДУЩИХ durationInFrames, а не
 *    round(накопленных секунд * fps) — иначе ошибки округления копятся по ролику
 *    и к концу дают заметный рассинхрон субтитров.
 */
export function recomputeTimeline(
  scenes: readonly TimelineInput[],
  fps: Fps,
  options: TimelineOptions = {},
): TimelineResult {
  const gapFrames = options.gapFrames ?? 0;
  if (gapFrames < 0 || !Number.isInteger(gapFrames)) {
    throw new Error(`gapFrames must be a non-negative integer, got ${gapFrames}`);
  }

  let cursor = 0;
  const slots: TimelineSlot[] = [];

  for (const [index, scene] of scenes.entries()) {
    if (!Number.isFinite(scene.audioDurationSec) || scene.audioDurationSec < 0) {
      throw new Error(`Scene ${scene.sceneId}: invalid audioDurationSec ${scene.audioDurationSec}`);
    }
    // Сцена всегда занимает минимум 1 кадр: нулевая длительность сломала бы Remotion Sequence.
    const pause = index < scenes.length - 1 ? gapFrames : 0;
    const durationInFrames = Math.max(1, Math.ceil(scene.audioDurationSec * fps)) + pause;
    slots.push({ sceneId: scene.sceneId, startFrame: cursor, durationInFrames });
    cursor += durationInFrames;
  }

  return { slots, totalDurationInFrames: Math.max(1, cursor) };
}

/**
 * Глобальный кадр слова. Единственное разрешённое место перевода секунд слова в кадры —
 * чтобы формула не расползлась по компонентам субтитров и рендеру.
 */
export function wordFrame(startFrameOfScene: number, wordStartSec: number, fps: Fps): number {
  return startFrameOfScene + Math.round(wordStartSec * fps);
}
