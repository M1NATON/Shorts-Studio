import React from "react";
import { interpolate } from "remotion";
import { themeStyle, type StatCounterSpec } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";
import { Icon } from "../Icon.js";
import { rectPoints, Shape } from "../paper/index.js";

/**
 * Анимированный счётчик.
 *
 * Компонент durationInFrames-агностичен: короткая сцена (2 с) и длинная (9 с) должны
 * выглядеть одинаково осмысленно. Поэтому entrance фиксирован по кадрам, а счёт
 * занимает долю сцены — иначе на длинной озвучке число досчитает за секунду
 * и остаток сцены будет статичной картинкой.
 */
/**
 * Число style paper: та же анимация счёта, но на вобблящейся бумажной плашке
 * (Shape) и Lilita One вместо шрифта тела. Ширина плашки считается по финальному
 * значению — тем же приёмом, что и кегль NumberBlock в блоках, — иначе плашка
 * менялась бы в размере на каждом кадре счёта.
 */
const PaperPlaque: React.FC<{
  spec: StatCounterSpec;
  value: number;
  motionStyleProps: React.CSSProperties;
}> = ({ spec, value, motionStyleProps }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const accent = useAccent();
  const displayValue = value.toFixed(spec.decimals);
  const finalValue = spec.toValue.toFixed(spec.decimals);
  const numberWidth = finalValue.length * 200 * 0.62;
  const unitWidth = spec.unit ? spec.unit.length * 96 * 0.62 + 28 : 0;
  const plaqueWidth = Math.round(numberWidth + unitWidth + 96);
  const plaqueHeight = Math.round(200 * 1.15 + 64);

  return (
    <div
      style={{
        position: "relative",
        width: plaqueWidth,
        height: plaqueHeight,
        alignSelf: spec.layout === "left" ? "flex-start" : "center",
        ...motionStyleProps,
      }}
    >
      <Shape
        points={rectPoints(0, 0, plaqueWidth, plaqueHeight, 3)}
        width={plaqueWidth}
        height={plaqueHeight}
        seed={`stat-plaque-${spec.label}`}
        fill={theme.surfaceStrong}
        stroke={theme.border}
        strokeWidth={6}
        style={{ position: "absolute", inset: 0 }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
        }}
      >
        <span
          style={{
            fontSize: 200,
            fontFamily: font.headingFamily,
            fontWeight: font.headingWeight,
            color: theme.text,
            letterSpacing: `${theme.letterSpacing}em`,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {displayValue}
        </span>
        {spec.unit ? (
          <span
            style={{
              fontSize: 96,
              fontFamily: font.headingFamily,
              fontWeight: 700,
              color: accent,
              lineHeight: 1,
            }}
          >
            {spec.unit}
          </span>
        ) : null}
      </div>
    </div>
  );
};

const Body: React.FC<{ spec: StatCounterSpec }> = ({ spec }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const motionStyle = useMotionStyle();
  const { frame, fps, durationInFrames } = useSceneMotion();
  const accent = useAccent();
  const isPaper = themeStyle(theme) === "paper";

  const enter = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  // Счёт идёт 55% сцены, но не дольше 2.5 с — дольше зритель теряет интерес к числу.
  const countFrames = Math.min(Math.round(durationInFrames * 0.55), Math.round(fps * 2.5));
  const progress = interpolate(frame, [6, 6 + countFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  const value = spec.fromValue + (spec.toValue - spec.fromValue) * progress;

  return (
    <>
      {spec.icon ? (
        <div
          style={{
            alignSelf: spec.layout === "left" ? "flex-start" : "center",
            opacity: enter,
            scale: interpolate(enter, [0, 1], [0.7, 1], { output: "perceptual-scale" }),
          }}
        >
          <Icon name={spec.icon} size={96} color={accent} />
        </div>
      ) : null}

      {isPaper ? (
        <PaperPlaque
          spec={spec}
          value={value}
          motionStyleProps={motionStyle(spec.motion, enter)}
        />
      ) : (
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: spec.layout === "left" ? "flex-start" : "center",
          // 200px кегль: при меньшем зазоре число и единица склеиваются в «70years».
          gap: 28,
          ...motionStyle(spec.motion, enter),
        }}
      >
        <span
          style={{
            fontSize: 200,
            fontWeight: font.headingWeight,
            color: theme.text,
            letterSpacing: `${theme.letterSpacing}em`,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {value.toFixed(spec.decimals)}
        </span>
        {spec.unit ? (
          <span style={{ fontSize: 96, fontWeight: 700, color: accent, lineHeight: 1 }}>
            {spec.unit}
          </span>
        ) : null}
      </div>
      )}

      <div
        style={{
          fontSize: 48,
          color: theme.muted,
          maxWidth: 820,
          alignSelf: spec.layout === "left" ? "flex-start" : "center",
          opacity: interpolate(frame, [10, 24], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {spec.label}
      </div>
    </>
  );
};

export const StatCounter: React.FC<{ spec: StatCounterSpec }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={28}>
    <Body spec={spec} />
  </SceneFrame>
);
