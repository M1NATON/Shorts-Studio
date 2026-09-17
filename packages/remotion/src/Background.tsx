import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "./theme.js";

/**
 * Непрерывный фон всего видео.
 *
 * Живёт ВНЕ Sequence сцен и завязан на абсолютный кадр: движение не перезапускается
 * на склейках, поэтому резкие смены сцен читаются как один клип, а не как набор слайдов.
 * Ни один кадр не является статичным — это дешёвый способ убрать ощущение «презентации».
 */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  // Медленный дрейф двух световых пятен: периоды взаимно несоизмеримы, чтобы
  // картинка не зацикливалась заметно на длине шортса.
  const x1 = 50 + 18 * Math.sin(t / 7.3);
  const y1 = 32 + 10 * Math.cos(t / 9.1);
  const x2 = 50 + 22 * Math.cos(t / 11.7);
  const y2 = 74 + 12 * Math.sin(t / 8.3);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.canvas }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(${width * 0.9}px ${height * 0.5}px at ${x1}% ${y1}%, ${theme.accentSoft} 0%, transparent 62%),
            radial-gradient(${width * 0.8}px ${height * 0.45}px at ${x2}% ${y2}%, ${theme.surface3} 0%, transparent 60%)`,
          opacity: 0.85,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 75% at 50% 45%, transparent 40%, rgba(0,0,0,0.55) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
