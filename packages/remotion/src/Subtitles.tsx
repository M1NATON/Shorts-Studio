import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { buildCaptionPages, findActivePageIndex, findActiveWordIndex, type WordTiming } from "@shorts/contracts";
import { SAFE, theme } from "./theme.js";

/** Высота бокса под 2 строки — зарезервирована всегда, поэтому блок не прыгает. */
const BOX_HEIGHT = 230;
const FONT_SIZE = 68;

/**
 * Субтитры страницами: 2–3 слова держатся ~1.2 с, внутри страницы меняется только
 * подсветка активного слова.
 *
 * Почему не «окно вокруг активного слова» (было раньше): окно пересобиралось на каждом
 * слове и строка переверстывалась 13 раз за 7-секундную сцену — субтитры дёргались,
 * а при переходе с одной строки на две прыгал весь блок.
 *
 * Три гарантии стабильности кадра:
 * 1) состав страницы и её время посчитаны заранее (buildCaptionPages), кадр их не меняет;
 * 2) бокс фиксированной высоты с центрированием — перенос на вторую строку не двигает блок;
 * 3) подсветка — только color/transform, то есть свойства, которые не вызывают reflow.
 *
 * Слова хранятся в секундах относительно аудио своей сцены, а компонент живёт внутри
 * Sequence этой сцены, поэтому useCurrentFrame() здесь уже локальный.
 */
export const Subtitles: React.FC<{ words: WordTiming[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeSec = frame / fps;

  const pages = useMemo(() => buildCaptionPages(words), [words]);
  const pageIndex = findActivePageIndex(pages, timeSec);
  const page = pageIndex === -1 ? undefined : pages[pageIndex];
  const activeWordIndex = findActiveWordIndex(words, timeSec);

  if (!page) return null;

  const pageStartFrame = Math.round(page.startSec * fps);
  const entrance = spring({
    frame: frame - pageStartFrame,
    fps,
    durationInFrames: 8,
    config: { damping: 200 },
  });

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.side,
        right: SAFE.side,
        bottom: SAFE.bottom,
        height: BOX_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          // Зазор с запасом: активное слово масштабируется, и при 18px оно визуально
          // склеивалось с соседним.
          gap: "6px 30px",
          fontSize: FONT_SIZE,
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          textAlign: "center",
          opacity: entrance,
          transform: `translateY(${interpolate(entrance, [0, 1], [18, 0])}px)`,
          willChange: "transform, opacity",
        }}
      >
        {page.words.map((word, i) => {
          const isActive = page.firstWordIndex + i === activeWordIndex;
          return (
            <span
              key={`${page.firstWordIndex + i}-${word.text}`}
              style={{
                display: "inline-block",
                color: isActive ? theme.accent : theme.text,
                transform: isActive ? "scale(1.04)" : "scale(1)",
                textShadow: isActive
                  ? `0 0 42px ${theme.accentSoft}, 0 6px 26px rgba(0,0,0,0.65)`
                  : "0 6px 26px rgba(0,0,0,0.65)",
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
