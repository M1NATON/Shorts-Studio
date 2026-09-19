import React from "react";
import { interpolate } from "remotion";
import type { HookStatementSpec } from "@shorts/contracts";
import { useFormat, useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion, useScenePosition, useStagger } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";
import { textZoom, useStyle } from "../styles.js";

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
 * диктор произносит фразу. Направление каскада и композиция берутся из подачи
 * (spec.motion / spec.layout), поэтому две текстовые сцены в одном ролике выглядят
 * по-разному без второго компонента.
 */
const Body: React.FC<{ spec: HookStatementSpec }> = ({ spec }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const stagger = useStagger();
  const motionStyle = useMotionStyle();
  const { frame } = useSceneMotion();
  // Первая сцена ролика: хук должен читаться уже на кадре 0, а не проступать —
  // движение остаётся (scale/сдвиг), но опора на прозрачность-с-нуля убрана.
  const { isFirst } = useScenePosition();
  const accent = useAccent();
  const words = spec.text.split(/\s+/);
  const emphasis = new Set(spec.emphasisWords.map(normalize));
  const fontSize = fontSizeFor(spec.text.length);
  const isQuote = spec.variant === "quote";

  return (
    <>
      {isQuote ? (
        <div
          style={{
            fontSize: 200,
            lineHeight: 0.7,
            height: 110,
            color: accent,
            alignSelf: spec.layout === "left" ? "flex-start" : "center",
            opacity: isFirst ? 0.55 : interpolate(frame, [0, 14], [0, 0.55], { extrapolateRight: "clamp" }),
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
          justifyContent: spec.layout === "left" ? "flex-start" : "center",
          fontSize,
          fontWeight: font.headingWeight,
          lineHeight: 1.08,
          letterSpacing: `${theme.letterSpacing}em`,
        }}
      >
        {words.map((word, index) => (
          <span
            key={`${index}-${word}`}
            style={{
              display: "inline-block",
              color: emphasis.has(normalize(word)) ? accent : theme.text,
              ...motionStyle(spec.motion, stagger(frame, index, 2), index % 2 === 0 ? 1 : -1),
              // На первой сцене слова уже видны на кадре 0 — приезжают, но не проступают.
              ...(isFirst ? { opacity: 1 } : {}),
            }}
          >
            {word}
          </span>
        ))}
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
    </>
  );
};

export const HookStatement: React.FC<{ spec: HookStatementSpec }> = ({ spec }) => {
  const format = useFormat();
  const style = useStyle();
  const { isFirst } = useScenePosition();
  // extra: кавычка цитаты (200px × 0.7), подпись 40px и промежутки gap={32}.
  const extra = (spec.variant === "quote" ? 140 + 32 : 0) + (spec.attribution ? 40 * 1.3 + 32 : 0);
  const zoom = textZoom([spec.text], fontSizeFor(spec.text.length), format.name, style.maxZoom, extra);
  return (
    <SceneFrame presentation={spec} gap={32} zoom={zoom} instant={isFirst}>
      <Body spec={spec} />
    </SceneFrame>
  );
};
