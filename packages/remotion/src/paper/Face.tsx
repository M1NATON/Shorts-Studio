import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { wobble } from "./wobble.js";

export type FaceMood = "happy" | "calm" | "wow" | "strain" | "sad";

const MOUTH_PATH: Record<FaceMood, (cx: number, cy: number, size: number) => string> = {
  happy: (cx, cy, size) =>
    `M ${cx - size * 0.16} ${cy + size * 0.12} Q ${cx} ${cy + size * 0.26} ${cx + size * 0.16} ${cy + size * 0.12}`,
  calm: (cx, cy, size) =>
    `M ${cx - size * 0.14} ${cy + size * 0.14} Q ${cx} ${cy + size * 0.18} ${cx + size * 0.14} ${cy + size * 0.14}`,
  wow: (cx, cy, size) =>
    `M ${cx} ${cy + size * 0.16} m ${-size * 0.07} 0 a ${size * 0.07} ${size * 0.09} 0 1 0 ${size * 0.14} 0 a ${size * 0.07} ${size * 0.09} 0 1 0 ${-size * 0.14} 0`,
  strain: (cx, cy, size) => `M ${cx - size * 0.14} ${cy + size * 0.18} L ${cx + size * 0.14} ${cy + size * 0.12}`,
  sad: (cx, cy, size) =>
    `M ${cx - size * 0.16} ${cy + size * 0.2} Q ${cx} ${cy + size * 0.08} ${cx + size * 0.16} ${cy + size * 0.2}`,
};

/**
 * Рисованное лицо-иконка: моргает раз в ~3.1 с (не синхронно у разных лиц — сдвиг
 * `seedOffset`), румянец на щеках всегда виден. Форма рта задаёт настроение сцены,
 * а не эмодзи — так один и тот же компонент подходит и для «восстания ИИ», и для
 * «как варят кофе».
 */
export const Face: React.FC<{
  mood: FaceMood;
  seed: string;
  seedOffset?: number;
  size?: number;
  ink: string;
  blush: string;
  style?: React.CSSProperties;
}> = ({ mood, seed, seedOffset = 0, size = 160, ink, blush, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const blinking = (t + seedOffset) % 3.1 < 0.12;

  const cx = size / 2;
  const cy = size / 2;
  const eyeY = cy - size * 0.06;
  const eyeDX = size * 0.16;
  const eyeR = size * 0.05;

  const [eyeLeft, eyeRight] = wobble(
    [
      { x: cx - eyeDX, y: eyeY },
      { x: cx + eyeDX, y: eyeY },
    ],
    seed,
    1.5,
    frame,
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ overflow: "visible", display: "block", ...style }}
    >
      <ellipse cx={cx - eyeDX * 1.6} cy={cy + size * 0.08} rx={size * 0.09} ry={size * 0.06} fill={blush} opacity={0.7} />
      <ellipse cx={cx + eyeDX * 1.6} cy={cy + size * 0.08} rx={size * 0.09} ry={size * 0.06} fill={blush} opacity={0.7} />
      {blinking ? (
        <>
          <line x1={eyeLeft!.x - eyeR} y1={eyeLeft!.y} x2={eyeLeft!.x + eyeR} y2={eyeLeft!.y} stroke={ink} strokeWidth={4} strokeLinecap="round" />
          <line x1={eyeRight!.x - eyeR} y1={eyeRight!.y} x2={eyeRight!.x + eyeR} y2={eyeRight!.y} stroke={ink} strokeWidth={4} strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={eyeLeft!.x} cy={eyeLeft!.y} r={eyeR} fill={ink} />
          <circle cx={eyeRight!.x} cy={eyeRight!.y} r={eyeR} fill={ink} />
        </>
      )}
      <path d={MOUTH_PATH[mood](cx, cy, size)} fill={mood === "wow" ? ink : "none"} stroke={ink} strokeWidth={5} strokeLinecap="round" />
    </svg>
  );
};
