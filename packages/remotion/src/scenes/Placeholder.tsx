import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { SAFE, theme } from "../theme.js";

/** Временный рендер для типов сцен, которые реализуются в Фазе 2A. */
export const Placeholder: React.FC<{ kind: string; title: string; lines?: string[] }> = ({
  kind,
  title,
  lines = [],
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        inset: `${SAFE.top}px ${SAFE.side}px ${SAFE.bottom}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30}px)`,
      }}
    >
      <div style={{ fontSize: 24, letterSpacing: "0.18em", color: theme.muted, textTransform: "uppercase" }}>
        {kind}
      </div>
      <div style={{ fontSize: 68, fontWeight: 800, color: theme.text, textAlign: "center", lineHeight: 1.15 }}>
        {title}
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 40, color: theme.muted, textAlign: "center" }}>
          {line}
        </div>
      ))}
    </div>
  );
};
