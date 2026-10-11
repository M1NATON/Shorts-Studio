import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import { BLOCK_TYPE, PAPER, themeStyle } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useMotionProfile } from "../motion.js";
import { useAccent } from "../presentation.js";
import { useSurface } from "../styles.js";
import { rectPoints, Shape } from "../paper/index.js";
import type { BlockProps } from "./types.js";

const T = BLOCK_TYPE;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Единица viewBox для бумажных столбцов: реальная ширина блока известна только
 * в разметке (100% родителя), а Shape рисует полигон в фиксированных
 * координатах. 1000 — приближение типичной ширины сцены в дизайн-пикселях
 * (900–1100), поэтому единица viewBox ≈ 1px кадра и amount дрожания (px)
 * выглядит одинаково при любой реальной ширине блока (см. preserveAspectRatio="none").
 */
const BAR_UNIT = 1000;
const PAPER_BAR_COLORS = [PAPER.mustard, PAPER.sage, PAPER.grey, PAPER.blush] as const;

/** Разделители разрядов фиксированной локалью: рендер не зависит от машины. */
const format = (value: number, decimals: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * Длительность счёта: доля оставшейся сцены, но не дольше 2.5 с — иначе на
 * длинной озвучке число досчитывает за секунду до склейки, а на короткой не успевает.
 */
function useCountProgress(localFrame: number, remainingFrames: number, delay = 4): number {
  const { fps } = useVideoConfig();
  const frames = Math.max(8, Math.min(Math.round(remainingFrames * 0.55), Math.round(fps * 2.5)));
  return interpolate(localFrame, [delay, delay + frames], [0, 1], { ...clamp, easing: easeOutCubic });
}

export const NumberBlock: React.FC<BlockProps<"number">> = ({
  block,
  localFrame,
  remainingFrames,
  align,
}) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const progress = useCountProgress(localFrame, remainingFrames);
  const shown = format(block.from + (block.value - block.from) * progress, block.decimals);
  // Кегль по финальному значению, а не по текущему: иначе число «дышало» бы во время счёта.
  const finalChars = format(block.value, block.decimals).length + (block.unit ? block.unit.length * 0.5 : 0);
  const size = Math.min(T.number.size, Math.floor(880 / (finalChars * 0.62)));

  return (
    <div style={{ width: "100%", textAlign: align }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: align === "left" ? "flex-start" : "center",
          gap: Math.round(size * 0.14),
          height: T.number.size,
        }}
      >
        <span
          style={{
            fontSize: size,
            lineHeight: 1,
            fontFamily: font.headingFamily,
            fontWeight: font.headingWeight,
            color: theme.text,
            letterSpacing: `${theme.letterSpacing}em`,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {shown}
        </span>
        {block.unit ? (
          <span
            style={{
              fontSize: Math.round(size * 0.46),
              fontFamily: font.headingFamily,
              fontWeight: 700,
              color: accent,
              lineHeight: 1,
            }}
          >
            {block.unit}
          </span>
        ) : null}
      </div>
      {block.caption ? (
        <div
          style={{
            marginTop: T.number.captionGap,
            fontSize: T.number.captionSize,
            lineHeight: 1.25,
            color: theme.muted,
          }}
        >
          {block.caption}
        </div>
      ) : null}
    </div>
  );
};

/** Кольцевая диаграмма: дуга заполняется до доли, в центре досчитывается процент. */
export const RingBlock: React.FC<BlockProps<"ring">> = ({ block, localFrame, remainingFrames }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const progress = useCountProgress(localFrame, remainingFrames);
  const { diameter, stroke } = T.ring;
  const radius = (diameter - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = (block.percent / 100) * progress;
  const decimals = Number.isInteger(block.percent) ? 0 : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: T.ring.labelGap }}>
      <div style={{ position: "relative", width: diameter, height: diameter }}>
        <svg width={diameter} height={diameter} style={{ rotate: "-90deg" }}>
          <circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            stroke={theme.surfaceStrong}
            strokeWidth={stroke}
          />
          <circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap={share > 0 ? "round" : "butt"}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: T.ring.valueSize,
            fontFamily: font.headingFamily,
            fontWeight: font.headingWeight,
            color: theme.text,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: `${theme.letterSpacing}em`,
          }}
        >
          {format(block.percent * progress, decimals)}%
        </div>
      </div>
      <div
        style={{
          fontSize: T.ring.labelSize,
          lineHeight: 1.25,
          color: theme.muted,
          textAlign: "center",
          maxWidth: 820,
        }}
      >
        {block.label}
      </div>
    </div>
  );
};

/**
 * Столбцы растут по очереди. Максимальный — цветом акцента: взгляд сразу находит,
 * о чём фраза, остальные дают масштаб.
 */
export const BarsBlock: React.FC<BlockProps<"bars">> = ({ block, localFrame, remainingFrames }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const surface = useSurface();
  const { staggerFrames } = useMotionProfile();
  const { fps } = useVideoConfig();
  const max = Math.max(...block.items.map((item) => item.value));
  const growFrames = Math.max(8, Math.min(Math.round(remainingFrames * 0.45), Math.round(fps * 1.6)));
  const decimals = block.items.some((item) => !Number.isInteger(item.value)) ? 1 : 0;
  // Заливка трека под "surface", но радиус не больше половины высоты — иначе
  // столбик перестаёт быть пилюлей.
  const track = surface(false, accent);
  const trackRadius = Math.min(typeof track.borderRadius === "number" ? track.borderRadius : 0, T.bars.barHeight / 2);
  const isPaper = themeStyle(theme) === "paper";

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: T.bars.rowGap }}>
      {block.items.map((item, index) => {
        const start = 4 + index * staggerFrames * 2;
        const grow = interpolate(localFrame, [start, start + growFrames], [0, 1], {
          ...clamp,
          easing: easeOutCubic,
        });
        const isMax = item.value === max;
        return (
          <div key={`${index}-${item.label}`} style={{ textAlign: "left" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: T.bars.labelSize,
                lineHeight: 1.2,
                marginBottom: T.bars.labelGap,
              }}
            >
              <span style={{ color: theme.muted, fontWeight: 600 }}>{item.label}</span>
              <span
                style={{
                  color: isMax ? accent : theme.text,
                  fontFamily: isPaper ? font.headingFamily : undefined,
                  fontWeight: font.headingWeight,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {format(item.value * grow, decimals)}
                {block.unit ? ` ${block.unit}` : ""}
              </span>
            </div>
            {isPaper ? (
              <div style={{ position: "relative", height: T.bars.barHeight }}>
                <Shape
                  points={rectPoints(0, 0, BAR_UNIT, T.bars.barHeight, 3)}
                  width={BAR_UNIT}
                  height={T.bars.barHeight}
                  seed={`bar-track-${index}-${item.label}`}
                  fill={theme.surface}
                  stroke={theme.border}
                  strokeWidth={3}
                  wobbleAmount={2}
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
                <Shape
                  points={rectPoints(0, 0, Math.max(6, (max > 0 ? (item.value / max) * grow : 0) * BAR_UNIT), T.bars.barHeight, 3)}
                  width={BAR_UNIT}
                  height={T.bars.barHeight}
                  seed={`bar-fill-${index}-${item.label}`}
                  fill={isMax ? accent : PAPER_BAR_COLORS[index % PAPER_BAR_COLORS.length]!}
                  stroke={theme.border}
                  strokeWidth={4}
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
              </div>
            ) : (
              <div
                style={{
                  height: T.bars.barHeight,
                  overflow: "hidden",
                  ...track,
                  borderRadius: trackRadius,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${max > 0 ? (item.value / max) * grow * 100 : 0}%`,
                    backgroundColor: isMax ? accent : theme.muted,
                    opacity: isMax ? 1 : 0.55,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
