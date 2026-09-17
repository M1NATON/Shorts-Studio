import * as Anton from "@remotion/google-fonts/Anton";
import * as Archivo from "@remotion/google-fonts/Archivo";
import * as Inter from "@remotion/google-fonts/Inter";
import * as Manrope from "@remotion/google-fonts/Manrope";
import * as Oswald from "@remotion/google-fonts/Oswald";
import * as PlayfairDisplay from "@remotion/google-fonts/PlayfairDisplay";
import * as Sora from "@remotion/google-fonts/Sora";
import * as SpaceGrotesk from "@remotion/google-fonts/SpaceGrotesk";
import type { FontFamilyName } from "@shorts/contracts";

/**
 * Реестр шрифтов, которые модель может выбрать.
 *
 * Список закрытый и статически импортированный: динамический импорт по имени из
 * ответа модели означал бы, что шрифт может не успеть загрузиться к первому кадру
 * и preview разойдётся с рендером.
 *
 * Веса перечислены реальные: у Anton есть только 400, и запрос 800 уронил бы
 * загрузку. Вес заголовков из темы зажимается по максимуму семейства — модель не
 * обязана знать особенности каждого шрифта.
 *
 * Каждая загрузка обёрнута в замыкание: у модулей шрифтов разные типы Variants,
 * общей сигнатуры для них не существует.
 */
interface FontEntry {
  readonly load: () => { fontFamily: string };
  readonly weights: readonly number[];
}

const REGISTRY: Record<FontFamilyName, FontEntry> = {
  Inter: {
    load: () => Inter.loadFont("normal", { weights: ["400", "700", "800"], subsets: ["latin"] }),
    weights: [400, 700, 800],
  },
  Manrope: {
    load: () => Manrope.loadFont("normal", { weights: ["400", "700", "800"], subsets: ["latin"] }),
    weights: [400, 700, 800],
  },
  SpaceGrotesk: {
    load: () => SpaceGrotesk.loadFont("normal", { weights: ["400", "700"], subsets: ["latin"] }),
    weights: [400, 700],
  },
  Archivo: {
    load: () => Archivo.loadFont("normal", { weights: ["400", "700", "800"], subsets: ["latin"] }),
    weights: [400, 700, 800],
  },
  Sora: {
    load: () => Sora.loadFont("normal", { weights: ["400", "700", "800"], subsets: ["latin"] }),
    weights: [400, 700, 800],
  },
  Oswald: {
    load: () => Oswald.loadFont("normal", { weights: ["400", "700"], subsets: ["latin"] }),
    weights: [400, 700],
  },
  Anton: {
    load: () => Anton.loadFont("normal", { weights: ["400"], subsets: ["latin"] }),
    weights: [400],
  },
  PlayfairDisplay: {
    load: () =>
      PlayfairDisplay.loadFont("normal", { weights: ["400", "700", "800"], subsets: ["latin"] }),
    weights: [400, 700, 800],
  },
};

export interface LoadedFont {
  readonly fontFamily: string;
  /** Вес заголовков, зажатый по тому, что реально есть в семействе. */
  readonly headingWeight: number;
  readonly bodyWeight: number;
}

export function loadThemeFont(name: FontFamilyName, requestedHeadingWeight: number): LoadedFont {
  const entry = REGISTRY[name];
  const maxWeight = Math.max(...entry.weights);
  return {
    fontFamily: entry.load().fontFamily,
    headingWeight: Math.min(requestedHeadingWeight, maxWeight),
    bodyWeight: entry.weights.includes(400) ? 400 : maxWeight,
  };
}
