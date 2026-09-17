import React from "react";
import { interpolate } from "remotion";
import type { OutroCtaSpec } from "@shorts/contracts";
import { CONTENT_INSET, theme } from "../theme.js";
import { useSceneMotion } from "../motion.js";

/**
 * Финальная сцена.
 *
 * Здесь важно не «ещё одно движение», а остановка: текст приезжает один раз и
 * фиксируется, под ним прочерчивается акцентная линия. Выход не затемняем —
 * последний кадр должен остаться читаемым на превью.
 */
export const OutroCta: React.FC<{ spec: OutroCtaSpec }> = ({ spec }) => {
  const { frame, enter } = useSceneMotion();

  return (
    <div
      style={{
        position: "absolute",
        inset: CONTENT_INSET,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 34,
        opacity: enter,
      }}
    >
      <div
        style={{
          fontSize: spec.text.length <= 40 ? 96 : 76,
          fontWeight: 800,
          color: theme.text,
          textAlign: "center",
          lineHeight: 1.1,
          letterSpacing: "-0.03em",
          scale: interpolate(frame, [0, 16], [0.88, 1], {
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        {spec.text}
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 999,
          backgroundColor: theme.accent,
          width: interpolate(frame, [8, 30], [0, 260], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />

      {spec.subtext ? (
        <div
          style={{
            fontSize: 44,
            fontWeight: 500,
            color: theme.muted,
            textAlign: "center",
            maxWidth: 780,
            opacity: interpolate(frame, [18, 34], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: `0px ${interpolate(frame, [18, 34], [16, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}px`,
          }}
        >
          {spec.subtext}
        </div>
      ) : null}
    </div>
  );
};
