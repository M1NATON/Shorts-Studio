import type React from "react";
import {
  compositionCapacity,
  estimateLines,
  FORMATS,
  stageSize,
  themeStyle,
  type VideoFormat,
  type VideoStyle,
} from "@shorts/contracts";
import { useTheme } from "./theme.js";

/**
 * Устройство кадра по стилю темы: насколько можно увеличить сцену, как рисуется
 * «карточка» и какой фон живёт под контентом. Палитра и стиль независимы — эти
 * поля определяют форму кадра, а не цвет.
 */
export interface StyleSpec {
  /** Максимальный zoom сцены из блоков (см. fitZoom в @shorts/contracts). */
  readonly maxZoom: number;
  /** Как рисуется карточка блока. */
  readonly surface: "fill" | "rule" | "none" | "sticker";
  /** Фактура фона всего ролика. */
  readonly background: "glow" | "paper" | "flat" | "grid";
}

export const STYLES: Record<VideoStyle, StyleSpec> = {
  tech: { maxZoom: 1.15, surface: "fill", background: "glow" },
  documentary: { maxZoom: 1.3, surface: "fill", background: "glow" },
  editorial: { maxZoom: 1.35, surface: "rule", background: "paper" },
  notebook: { maxZoom: 1.5, surface: "sticker", background: "grid" },
  kinetic: { maxZoom: 1.6, surface: "none", background: "flat" },
  poster: { maxZoom: 1.6, surface: "none", background: "flat" },
};

export const useStyle = (): StyleSpec => STYLES[themeStyle(useTheme())];

/**
 * Zoom текстового шаблона (hook, kinetic, outro): как fitZoom, но по реальному кеглю
 * шаблона и его ширине (templateMaxWidth / zoom). `extra` — высота прочих элементов
 * (подпись, кавычка, отступы) в дизайн-пикселях.
 */
export function textZoom(
  lines: readonly string[],
  fontSize: number,
  format: VideoFormat,
  maxZoom: number,
  extra = 0,
): number {
  for (let zoom = Math.max(1, maxZoom); zoom > 1; zoom -= 0.05) {
    const width = Math.min(stageSize(format, zoom).width, FORMATS[format].templateMaxWidth / zoom);
    const height = lines.reduce((sum, line) => sum + estimateLines(line, fontSize, width) * fontSize * 1.15, 0) + extra;
    if (height <= compositionCapacity("center", format, zoom)) return zoom;
  }
  return 1;
}

/** hex "#rrggbb" → "#rrggbbaa": нужен только для полупрозрачной линии surface "rule". */
const withAlpha = (hex: string, alpha: number): string =>
  `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

/**
 * Стиль карточки блока по STYLES[style].surface: заливка с рамкой (tech/documentary),
 * верхняя линия (editorial), стикер с тенью (notebook) или ничего (poster/kinetic).
 */
export function useSurface(): (emphasis: boolean, accent: string) => React.CSSProperties {
  const theme = useTheme();
  const style = useStyle();
  return (emphasis, accent) => {
    switch (style.surface) {
      case "fill":
        return {
          borderRadius: theme.cornerRadius,
          backgroundColor: emphasis ? theme.surfaceStrong : theme.surface,
          border: `2px solid ${emphasis ? accent : theme.border}`,
        };
      case "rule":
        return {
          borderRadius: 0,
          backgroundColor: "transparent",
          borderTop: `3px solid ${withAlpha(emphasis ? accent : theme.text, 0.85)}`,
        };
      case "sticker":
        return {
          borderRadius: 6,
          backgroundColor: emphasis ? theme.accentSoft : theme.surface,
          border: `3px solid ${theme.text}`,
          boxShadow: `8px 8px 0 ${theme.text}`,
        };
      case "none":
      default:
        return { borderRadius: 0, backgroundColor: "transparent" };
    }
  };
}
