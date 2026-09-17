import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/** Кривая входа: быстрый старт, мягкая остановка. Одна на все сцены — так видео читается цельно. */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const ENTER_FRAMES = 12;
const EXIT_FRAMES = 8;

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

  const enter = interpolate(frame, [0, ENTER_FRAMES], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [durationInFrames - EXIT_FRAMES, durationInFrames], [1, 0], {
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
export function stagger(frame: number, index: number, stepFrames = 3): number {
  return interpolate(frame, [index * stepFrames, index * stepFrames + ENTER_FRAMES], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
