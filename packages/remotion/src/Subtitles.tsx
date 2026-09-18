import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  buildCaptionPages,
  findActivePageIndex,
  findActiveWordIndex,
  type CaptionStyle,
  type VideoTheme,
  type WordTiming,
} from "@shorts/contracts";
import { useFormat, useTheme, useThemeFont } from "./theme.js";

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
 * Размеры — из формата: в Shorts 3 слова крупно в боксе под 2 строки, в 16:9
 * одна строка до 7 слов у нижнего края. Бокс фиксированной высоты зарезервирован
 * всегда, поэтому блок не прыгает.
 *
 * Слова хранятся в секундах относительно аудио своей сцены, а компонент живёт внутри
 * Sequence этой сцены, поэтому useCurrentFrame() здесь уже локальный.
 */
/** Оформление слова по стилю: только color/transform/фон — без reflow страницы. */
function wordStyle(style: CaptionStyle, active: boolean, theme: VideoTheme, fontSize: number): React.CSSProperties {
  const shadow = "0 6px 26px rgba(0,0,0,0.65)";
  switch (style) {
    case "clean":
      return { color: theme.text, textShadow: shadow };
    case "boxed":
      return {
        color: active ? theme.canvas : theme.text,
        background: active ? theme.accent : "transparent",
        borderRadius: Math.round(fontSize * 0.18),
        padding: `0 ${Math.round(fontSize * 0.14)}px`,
        margin: `0 ${-Math.round(fontSize * 0.14)}px`,
      };
    case "outline":
      return {
        color: active ? theme.accent : "#ffffff",
        WebkitTextStroke: `${Math.max(2, Math.round(fontSize * 0.09))}px #000000`,
        paintOrder: "stroke fill",
        textShadow: "0 4px 0 rgba(0,0,0,0.6)",
        transform: active ? "scale(1.06)" : "scale(1)",
      };
    case "karaoke":
    default:
      return {
        color: active ? theme.accent : theme.text,
        transform: active ? "scale(1.04)" : "scale(1)",
        textShadow: active ? `0 0 42px ${theme.accentSoft}, ${shadow}` : shadow,
      };
  }
}

export const Subtitles: React.FC<{ words: WordTiming[]; captionStyle?: CaptionStyle }> = ({ words, captionStyle = "karaoke" }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const { captions } = useFormat();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeSec = frame / fps;

  const pages = useMemo(
    () =>
      buildCaptionPages(words, {
        maxWordsPerPage: captions.maxWordsPerPage,
        maxCharsPerPage: captions.maxCharsPerPage,
      }),
    [words, captions.maxWordsPerPage, captions.maxCharsPerPage],
  );
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
        left: captions.side,
        right: captions.side,
        bottom: captions.bottom,
        height: captions.boxHeight,
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
          gap: `6px ${Math.round(captions.fontSize * 0.44)}px`,
          fontSize: captions.fontSize,
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          textAlign: "center",
          opacity: entrance,
          transform: `translateY(${interpolate(entrance, [0, 1], [18, 0])}px)`,
          willChange: "transform, opacity",
          // boxed: вся страница на плашке — читается поверх любого кадра.
          ...(captionStyle === "boxed"
            ? { background: "rgba(0,0,0,0.62)", padding: `${Math.round(captions.fontSize * 0.14)}px ${Math.round(captions.fontSize * 0.36)}px`, borderRadius: Math.round(captions.fontSize * 0.3) }
            : {}),
        }}
      >
        {page.words.map((word, i) => {
          const isActive = page.firstWordIndex + i === activeWordIndex;
          return (
            <span
              key={`${page.firstWordIndex + i}-${word.text}`}
              style={{ display: "inline-block", ...wordStyle(captionStyle, isActive, theme, captions.fontSize) }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
