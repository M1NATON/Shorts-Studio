import React from "react";
import { interpolate } from "remotion";
import type { ComparisonSpec } from "@shorts/contracts";
import { CONTENT_INSET, theme } from "../theme.js";
import { stagger, useSceneMotion } from "../motion.js";
import { Icon } from "../Icon.js";

/**
 * Сопоставление «А vs Б» (до трёх сторон).
 *
 * На 9:16 карточки стоят вертикально, а не рядом: в колонках по 500px значение
 * приходится резать до нечитаемого кегля. Карточки выезжают с разных сторон —
 * противопоставление читается как движение, а не как таблица.
 */
export const Comparison: React.FC<{ spec: ComparisonSpec }> = ({ spec }) => {
  const { frame, visible } = useSceneMotion();
  const showVersus = spec.items.length === 2;

  return (
    <div
      style={{
        position: "absolute",
        inset: CONTENT_INSET,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: showVersus ? 12 : 26,
        opacity: visible,
      }}
    >
      {spec.title ? (
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: theme.muted,
            textAlign: "center",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            marginBottom: 16,
            opacity: stagger(frame, 0, 2),
          }}
        >
          {spec.title}
        </div>
      ) : null}

      {spec.items.map((item, index) => {
        const appear = stagger(frame, index, 7);
        const fromLeft = index % 2 === 0;
        return (
          <React.Fragment key={`${index}-${item.label}`}>
            {showVersus && index === 1 ? (
              <div
                style={{
                  alignSelf: "center",
                  fontSize: 38,
                  fontWeight: 800,
                  color: theme.accent,
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
                backgroundColor: theme.surface,
                border: `2px solid ${theme.border}`,
                borderLeft: `10px solid ${index === 0 ? theme.accent : theme.surface3}`,
                opacity: appear,
                translate: `${(1 - appear) * (fromLeft ? -90 : 90)}px 0px`,
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
        );
      })}
    </div>
  );
};
