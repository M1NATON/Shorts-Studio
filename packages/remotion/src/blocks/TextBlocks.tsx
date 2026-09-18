import React from "react";
import { interpolate } from "remotion";
import { ArrowDown } from "lucide-react";
import { BLOCK_TYPE } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useMotionProfile, useStagger } from "../motion.js";
import { useAccent } from "../presentation.js";
import { normalizeWord, type BlockProps } from "./types.js";

const T = BLOCK_TYPE;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Заголовок: слова проявляются каскадом, акцентные — цветом акцента сцены. */
export const HeadingBlock: React.FC<BlockProps<"heading">> = ({ block, localFrame, align }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const stagger = useStagger();
  const size = T.heading[block.size];
  const emphasis = new Set(block.emphasisWords.map(normalizeWord));
  const words = block.text.split(/\s+/);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "left" ? "flex-start" : "center",
        gap: `0px ${Math.round(size * 0.26)}px`,
        fontSize: size,
        fontWeight: font.headingWeight,
        lineHeight: T.heading.lineHeight,
        letterSpacing: `${theme.letterSpacing}em`,
        width: "100%",
      }}
    >
      {words.map((word, index) => (
        <span
          key={`${index}-${word}`}
          style={{
            display: "inline-block",
            color: emphasis.has(normalizeWord(word)) ? accent : theme.text,
            opacity: stagger(localFrame, index, 2),
          }}
        >
          {word}
        </span>
      ))}
    </div>
  );
};

export const CaptionBlock: React.FC<BlockProps<"caption">> = ({ block }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        fontSize: T.caption.size,
        lineHeight: T.caption.lineHeight,
        color: theme.muted,
        fontWeight: 500,
        width: "100%",
      }}
    >
      {block.text}
    </div>
  );
};

/** Плашка-рубрика: короткий текст капсом на мягком акценте. */
export const BadgeBlock: React.FC<BlockProps<"badge">> = ({ block }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  return (
    <div
      style={{
        display: "inline-block",
        fontSize: T.badge.size,
        lineHeight: 1.2,
        padding: `${T.badge.padY}px ${T.badge.padX}px`,
        borderRadius: 999,
        backgroundColor: theme.accentSoft,
        color: accent,
        fontWeight: font.headingWeight,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {block.text}
    </div>
  );
};

export const QuoteBlock: React.FC<BlockProps<"quote">> = ({ block, localFrame }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const { enterFrames } = useMotionProfile();
  const attributionIn = interpolate(localFrame, [enterFrames, enterFrames * 2], [0, 1], clamp);

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          height: T.quote.markHeight,
          fontSize: 200,
          lineHeight: 0.8,
          color: accent,
          opacity: 0.6,
          fontFamily: "Georgia, serif",
        }}
      >
        “
      </div>
      <div
        style={{
          fontSize: T.quote.size,
          lineHeight: T.quote.lineHeight,
          fontWeight: Math.min(font.headingWeight, 700),
          color: theme.text,
          letterSpacing: `${theme.letterSpacing}em`,
        }}
      >
        {block.text}
      </div>
      {block.attribution ? (
        <div
          style={{
            marginTop: T.quote.attributionGap,
            fontSize: T.quote.attributionSize,
            color: theme.muted,
            opacity: attributionIn,
          }}
        >
          — {block.attribution}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Разделитель. Линия прочерчивается, «VS» появляется между двумя растущими
 * линиями, стрелка мягко покачивается — это единственный блок, который двигается
 * всё время: он указывает, куда смотреть дальше.
 */
export const DividerBlock: React.FC<BlockProps<"divider">> = ({ block, localFrame }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const { enterFrames, easing } = useMotionProfile();
  const grow = interpolate(localFrame, [0, enterFrames * 1.6], [0, 1], { ...clamp, easing });

  if (block.variant === "arrow") {
    return (
      <div
        style={{
          height: T.divider.arrow,
          display: "flex",
          alignItems: "center",
          translate: `0px ${Math.sin(localFrame / 7) * 8}px`,
        }}
      >
        <ArrowDown size={72} color={accent} strokeWidth={2.4} />
      </div>
    );
  }

  const line = (
    <div
      style={{
        height: T.divider.line,
        borderRadius: T.divider.line,
        backgroundColor: block.variant === "vs" ? theme.border : accent,
        width: block.variant === "vs" ? 220 * grow : 360 * grow,
      }}
    />
  );

  if (block.variant === "line") return line;

  return (
    <div style={{ height: T.divider.vs, display: "flex", alignItems: "center", gap: 24 }}>
      {line}
      <div
        style={{
          width: T.divider.vs,
          height: T.divider.vs,
          borderRadius: "50%",
          border: `3px solid ${accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 40,
          fontWeight: font.headingWeight,
          color: accent,
          letterSpacing: "0.04em",
          scale: interpolate(grow, [0, 1], [0.5, 1], { output: "perceptual-scale" }),
        }}
      >
        VS
      </div>
      {line}
    </div>
  );
};

/**
 * Титульная карточка главы: надзаголовок, крупный номер, название. Номер
 * проявляется первым, название — следом, линия акцента растёт под ними.
 */
export const ChapterBlock: React.FC<BlockProps<"chapter">> = ({ block, localFrame, align }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const { enterFrames, easing } = useMotionProfile();
  const appear = (delay: number) =>
    interpolate(localFrame - delay, [0, enterFrames], [0, 1], { ...clamp, easing });
  const C = T.chapter;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "left" ? "flex-start" : "center",
        gap: C.gap,
        width: "100%",
      }}
    >
      {block.kicker ? (
        <div
          style={{
            fontSize: C.kickerSize,
            lineHeight: 1.2,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: theme.muted,
            opacity: appear(0),
          }}
        >
          {block.kicker}
        </div>
      ) : null}
      <div
        style={{
          fontSize: C.indexSize,
          lineHeight: 1,
          height: C.indexSize,
          fontWeight: font.headingWeight,
          color: accent,
          fontVariantNumeric: "tabular-nums",
          opacity: appear(2),
          scale: String(interpolate(appear(2), [0, 1], [0.9, 1])),
        }}
      >
        {String(block.index).padStart(2, "0")}
      </div>
      <div
        style={{
          fontSize: C.titleSize,
          lineHeight: C.lineHeight,
          fontWeight: font.headingWeight,
          letterSpacing: `${theme.letterSpacing}em`,
          color: theme.text,
          opacity: appear(6),
          translate: `0px ${(1 - appear(6)) * 24}px`,
        }}
      >
        {block.title}
      </div>
    </div>
  );
};
