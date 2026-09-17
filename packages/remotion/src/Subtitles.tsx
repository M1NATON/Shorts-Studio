import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { findActiveWordIndex, type WordTiming } from "@shorts/contracts";
import { SAFE, theme } from "./theme.js";

/**
 * Пословные субтитры с подсветкой активного слова.
 *
 * Слова хранятся в секундах ОТНОСИТЕЛЬНО своей сцены, а компонент живёт внутри
 * Sequence этой же сцены, поэтому useCurrentFrame() здесь уже локальный — никакого
 * вычитания startFrame не нужно, и это единственное место перевода секунд в кадры в UI.
 */
export const Subtitles: React.FC<{ words: WordTiming[]; approximate: boolean }> = ({
  words,
  approximate,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeSec = frame / fps;

  // Показываем окно вокруг активного слова, а не весь текст сцены: на 9:16 иначе не читается.
  // Активное слово ищется hold-логикой (см. findActiveWordIndex): на реальных данных Fish
  // условие start <= t < end гасит подсветку в паузах и на словах нулевой длительности.
  const activeIndex = findActiveWordIndex(words, timeSec);
  const center = activeIndex === -1 ? 0 : activeIndex;
  const from = Math.max(0, center - 3);
  const window = words.slice(from, from + 7);

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.side,
        right: SAFE.side,
        bottom: SAFE.bottom - 180,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0 16px",
        fontSize: 56,
        fontWeight: 700,
        lineHeight: 1.25,
        textAlign: "center",
      }}
    >
      {window.map((word, i) => {
        const isActive = from + i === activeIndex;
        return (
          <span
            key={`${word.text}-${from + i}`}
            style={{
              color: isActive ? theme.accent : theme.text,
              opacity: isActive ? 1 : 0.72,
              textShadow: "0 4px 24px rgba(0,0,0,0.55)",
              transform: isActive ? "translateY(-4px)" : "none",
            }}
          >
            {word.text}
          </span>
        );
      })}
      {approximate ? (
        <div style={{ width: "100%", marginTop: 16, fontSize: 24, fontWeight: 500, color: theme.muted }}>
          subtitle timing is approximate
        </div>
      ) : null}
    </div>
  );
};
