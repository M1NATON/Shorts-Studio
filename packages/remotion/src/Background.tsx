import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useTheme } from "./theme.js";
import { useStyle } from "./styles.js";

/** Зерно бумаги: SVG feTurbulence как data-URI — без растрового ассета. */
const PAPER_NOISE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  );

/** Клетка тетради: линии сетки плюс поле — вертикальная линия слева цветом акцента. */
const GRID_CELL = 54;
const GRID_MARGIN = 140;

/**
 * Непрерывный фон всего видео.
 *
 * Живёт ВНЕ Sequence сцен и завязан на абсолютный кадр: движение не перезапускается
 * на склейках, поэтому резкие смены сцен читаются как один клип, а не как набор слайдов.
 * Ни один кадр не является статичным — это дешёвый способ убрать ощущение «презентации».
 *
 * Устройство фона зависит от стиля темы (см. styles.ts): «glow» — светящиеся пятна
 * tech/documentary, «paper» — плоская бумага editorial, «flat» — чистый цвет
 * poster/kinetic, «grid» — тетрадный лист notebook.
 */
export const Background: React.FC = () => {
  const theme = useTheme();
  const style = useStyle();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  if (style.background === "flat") {
    return <AbsoluteFill style={{ backgroundColor: theme.canvas }} />;
  }

  if (style.background === "paper") {
    return (
      <AbsoluteFill style={{ backgroundColor: theme.canvas }}>
        <AbsoluteFill style={{ backgroundImage: `url("${PAPER_NOISE}")`, opacity: 0.06 }} />
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 75% at 50% 40%, rgba(255,255,255,0.4) 0%, transparent 65%)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (style.background === "grid") {
    return (
      <AbsoluteFill style={{ backgroundColor: theme.canvas }}>
        <AbsoluteFill
          style={{
            opacity: 0.5,
            backgroundImage: `repeating-linear-gradient(0deg, ${theme.border} 0 1px, transparent 1px ${GRID_CELL}px),
              repeating-linear-gradient(90deg, ${theme.border} 0 1px, transparent 1px ${GRID_CELL}px)`,
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.5,
            background: `linear-gradient(90deg, transparent ${GRID_MARGIN - 1}px, ${theme.accent} ${
              GRID_MARGIN - 1
            }px, ${theme.accent} ${GRID_MARGIN + 1}px, transparent ${GRID_MARGIN + 1}px)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  // "glow" — tech/documentary: медленный дрейф двух световых пятен, периоды
  // взаимно несоизмеримы, чтобы картинка не зацикливалась заметно на длине шортса.
  const x1 = 50 + 18 * Math.sin(t / 7.3);
  const y1 = 32 + 10 * Math.cos(t / 9.1);
  const x2 = 50 + 22 * Math.cos(t / 11.7);
  const y2 = 74 + 12 * Math.sin(t / 8.3);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.canvas }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(${width * 0.9}px ${height * 0.5}px at ${x1}% ${y1}%, ${theme.accentSoft} 0%, transparent 62%),
            radial-gradient(${width * 0.8}px ${height * 0.45}px at ${x2}% ${y2}%, ${theme.surfaceStrong} 0%, transparent 60%)`,
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
