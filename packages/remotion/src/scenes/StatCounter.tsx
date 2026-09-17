import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StatCounterSpec } from "@shorts/contracts";
import { CONTENT_INSET, theme } from "../theme.js";
import { Icon } from "../Icon.js";

/**
 * Анимированный счётчик.
 *
 * Компонент durationInFrames-агностичен: короткая сцена (2с) и длинная (9с) должны
 * выглядеть одинаково осмысленно. Поэтому entrance фиксирован по кадрам, а счёт
 * занимает долю сцены — иначе на длинной озвучке число досчитает за секунду
 * и остаток сцены будет статичной картинкой.
 */
export const StatCounter: React.FC<{ spec: StatCounterSpec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });
  // Счёт идёт 55% сцены, но не дольше 2.5 с — дольше зритель теряет интерес к самому числу.
  const countFrames = Math.min(Math.round(durationInFrames * 0.55), Math.round(fps * 2.5));
  const progress = interpolate(frame, [6, 6 + countFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  const value = spec.fromValue + (spec.toValue - spec.fromValue) * progress;
  const display = value.toFixed(spec.decimals);

  return (
    <div
      style={{
        position: "absolute",
        inset: CONTENT_INSET,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
      }}
    >
      {spec.icon ? (
        <div style={{ opacity: enter, transform: `scale(${0.7 + enter * 0.3})` }}>
          <Icon name={spec.icon} size={96} color={theme.accent} />
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          transform: `translateY(${(1 - enter) * 40}px)`,
          opacity: enter,
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
          {display}
        </span>
        {spec.unit ? (
          <span style={{ fontSize: 96, fontWeight: 700, color: theme.accent, lineHeight: 1 }}>
            {spec.unit}
          </span>
        ) : null}
      </div>

      <div
        style={{
          fontSize: 48,
          color: theme.muted,
          textAlign: "center",
          maxWidth: 820,
          opacity: interpolate(frame, [10, 24], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translateY(${interpolate(frame, [10, 24], [20, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        {spec.label}
      </div>
    </div>
  );
};
