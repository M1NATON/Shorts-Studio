import React from "react";
import { interpolate } from "remotion";
import type { HookStatementSpec } from "@shorts/contracts";
import { CONTENT_INSET, theme } from "../theme.js";
import { stagger, useSceneMotion } from "../motion.js";

/** Нормализация для сравнения с emphasisWords: регистр и пунктуация не должны мешать. */
const normalize = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Размер шрифта под длину текста: спека допускает до 90 символов, и один и тот же
 * кегль либо разваливает короткую фразу, либо не вмещает длинную.
 */
const fontSizeFor = (length: number): number => {
  if (length <= 34) return 108;
  if (length <= 58) return 88;
  return 72;
};

/**
 * Главный текстовый тип сцены: заявление или цитата.
 *
 * Слова выезжают каскадом, а не появляются блоком — так кадр живёт всё время, пока
 * диктор произносит фразу. Акцентные слова подсвечиваются цветом и весом, поэтому
 * зритель видит смысловой центр фразы до того, как дослушает её.
 */
export const HookStatement: React.FC<{ spec: HookStatementSpec }> = ({ spec }) => {
  const { frame, visible } = useSceneMotion();
  const words = spec.text.split(/\s+/);
  const emphasis = new Set(spec.emphasisWords.map(normalize));
  const fontSize = fontSizeFor(spec.text.length);
  const isQuote = spec.variant === "quote";

  return (
    <div
      style={{
        position: "absolute",
        inset: CONTENT_INSET,
        display: "flex",
        flexDirection: "column",
        alignItems: isQuote ? "flex-start" : "center",
        justifyContent: "center",
        gap: 32,
        opacity: visible,
      }}
    >
      {isQuote ? (
        <div
          style={{
            fontSize: 220,
            lineHeight: 0.7,
            height: 120,
            color: theme.accent,
            opacity: interpolate(frame, [0, 14], [0, 0.55], { extrapolateRight: "clamp" }),
            scale: interpolate(frame, [0, 14], [0.6, 1], {
              extrapolateRight: "clamp",
              output: "perceptual-scale",
            }),
          }}
        >
          “
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: `${Math.round(fontSize * 0.18)}px ${Math.round(fontSize * 0.26)}px`,
          justifyContent: isQuote ? "flex-start" : "center",
          textAlign: isQuote ? "left" : "center",
          fontSize,
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: "-0.03em",
        }}
      >
        {words.map((word, index) => {
          const appear = stagger(frame, index, 2);
          const isEmphasized = emphasis.has(normalize(word));
          return (
            <span
              key={`${index}-${word}`}
              style={{
                display: "inline-block",
                color: isEmphasized ? theme.accent : theme.text,
                opacity: appear,
                translate: `0px ${(1 - appear) * 26}px`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {spec.attribution ? (
        <div
          style={{
            fontSize: 40,
            fontWeight: 500,
            color: theme.muted,
            opacity: interpolate(frame, [words.length * 2 + 6, words.length * 2 + 20], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          — {spec.attribution}
        </div>
      ) : null}
    </div>
  );
};
