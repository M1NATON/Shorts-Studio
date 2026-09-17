import React, { createContext, useContext } from "react";
import { interpolate } from "remotion";
import type { Presentation, SceneMotionKind } from "@shorts/contracts";
import { Backdrop } from "./Backdrop.js";
import { CONTENT_INSET, useTheme } from "./theme.js";
import { EASE_OUT, useMotionProfile, useSceneMotion } from "./motion.js";

/** hex → HSL и обратно: нужен только сдвиг тона, поэтому без внешней цветовой библиотеки. */
function shiftHue(hex: string, degrees: number): string {
  if (degrees === 0) return hex;
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }
  hue = (hue + degrees + 360) % 360;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [rp, gp, bp] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const toHex = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

const AccentContext = createContext<string>("#DCA268");

/** Акцент текущей сцены: базовый цвет темы со сдвигом из спеки. */
export const useAccent = (): string => useContext(AccentContext);

/**
 * Смещение и масштаб элемента по характеру движения.
 *
 * Один и тот же шаблон с motion "slide" и "pop" читается как две разные сцены,
 * поэтому разнообразие не требует новых компонентов.
 */
export function useMotionStyle(): (
  motion: SceneMotionKind,
  progress: number,
  direction?: 1 | -1,
) => React.CSSProperties {
  const { travelPx } = useMotionProfile();
  return (motion, progress, direction = 1) => motionStyle(motion, progress, direction, travelPx);
}

export function motionStyle(
  motion: SceneMotionKind,
  progress: number,
  direction: 1 | -1 = 1,
  travelPx = 34,
): React.CSSProperties {
  const remaining = 1 - progress;
  switch (motion) {
    case "slide":
      // Боковой выезд заметнее вертикального, поэтому дистанция больше.
      return { opacity: progress, translate: `${remaining * travelPx * 2.6 * direction}px 0px` };
    case "pop":
      return {
        opacity: progress,
        scale: interpolate(progress, [0, 1], [0.86, 1], { output: "perceptual-scale" }),
      };
    case "fade":
      return { opacity: progress };
    case "rise":
    default:
      return { opacity: progress, translate: `0px ${remaining * travelPx}px` };
  }
}

/**
 * Композиция задаётся не «прижать к краю», а сдвигом оптического центра.
 *
 * Прямой justifyContent: flex-start оставлял под контентом 600px пустоты — кадр
 * читался как недоделанный. Вместо этого контент центрируется в подобласти зоны:
 * для "top" это верхние две трети, для "stacked" — нижние. Сцены различимы, но
 * ни одна не выглядит пустой.
 */
const ZONE_PADDING: Record<Presentation["layout"], React.CSSProperties> = {
  center: {},
  top: { paddingBottom: 240 },
  stacked: { paddingTop: 300 },
  left: {},
};

/**
 * Корневой контейнер сцены: зона контента, композиция из spec.layout и акцент сцены.
 *
 * Компоненты сцен не знают про инсеты и про сдвиг акцента — так композицию можно
 * менять централизованно, а модель влияет на неё только через закрытый enum.
 */
export const SceneFrame: React.FC<{
  presentation: Presentation;
  children: React.ReactNode;
  gap?: number;
}> = ({ presentation, children, gap = 28 }) => {
  const theme = useTheme();
  const { visible } = useSceneMotion();
  const accent = shiftHue(theme.accent, presentation.accentShift);
  const isLeft = presentation.layout === "left";

  return (
    <AccentContext.Provider value={accent}>
      <Backdrop backdrop={presentation.backdrop} accent={accent} />
      <div
        style={{
          position: "absolute",
          inset: CONTENT_INSET,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: isLeft ? "flex-start" : "stretch",
          textAlign: isLeft ? "left" : "center",
          ...ZONE_PADDING[presentation.layout],
          paddingLeft: isLeft ? 26 : 0,
          borderLeft: isLeft ? `6px solid ${accent}` : undefined,
          gap,
          opacity: visible,
        }}
      >
        {children}
      </div>
    </AccentContext.Provider>
  );
};

export { EASE_OUT };
