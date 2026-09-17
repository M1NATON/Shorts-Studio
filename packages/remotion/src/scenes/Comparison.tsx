import React from "react";
import { interpolate } from "remotion";
import type { ComparisonSpec } from "@shorts/contracts";
import { theme } from "../theme.js";
import { stagger, useSceneMotion } from "../motion.js";
import { SceneFrame, motionStyle, useAccent } from "../presentation.js";
import { Icon } from "../Icon.js";

/**
 * Сопоставление «А vs Б» (до трёх сторон).
 *
 * На 9:16 карточки стоят вертикально, а не рядом: в колонках по 500px значение
 * приходится резать до нечитаемого кегля. Карточки приезжают с разных сторон —
 * противопоставление читается как движение, а не как таблица.
 */
const Body: React.FC<{ spec: ComparisonSpec }> = ({ spec }) => {
  const { frame } = useSceneMotion();
  const accent = useAccent();
  const showVersus = spec.items.length === 2;

  return (
    <>
      {spec.title ? (
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: theme.muted,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            opacity: stagger(frame, 0, 2),
          }}
        >
          {spec.title}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: showVersus ? 10 : 24, width: "100%" }}>
        {spec.items.map((item, index) => (
          <React.Fragment key={`${index}-${item.label}`}>
            {showVersus && index === 1 ? (
              <div
                style={{
                  alignSelf: "center",
                  fontSize: 38,
                  fontWeight: 800,
                  color: accent,
                  letterSpacing: "0.1em",
                  padding: "10px 26px",
                  borderRadius: 999,
                  border: `2px solid ${theme.accentSoft}`,
                  backgroundColor: theme.canvas,
                  zIndex: 1,
                  margin: "-6px 0",
                  opacity: interpolate(frame, [10, 22], [0, 1], { extrapolateRight: "clamp" }),
                  scale: interpolate(frame, [10, 22], [0.5, 1], {
                    extrapolateRight: "clamp",
                    output: "perceptual-scale",
                  }),
                }}
              >
                VS
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                padding: "34px 36px",
                borderRadius: 32,
                textAlign: "left",
                backgroundColor: theme.surface,
                border: `2px solid ${theme.border}`,
                borderLeft: `10px solid ${index === 0 ? accent : theme.surface3}`,
                ...motionStyle(spec.motion, stagger(frame, index, 7), index % 2 === 0 ? -1 : 1),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {item.icon ? <Icon name={item.icon} size={44} color={theme.muted} /> : null}
                <div
                  style={{
                    fontSize: 38,
                    fontWeight: 700,
                    color: theme.muted,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {item.label}
                </div>
              </div>
              <div style={{ fontSize: 62, fontWeight: 800, color: theme.text, lineHeight: 1.1 }}>
                {item.value}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </>
  );
};

export const Comparison: React.FC<{ spec: ComparisonSpec }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={26}>
    <Body spec={spec} />
  </SceneFrame>
);
