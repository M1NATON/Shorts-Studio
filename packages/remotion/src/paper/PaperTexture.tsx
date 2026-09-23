import React, { useMemo } from "react";
import { AbsoluteFill, random, useVideoConfig } from "remotion";

const FIBRE_COUNT = 900;

/**
 * Текстура волокон бумаги поверх всей композиции (сток-медиа и субтитры тоже
 * под ней) — `multiply` затемняет светлые места и почти не трогает тёмные,
 * как настоящая бумага, положенная поверх фото.
 *
 * Фактура статична: считается один раз на размер кадра через useMemo, а не на
 * каждый frame — это не анимация, а зерно, которое должно быть одинаковым весь
 * ролик. Работает и для 1080×1920, и для 1920×1080 — размеры берутся из
 * useVideoConfig, а не зашиты.
 */
export const PaperTexture: React.FC = () => {
  const { width, height } = useVideoConfig();

  const fibres = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; opacity: number }[] = [];
    for (let i = 0; i < FIBRE_COUNT; i++) {
      const x = random(`paper-fibre-x-${i}`) * width;
      const y = random(`paper-fibre-y-${i}`) * height;
      const angle = random(`paper-fibre-a-${i}`) * Math.PI * 2;
      const len = 4 + random(`paper-fibre-l-${i}`) * 14;
      const dx = (Math.cos(angle) * len) / 2;
      const dy = (Math.sin(angle) * len) / 2;
      lines.push({
        x1: x - dx,
        y1: y - dy,
        x2: x + dx,
        y2: y + dy,
        opacity: 0.05 + random(`paper-fibre-o-${i}`) * 0.12,
      });
    }
    return lines;
  }, [width, height]);

  return (
    <AbsoluteFill style={{ mixBlendMode: "multiply", pointerEvents: "none" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          {/* fractalNoise даёт шум 0–255 по всем каналам; feColorMatrix сжимает его
              в светлую часть (≈200–250), иначе текстура выглядит грязно-серой. */}
          <filter id="paper-texture-noise">
            <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} stitchTiles="stitch" result="noise" />
            <feColorMatrix
              in="noise"
              type="matrix"
              values="0.2 0 0 0 0.78  0 0.2 0 0 0.78  0 0 0.2 0 0.78  0 0 0 1 0"
            />
          </filter>
          <radialGradient id="paper-vignette" cx="50%" cy="45%" r="75%">
            <stop offset="55%" stopColor="#000000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000000" stopOpacity={0.18} />
          </radialGradient>
        </defs>
        <rect width={width} height={height} filter="url(#paper-texture-noise)" opacity={0.5} />
        {fibres.map((f, i) => (
          <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke="#3A332A" strokeWidth={1} opacity={f.opacity} />
        ))}
        <rect width={width} height={height} fill="url(#paper-vignette)" />
      </svg>
    </AbsoluteFill>
  );
};
