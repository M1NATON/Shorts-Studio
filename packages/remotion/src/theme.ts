import { createContext, useContext } from "react";
import { DEFAULT_VIDEO_THEME, type VideoTheme } from "@shorts/contracts";

/**
 * Тема ролика приходит из манифеста: её генерирует модель под конкретную тему
 * видео, а не выбирает из пресетов. Компоненты читают её через контекст, поэтому
 * ни один цвет не зашит в сцену.
 *
 * Значение по умолчанию нужно для Studio и для сцен, отрисованных вне ShortsVideo.
 */
export const ThemeContext = createContext<VideoTheme>(DEFAULT_VIDEO_THEME);
export const useTheme = (): VideoTheme => useContext(ThemeContext);

/** Шрифтовые данные считаются один раз в ShortsVideo и раздаются сюда. */
export const FontContext = createContext<{ fontFamily: string; headingWeight: number; bodyWeight: number }>({
  fontFamily: "Inter, system-ui, sans-serif",
  headingWeight: 800,
  bodyWeight: 400,
});
export const useThemeFont = () => useContext(FontContext);

/** Safe zone для вертикального видео: элементы UI платформ не перекрывают контент. */
export const SAFE = { top: 220, bottom: 380, side: 80 } as const;

/**
 * Зона визуала сцены. Нижняя граница = SAFE.bottom + высота бокса субтитров:
 * иначе контент сцены оказывается под субтитрами и они читаются поверх друг друга.
 */
export const CONTENT = { top: SAFE.top, bottom: 640, side: SAFE.side } as const;

/** Инсет для корневого контейнера сцены — чтобы не повторять в каждом компоненте. */
export const CONTENT_INSET = `${CONTENT.top}px ${CONTENT.side}px ${CONTENT.bottom}px`;
