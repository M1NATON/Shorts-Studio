import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneBackdrop } from "@shorts/contracts";
import { useTheme } from "./theme.js";

/**
 * Фактура фона сцены: слой между общим фоном ролика и контентом.
 *
 * Всё рисуется CSS-градиентами и медленно движется от кадра сцены — ни одна
 * сцена не выглядит статичной картинкой, и при этом не появляется ни одного
 * растрового ассета, который пришлось бы хранить и грузить.
 *
 * Прозрачность держим низкой: фактура должна читаться как материал кадра,
 * а не соперничать с текстом.
 */
export const Backdrop: React.FC<{ backdrop: SceneBackdrop; accent: string }> = ({
  backdrop,
  accent,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  if (backdrop === "plain") return null;

  if (backdrop === "grid") {
    const cell = 120;
    // Сетка ползёт на одну ячейку за 8 секунд — движение заметно только боковым зрением.
    const shift = (t * cell) / 8;
    return (
      <AbsoluteFill
        style={{
          opacity: theme.backdropOpacity,
          backgroundImage: `repeating-linear-gradient(0deg, ${theme.border} 0 2px, transparent 2px ${cell}px),
            repeating-linear-gradient(90deg, ${theme.border} 0 2px, transparent 2px ${cell}px)`,
          backgroundPosition: `${shift}px ${shift}px`,
          maskImage: "radial-gradient(120% 80% at 50% 45%, black 20%, transparent 85%)",
        }}
      />
    );
  }

  if (backdrop === "dots") {
    const cell = 72;
    const drift = Math.sin(t / 4) * 18;
    return (
      <AbsoluteFill
        style={{
          opacity: theme.backdropOpacity * 1.2,
          backgroundImage: `radial-gradient(${theme.surfaceStrong} 3px, transparent 3px)`,
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${drift}px ${-drift}px`,
          maskImage: "radial-gradient(100% 70% at 50% 50%, black 10%, transparent 80%)",
        }}
      />
    );
  }

  if (backdrop === "spotlight") {
    // Пятно расходится в начале сцены и дальше едва дышит — акцент на объекте в центре.
    const spread = interpolate(frame, [0, 24], [0.55, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const breath = 1 + Math.sin(t / 3) * 0.04;
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(${width * 0.75 * spread * breath}px ${
            height * 0.38 * spread * breath
          }px at 50% 42%, ${accent}33 0%, transparent 70%)`,
        }}
      />
    );
  }

  const angle = 18 + Math.sin(t / 6) * 3;
  return (
    <AbsoluteFill
      style={{
        opacity: theme.backdropOpacity * 0.8,
        backgroundImage: `repeating-linear-gradient(${angle}deg, ${accent} 0 6px, transparent 6px 90px)`,
        backgroundPosition: `${t * 14}px 0px`,
        maskImage: "linear-gradient(180deg, transparent 0%, black 35%, black 65%, transparent 100%)",
      }}
    />
  );
};
