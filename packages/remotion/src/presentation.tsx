import React, { createContext, useContext } from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { LAYOUT_ZONE_PADDING, stageSize, themeStyle, type Presentation, type SceneMotionKind } from "@shorts/contracts";
import { Backdrop } from "./Backdrop.js";
import { useFormat, useTheme } from "./theme.js";
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

const HasSceneMediaContext = createContext<boolean>(false);

/** Есть ли у текущей сцены фон-медиа (см. SceneMedia.tsx): подавляет Backdrop и poster-плашку. */
export const useHasSceneMedia = (): boolean => useContext(HasSceneMediaContext);
export { HasSceneMediaContext };

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
 * Композиция задаётся сдвигом оптического центра, а не «прижать к краю»: см.
 * LAYOUT_ZONE_PADDING в контрактах. Числа общие с валидатором композиции.
 */
const zonePadding = (layout: Presentation["layout"]): React.CSSProperties => {
  const pad = LAYOUT_ZONE_PADDING[layout];
  return { paddingTop: pad.top, paddingBottom: pad.bottom };
};

/**
 * Корневой контейнер сцены: зона контента, композиция из spec.layout и акцент сцены.
 *
 * Компоненты сцен не знают про инсеты и про сдвиг акцента — так композицию можно
 * менять централизованно, а модель влияет на неё только через закрытый enum.
 *
 * Внутри зоны лежит «сцена» в дизайн-пикселях (см. stageSize): блоки свёрстаны
 * под кегли кадра 1080×1920, а в 16:9 та же вёрстка уменьшается целиком. Поэтому
 * таблица кеглей одна, и оценка высоты в валидаторе совпадает с рендером.
 *
 * `wide`: сцена из блоков занимает всю ширину сцены; шаблонные типы ограничены
 * templateMaxWidth — абзац на 2300 дизайн-пикселей в 16:9 не читается.
 *
 * `zoom`: во сколько раз сцена увеличена на кадре (см. fitZoom в контрактах).
 * При zoom > 1 сцена в дизайн-пикселях меньше (stageSize), а видимый размер на
 * кадре тот же — блоки занимают больше места в кадре, а не расползаются в пустоте.
 */
export const SceneFrame: React.FC<{
  presentation: Presentation;
  children: React.ReactNode;
  gap?: number;
  wide?: boolean;
  zoom?: number;
  /**
   * Пропустить фейд появления — контейнер сразу непрозрачен. Нужно первой сцене
   * ролика: на кадре 0 текст должен уже читаться, а не проступать из пустоты
   * (см. HookStatement). Уход в конце сцены не трогает — он работает как обычно.
   */
  instant?: boolean;
}> = ({ presentation, children, gap = 28, wide = false, zoom = 1, instant = false }) => {
  const theme = useTheme();
  const format = useFormat();
  const { enter, exit } = useSceneMotion();
  const visible = instant ? exit : enter * exit;
  const hasMedia = useHasSceneMedia();
  const accent = shiftHue(theme.accent, presentation.accentShift);
  const isLeft = presentation.layout === "left";
  const stage = stageSize(format.name, zoom);
  const scale = format.scale * zoom;
  const maxWidth = wide ? stage.width : Math.min(stage.width, format.templateMaxWidth / zoom);

  return (
    <AccentContext.Provider value={accent}>
      {themeStyle(theme) === "poster" && !hasMedia ? (
        <AbsoluteFill style={{ backgroundColor: shiftHue(theme.canvas, presentation.accentShift * 3) }} />
      ) : null}
      {hasMedia ? null : <Backdrop backdrop={presentation.backdrop} accent={accent} />}
      <div
        style={{
          position: "absolute",
          top: format.zone.top,
          left: format.zone.side,
          width: stage.width,
          height: stage.height,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: isLeft ? "flex-start" : "stretch",
            textAlign: isLeft ? "left" : "center",
            ...zonePadding(presentation.layout),
            // Линия 6px входит в LAYOUT_ZONE_PADDING.left вместе с отступом текста.
            paddingLeft: isLeft ? LAYOUT_ZONE_PADDING.left.left - 6 : 0,
            borderLeft: isLeft ? `6px solid ${accent}` : undefined,
            gap,
            opacity: visible,
          }}
        >
          {children}
        </div>
      </div>
    </AccentContext.Provider>
  );
};

export { EASE_OUT };
