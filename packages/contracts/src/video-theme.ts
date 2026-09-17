import { z } from "zod";

/**
 * Дизайн-система ролика, которую генерирует модель под тему.
 *
 * Идея: модель не выбирает из готовых пресетов, а задаёт саму систему — палитру,
 * шрифт, ритм и кривую движения. Пространство здесь непрерывное (цвет, кегль,
 * безье, дистанции), поэтому «Восстание ИИ» и «Как делают батарейку» получают
 * разный визуальный язык, а не разные тексты в одном шаблоне.
 *
 * Почему числами, а не кодом: числа проверяются. Ниже стоят проверки контраста —
 * модель физически не может выдать нечитаемый кадр, потому что такая тема не
 * пройдёт валидацию и уйдёт на повтор. Код от модели так проверить нельзя.
 */

export const HexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb color");

/** Шрифты, которые мы реально умеем грузить (статические импорты @remotion/google-fonts). */
export const FONT_FAMILIES = [
  "Inter",
  "Manrope",
  "SpaceGrotesk",
  "Archivo",
  "Sora",
  "Oswald",
  "Anton",
  "PlayfairDisplay",
] as const;
export const FontFamilySchema = z.enum(FONT_FAMILIES);
export type FontFamilyName = z.infer<typeof FontFamilySchema>;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость по WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = channel(parseInt(value.slice(0, 2), 16));
  const g = channel(parseInt(value.slice(2, 4), 16));
  const b = channel(parseInt(value.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов: от 1 (одинаковые) до 21 (чёрный на белом). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

/** Пороги читаемости для крупного текста на видео (WCAG AA для large text — 3:1). */
export const CONTRAST_MIN = { text: 7, accent: 3.5, muted: 3 } as const;

export const MotionProfileSchema = z.object({
  /**
   * Кривая входа как cubic-bezier. Модель задаёт характер: резкий вход с мягкой
   * остановкой, упругий, линейный — это слышно в озвучке и должно совпадать.
   */
  easing: z.tuple([
    z.number().min(0).max(1),
    z.number().min(-2).max(3),
    z.number().min(0).max(1),
    z.number().min(-2).max(3),
  ]),
  /** Длительность появления элемента. */
  enterFrames: z.number().int().min(5).max(24),
  /** Шаг каскада между элементами. */
  staggerFrames: z.number().int().min(1).max(10),
  /** Дистанция, с которой элемент приезжает. */
  travelPx: z.number().int().min(8).max(160),
});
export type MotionProfile = z.infer<typeof MotionProfileSchema>;

export const VideoThemeSchema = z
  .object({
    /** Словами, зачем такая палитра. Нужна для отладки и для истории решений. */
    mood: z.string().trim().min(3).max(60),
    canvas: HexColorSchema,
    surface: HexColorSchema,
    surfaceStrong: HexColorSchema,
    border: HexColorSchema,
    text: HexColorSchema,
    muted: HexColorSchema,
    accent: HexColorSchema,
    accentSoft: HexColorSchema,
    fontFamily: FontFamilySchema,
    /** Вес заголовков: у Anton и Oswald нет 800, поэтому ограничиваем сверху. */
    headingWeight: z.union([z.literal(600), z.literal(700), z.literal(800)]),
    /** Межбуквенное расстояние заголовков в em. */
    letterSpacing: z.number().min(-0.06).max(0.04),
    /** Скругление карточек. 0 — техничный вид, 36 — мягкий. */
    cornerRadius: z.number().int().min(0).max(36),
    /** Насколько заметна фактура фона. */
    backdropOpacity: z.number().min(0.04).max(0.4),
    motion: MotionProfileSchema,
  })
  .superRefine((theme, ctx) => {
    const checks = [
      ["text", theme.text, CONTRAST_MIN.text],
      ["accent", theme.accent, CONTRAST_MIN.accent],
      ["muted", theme.muted, CONTRAST_MIN.muted],
    ] as const;

    for (const [field, color, min] of checks) {
      const ratio = contrastRatio(color, theme.canvas);
      if (ratio < min) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `contrast with canvas is ${ratio.toFixed(1)}:1, needs at least ${min}:1`,
        });
      }
    }
  });

export type VideoTheme = z.infer<typeof VideoThemeSchema>;

/**
 * Тема по умолчанию — она же запасная, если генерация не прошла валидацию.
 * Значения совпадают с дизайн-токенами из Plan.md §«Дизайн-токены тем».
 */
export const DEFAULT_VIDEO_THEME: VideoTheme = {
  mood: "calm dark editorial",
  canvas: "#171817",
  surface: "#222421",
  surfaceStrong: "#353934",
  border: "#424740",
  text: "#EEECE6",
  muted: "#A2A49B",
  accent: "#DCA268",
  accentSoft: "#44372B",
  fontFamily: "Inter",
  headingWeight: 800,
  letterSpacing: -0.03,
  cornerRadius: 28,
  backdropOpacity: 0.18,
  motion: { easing: [0.16, 1, 0.3, 1], enterFrames: 12, staggerFrames: 3, travelPx: 34 },
};
