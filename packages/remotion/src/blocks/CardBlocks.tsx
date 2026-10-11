import React from "react";
import { interpolate } from "remotion";
import { BLOCK_TYPE, themeStyle } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useMotionProfile, useStagger } from "../motion.js";
import { useAccent, useMotionStyle } from "../presentation.js";
import { useStyle, useSurface } from "../styles.js";
import { Icon } from "../Icon.js";
import { PaperCard } from "../paper/index.js";
import type { BlockProps } from "./types.js";

const T = BLOCK_TYPE;

/** Иконка внутри карточки для surface "none"/"rule" не подсвечивается подложкой. */
const flatIconBox = (surface: ReturnType<typeof useStyle>["surface"]): boolean =>
  surface === "none" || surface === "rule";

/** Строка-карточка. emphasis — та самая строка, ради которой сцена. */
export const RowBlock: React.FC<BlockProps<"row">> = ({ block }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const style = useStyle();
  const surface = useSurface();
  const isPaper = themeStyle(theme) === "paper";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: T.row.iconGap,
        padding: T.row.padding,
        boxSizing: "border-box",
        textAlign: "left",
        ...(isPaper ? {} : surface(block.emphasis, accent)),
      }}
    >
      {isPaper ? (
        <PaperCard
          seed={`row-card-${block.text}`}
          fill={block.emphasis ? theme.accentSoft : theme.surface}
          stroke={theme.border}
        />
      ) : null}
      <div
        style={{
          position: "relative",
          width: T.row.iconBox,
          height: T.row.iconBox,
          flexShrink: 0,
          borderRadius: Math.round(theme.cornerRadius * 0.8),
          backgroundColor: flatIconBox(style.surface) || isPaper
            ? "transparent"
            : block.emphasis
              ? theme.accentSoft
              : theme.surfaceStrong,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {block.icon ? (
          <Icon name={block.icon} size={50} color={block.emphasis ? accent : theme.muted} />
        ) : (
          <div style={{ width: 18, height: 18, borderRadius: "50%", backgroundColor: accent }} />
        )}
      </div>
      <div style={{ position: "relative" }}>
        {block.label ? (
          <div
            style={{
              fontSize: T.row.labelSize,
              lineHeight: 1.2,
              color: accent,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {block.label}
          </div>
        ) : null}
        <div
          style={{
            fontSize: T.row.size,
            lineHeight: T.row.lineHeight,
            fontWeight: Math.min(font.headingWeight, 700),
            color: theme.text,
          }}
        >
          {block.text}
        </div>
      </div>
    </div>
  );
};

/** Теги выпрыгивают по одному — облако собирается, пока диктор перечисляет. */
export const ChipsBlock: React.FC<BlockProps<"chips">> = ({ block, localFrame, align }) => {
  const theme = useTheme();
  const accent = useAccent();
  const stagger = useStagger();
  const motionStyle = useMotionStyle();
  const style = useStyle();
  const surface = useSurface();
  const isPaper = themeStyle(theme) === "paper";
  // tech/documentary — прежняя «таблетка»; у остальных стилей чип рисуется как их карточка.
  const pill = (first: boolean): React.CSSProperties =>
    style.surface === "fill"
      ? {
          borderRadius: 999,
          backgroundColor: first ? theme.accentSoft : theme.surface,
          border: `2px solid ${first ? accent : theme.border}`,
        }
      : surface(first, accent);

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "left" ? "flex-start" : "center",
        gap: T.chips.gap,
      }}
    >
      {block.items.map((item, index) => (
        <div
          key={`${index}-${item}`}
          style={{
            position: "relative",
            fontSize: T.chips.size,
            lineHeight: 1.2,
            fontWeight: 600,
            padding: `${T.chips.padY}px ${T.chips.padX}px`,
            color: index === 0 ? accent : theme.text,
            ...(isPaper ? {} : pill(index === 0)),
            ...motionStyle("pop", stagger(localFrame, index, 5)),
          }}
        >
          {isPaper ? (
            <PaperCard
              seed={`chip-card-${index}-${item}`}
              fill={index === 0 ? theme.accentSoft : theme.surface}
              stroke={theme.border}
              strokeWidth={5}
              perSide={2}
            />
          ) : null}
          <span style={{ position: "relative" }}>{item}</span>
        </div>
      ))}
    </div>
  );
};

/**
 * Крупная иконка-символ. Расходящийся круг повторяется всю сцену: кадр с одной
 * иконкой без движения выглядит как стоп-кадр.
 */
export const IconBlock: React.FC<BlockProps<"icon">> = ({ block, localFrame }) => {
  const theme = useTheme();
  const accent = useAccent();
  const period = 48;
  const pulse = localFrame < 0 ? 0 : (localFrame % period) / period;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: T.icon.captionGap }}>
      <div
        style={{
          position: "relative",
          width: T.icon.box,
          height: T.icon.box,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `3px solid ${accent}`,
            opacity: (1 - pulse) * 0.5,
            scale: String(1 + pulse * 0.28),
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            backgroundColor: theme.accentSoft,
          }}
        />
        <div style={{ position: "relative", display: "flex" }}>
          <Icon name={block.icon} size={T.icon.glyph} color={accent} />
        </div>
      </div>
      {block.caption ? (
        <div style={{ fontSize: T.icon.captionSize, lineHeight: 1.25, color: theme.muted, fontWeight: 600 }}>
          {block.caption}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Две карточки рядом, въезжают навстречу друг другу. Вторая подсвечена акцентом:
 * в «было / стало» и «A / B» вывод почти всегда во второй половине.
 */
export const PairBlock: React.FC<BlockProps<"pair">> = ({ block, localFrame }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const motionStyle = useMotionStyle();
  const surface = useSurface();
  const isPaper = themeStyle(theme) === "paper";
  const { enterFrames, easing, staggerFrames } = useMotionProfile();

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: T.pair.gap,
      }}
    >
      {block.items.map((item, index) => {
        const start = index * staggerFrames * 3;
        const appear = interpolate(localFrame, [start, start + enterFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing,
        });
        const highlighted = index === 1;
        return (
          <div
            key={`${index}-${item.label}`}
            style={{
              position: "relative",
              padding: T.pair.padding,
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              ...(isPaper ? {} : surface(highlighted, accent)),
              ...motionStyle("slide", appear, index === 0 ? -1 : 1),
            }}
          >
            {isPaper ? (
              <PaperCard
                seed={`pair-card-${index}-${item.label}`}
                fill={highlighted ? theme.accentSoft : theme.surface}
                stroke={theme.border}
              />
            ) : null}
            {item.icon ? (
              <div style={{ position: "relative", marginBottom: 2 }}>
                <Icon name={item.icon} size={T.pair.iconSize} color={highlighted ? accent : theme.muted} />
              </div>
            ) : null}
            <div
              style={{
                position: "relative",
                fontSize: T.pair.labelSize,
                lineHeight: 1.2,
                color: highlighted ? accent : theme.muted,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                position: "relative",
                fontSize: T.pair.valueSize,
                lineHeight: T.pair.lineHeight,
                fontFamily: isPaper ? font.headingFamily : undefined,
                fontWeight: font.headingWeight,
                color: theme.text,
                letterSpacing: `${theme.letterSpacing}em`,
              }}
            >
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
};
