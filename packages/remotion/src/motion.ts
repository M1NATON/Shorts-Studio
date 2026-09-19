import { createContext, useContext } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useTheme } from "./theme.js";

/** Запасная кривая, когда компонент рендерится вне темы (Studio, изолированный тест). */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const EXIT_FRAMES = 8;

/**
 * Позиция сцены в ролике: первая/последняя. Раздаётся из ShortsVideo per-сцене
 * (см. HasSceneMediaContext) — при зацикленном показе конец должен без чёрного
 * кадра переходить в начало, поэтому последняя сцена не гаснет (exit), а первая
 * не проявляется из пустоты (см. HookStatement).
 */
export const ScenePositionContext = createContext<{ isFirst: boolean; isLast: boolean }>({
  isFirst: false,
  isLast: false,
});
export const useScenePosition = (): { isFirst: boolean; isLast: boolean } => useContext(ScenePositionContext);

/**
 * Профиль движения ролика: кривая, длительность входа, шаг каскада и дистанция.
 * Всё это задаёт модель под тему видео, поэтому спокойный разбор и срочная новость
 * двигаются по-разному, хотя компоненты одни и те же.
 */
export function useMotionProfile() {
  const { motion } = useTheme();
  const [x1, y1, x2, y2] = motion.easing;
  return {
    easing: Easing.bezier(x1, y1, x2, y2),
    enterFrames: motion.enterFrames,
    staggerFrames: motion.staggerFrames,
    travelPx: motion.travelPx,
  };
}

export interface SceneMotion {
  /** 0→1 на входе в сцену. */
  readonly enter: number;
  /** 1→0 в конце сцены. */
  readonly exit: number;
  /** enter * exit — готовый множитель для opacity. */
  readonly visible: number;
  readonly frame: number;
  readonly fps: number;
  readonly durationInFrames: number;
}

/**
 * Вход и выход сцены.
 *
 * Почему не TransitionSeries из скилла multi-scene-video: переходы там съедают кадры
 * на перекрытие сцен, а наши startFrame посчитаны из реальных длительностей аудио —
 * перекрытие сдвинуло бы звук и наложило две озвучки друг на друга. Поэтому склейки
 * жёсткие, а движение живёт внутри кадров своей сцены; непрерывность даёт общий фон.
 *
 * Длительность входа фиксирована в кадрах, а не в долях сцены: иначе на 3-секундной
 * сцене появление тянулось бы полсекунды, а на 8-секундной — полторы.
 */
export function useSceneMotion(): SceneMotion {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const profile = useMotionProfile();
  const { isLast } = useScenePosition();

  const enter = interpolate(frame, [0, profile.enterFrames], [0, 1], {
    easing: profile.easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Последняя сцена ролика не гаснет: при зацикленном показе её конец должен
  // без чёрного кадра переходить в начало следующего показа.
  const exit = isLast
    ? 1
    : interpolate(frame, [durationInFrames - EXIT_FRAMES, durationInFrames], [1, 0], {
        easing: Easing.linear,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return { enter, exit, visible: enter * exit, frame, fps, durationInFrames };
}

/**
 * Каскадное появление элемента №index.
 * Шаг небольшой (3 кадра): на коротких сценах длинный каскад не успевает закончиться
 * до того, как диктор уже произнёс весь текст.
 */
export function useStagger(): (frame: number, index: number, stepFrames?: number) => number {
  const profile = useMotionProfile();
  return (frame, index, stepFrames = 3) => {
    // Шаг каскада из темы масштабирует то, что компонент просит семантически:
    // «слова подряд» (2) и «карточки» (7) сохраняют пропорцию друг к другу.
    const step = Math.max(1, Math.round((stepFrames * profile.staggerFrames) / 3));
    return interpolate(frame, [index * step, index * step + profile.enterFrames], [0, 1], {
      easing: profile.easing,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  };
}

/** Оставлено для компонентов вне темы: фиксированный каскад. */
export function stagger(frame: number, index: number, stepFrames = 3): number {
  return interpolate(frame, [index * stepFrames, index * stepFrames + 12], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
