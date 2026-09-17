import React from "react";
import { interpolate } from "remotion";
import type { StatCounterSpec } from "@shorts/contracts";
import { theme } from "../theme.js";
import { useSceneMotion } from "../motion.js";
import { SceneFrame, motionStyle, useAccent } from "../presentation.js";
import { Icon } from "../Icon.js";

/**
 * Анимированный счётчик.
 *
 * Компонент durationInFrames-агностичен: короткая сцена (2 с) и длинная (9 с) должны
 * выглядеть одинаково осмысленно. Поэтому entrance фиксирован по кадрам, а счёт
 * занимает долю сцены — иначе на длинной озвучке число досчитает за секунду
 * и остаток сцены будет статичной картинкой.
 */
const Body: React.FC<{ spec: StatCounterSpec }> = ({ spec }) => {
  const { frame, fps, durationInFrames } = useSceneMotion();
  const accent = useAccent();

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
            fontWeight: 800,
            color: theme.text,
            letterSpacing: "-0.04em",
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
