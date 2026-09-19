import React from "react";
import { AbsoluteFill, Img, interpolate, Loop, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ManifestScene } from "@shorts/contracts";
import { useTheme } from "./theme.js";

/** hex "#rrggbb" → "rgba(r,g,b,alpha)": градиент читаемости поверх медиа красится цветом темы. */
const rgba = (hex: string, alpha: number): string => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const cover: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

/**
 * Фон сцены — фото/видео с Pexels во весь кадр, под контентом сцены и над общим
 * Background. Живёт внутри Sequence сцены, поэтому useCurrentFrame() здесь — это
 * локальный кадр от начала сцены, а не от начала ролика.
 */
export const SceneMedia: React.FC<{
  media: NonNullable<ManifestScene["media"]>;
  durationInFrames: number;
}> = ({ media, durationInFrames }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = staticFile(media.src);

  // Ken Burns: медленный наезд 1 → 1.12 со сдвигом на всю длительность сцены.
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.12], { extrapolateRight: "clamp" });
  const shiftX = interpolate(frame, [0, durationInFrames], [0, -16], { extrapolateRight: "clamp" });

  const loopFrames = media.durationSec ? Math.max(1, Math.floor(media.durationSec * fps)) : undefined;
  const video = <OffthreadVideo src={src} muted style={cover} />;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {media.kind === "photo" ? (
        <Img src={src} style={{ ...cover, transform: `scale(${scale}) translateX(${shiftX}px)` }} />
      ) : loopFrames && loopFrames < durationInFrames ? (
        <Loop durationInFrames={loopFrames}>{video}</Loop>
      ) : (
        video
      )}
      {/* Затемнение/высветление цветом канвы темы: текст темы остаётся читаемым поверх любой картинки. */}
      <AbsoluteFill
        style={{
          // Сильнее всего там, где текст сцены (≈12–66% высоты) и субтитры (низ); у верхней кромки картинка видна лучше.
          background: `linear-gradient(180deg, ${rgba(theme.canvas, 0.3)} 0%, ${rgba(theme.canvas, 0.55)} 14%, ${rgba(
            theme.canvas,
            0.55,
          )} 66%, ${rgba(theme.canvas, 0.8)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
