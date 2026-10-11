import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Loop,
  OffthreadVideo,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { themeStyle, type ManifestScene } from "@shorts/contracts";
import { useTheme } from "./theme.js";
import { rectPoints, Shape } from "./paper/index.js";

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
 * Бумажный стиль: фото не разворачивается во весь кадр (иллюстрированный фон — часть
 * стиля, см. Background.tsx), а «приклеено» полароидом поверх бумаги — рамка 20px
 * с дрожащим чернильным контуром, скотч на двух углах, лёгкий поворот и покачивание.
 * Насыщенность снижена и добавлен тёплый тон — снимок выглядит частью иллюстрации,
 * а не вставленной фотографией.
 */
const PaperMediaTile: React.FC<{
  media: NonNullable<ManifestScene["media"]>;
  durationInFrames: number;
  theme: ReturnType<typeof useTheme>;
}> = ({ media, durationInFrames, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const src = staticFile(media.src);
  const t = frame / fps;

  // Небольшой полароид в углу, а не во всю зону контента: сцена может рисовать
  // по центру собственный текст, и крупная плашка перекрыла бы его. Полностью
  // избежать пересечения с центрированным заголовком нельзя без координации с
  // текстом сцены (ponytail: угол фиксирован, тайл маленький — если в реальных
  // роликах фото будет перекрывать текст хука, стоит подвинуть текст под тайл
  // или зарезервировать для медиа полосу в SceneFrame).
  const tileWidth = Math.round(Math.min(width, height) * 0.26);
  const tileHeight = Math.round(tileWidth * 1.15);
  const border = 18;
  // Поворот и фаза покачивания — детерминированный шум от src сцены, а не Math.random,
  // иначе превью и итоговый MP4 разошлись бы.
  const rotation = (random(`paper-media-rot-${media.src}`) - 0.5) * 6;
  const phase = random(`paper-media-phase-${media.src}`) * Math.PI * 2;
  const bob = Math.sin(t / 2 + phase) * 6;
  const left = Math.round(width - width * 0.1 - tileWidth);
  const top = Math.round(height * 0.05);

  const loopFrames = media.durationSec ? Math.max(1, Math.floor(media.durationSec * fps)) : undefined;
  const video = <OffthreadVideo src={src} muted style={cover} />;

  const tape = (corner: "tl" | "br"): React.CSSProperties => ({
    position: "absolute",
    width: 96,
    height: 40,
    background: "rgba(255,255,255,0.55)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
    ...(corner === "tl"
      ? { top: -14, left: -10, rotate: "-32deg" }
      : { bottom: -14, right: -10, rotate: "-32deg" }),
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: tileWidth,
          height: tileHeight,
          rotate: `${rotation}deg`,
          translate: `0px ${bob}px`,
        }}
      >
        <Shape
          points={rectPoints(0, 0, 600, 600, 3)}
          width={600}
          height={600}
          seed={`paper-media-frame-${media.src}`}
          fill="#FFFDF6"
          stroke={theme.border}
          strokeWidth={6}
          wobbleAmount={3}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0 }}
        />
        <div style={{ position: "absolute", inset: border, overflow: "hidden" }}>
          {media.kind === "photo" ? (
            <Img src={src} style={{ ...cover, filter: "saturate(0.62) sepia(0.22) contrast(1.02)" }} />
          ) : loopFrames && loopFrames < durationInFrames ? (
            <Loop durationInFrames={loopFrames}>{video}</Loop>
          ) : (
            video
          )}
        </div>
        <div style={tape("tl")} />
        <div style={tape("br")} />
      </div>
    </AbsoluteFill>
  );
};

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

  if (themeStyle(theme) === "paper") {
    return <PaperMediaTile media={media} durationInFrames={durationInFrames} theme={theme} />;
  }

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
