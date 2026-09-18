import { z } from "zod";

/**
 * Формат ролика — свойство проекта, выбирается при создании и дальше не меняется:
 * от него зависят зона контента, кегли, субтитры, темп и структура сценария.
 * Переложить готовый вертикальный ролик в 16:9 нельзя — это другой ролик.
 */
export const VideoFormatSchema = z.enum(["shorts", "landscape"]);
export type VideoFormat = z.infer<typeof VideoFormatSchema>;

export interface FormatSpec {
  readonly width: number;
  readonly height: number;
  /** Зона визуала сцены в пикселях кадра: поля платформы и полоса субтитров. */
  readonly zone: { readonly top: number; readonly bottom: number; readonly side: number };
  /**
   * Масштаб кеглей. Блоки свёрстаны в «дизайн-пикселях» кадра 1080×1920; в 16:9
   * та же вёрстка рисуется на сцене большего размера и уменьшается целиком.
   * Одна таблица кеглей на оба формата — поэтому оценка высоты в валидаторе
   * совпадает с рендером в обоих.
   */
  readonly scale: number;
  /** Самая широкая строка шаблонной сцены в дизайн-пикселях: абзац на 2300px не читается. */
  readonly templateMaxWidth: number;
  readonly captions: {
    readonly maxWordsPerPage: number;
    readonly maxCharsPerPage: number;
    readonly fontSize: number;
    readonly boxHeight: number;
    /** Низ бокса субтитров от нижнего края кадра. */
    readonly bottom: number;
    readonly side: number;
  };
  readonly pacing: {
    readonly sceneCount: { readonly min: number; readonly max: number };
    /** Ориентир длины озвучки сцены для промпта и жёсткий потолок для валидатора. */
    readonly narration: { readonly min: number; readonly max: number; readonly hardMax: number };
  };
}

export const FORMATS: Record<VideoFormat, FormatSpec> = {
  shorts: {
    width: 1080,
    height: 1920,
    zone: { top: 220, bottom: 640, side: 80 },
    scale: 1,
    templateMaxWidth: 920,
    captions: { maxWordsPerPage: 3, maxCharsPerPage: 24, fontSize: 68, boxHeight: 230, bottom: 380, side: 80 },
    // Замер Fish: 13.2 символа в секунду; 110 символов ≈ 8 с — потолок сцены Shorts.
    pacing: { sceneCount: { min: 5, max: 9 }, narration: { min: 40, max: 70, hardMax: 110 } },
  },
  landscape: {
    width: 1920,
    height: 1080,
    // Title-safe ~5% по бокам, снизу полоса субтитров в одну строку.
    zone: { top: 72, bottom: 216, side: 96 },
    // Экран больше, но кадр ниже: кегли ≈0.75 от вертикального.
    scale: 0.75,
    templateMaxWidth: 1500,
    captions: { maxWordsPerPage: 7, maxCharsPerPage: 46, fontSize: 50, boxHeight: 80, bottom: 64, side: 160 },
    // 1–3 фразы на сцену, 6–15 с; ролик 3–15 минут — это десятки сцен.
    pacing: { sceneCount: { min: 3, max: 150 }, narration: { min: 110, max: 200, hardMax: 320 } },
  },
};

/** Размер сцены в дизайн-пикселях — пространство, в котором верстаются блоки. */
export function stageSize(format: VideoFormat): { width: number; height: number } {
  const spec = FORMATS[format];
  return {
    width: Math.round((spec.width - spec.zone.side * 2) / spec.scale),
    height: Math.round((spec.height - spec.zone.top - spec.zone.bottom) / spec.scale),
  };
}
