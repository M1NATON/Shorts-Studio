import React from "react";
import { interpolate } from "remotion";
import { themeStyle, type ComparisonSpec } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion, useStagger } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";
import { useSurface } from "../styles.js";
import { Icon } from "../Icon.js";
import { PaperCard, capsulePoints, rectPoints, Shape } from "../paper/index.js";

/**
 * Сопоставление «А vs Б» (до трёх сторон).
 *
 * На 9:16 карточки стоят вертикально, а не рядом: в колонках по 500px значение
 * приходится резать до нечитаемого кегля. Карточки приезжают с разных сторон —
 * противопоставление читается как движение, а не как таблица.
 */
const Body: React.FC<{ spec: ComparisonSpec }> = ({ spec }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const stagger = useStagger();
  const motionStyle = useMotionStyle();
  const { frame } = useSceneMotion();
  const accent = useAccent();
  const surface = useSurface();
  const isPaper = themeStyle(theme) === "paper";
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
                  position: "relative",
                  alignSelf: "center",
                  fontSize: 38,
                  fontFamily: font.headingFamily,
                  fontWeight: font.headingWeight,
                  color: accent,
                  letterSpacing: "0.1em",
                  padding: "10px 26px",
                  zIndex: 1,
                  margin: "-6px 0",
                  opacity: interpolate(frame, [10, 22], [0, 1], { extrapolateRight: "clamp" }),
                  scale: interpolate(frame, [10, 22], [0.5, 1], {
                    extrapolateRight: "clamp",
                    output: "perceptual-scale",
                  }),
                  ...(isPaper
                    ? {}
                    : { borderRadius: 999, border: `2px solid ${theme.accentSoft}`, backgroundColor: theme.canvas }),
                }}
              >
                {isPaper ? (
                  <Shape
                    points={capsulePoints(0, 0, 600, 400, 3)}
                    width={600}
                    height={400}
                    seed="comparison-vs"
                    fill={theme.canvas}
                    stroke={theme.border}
                    strokeWidth={5}
                    wobbleAmount={2.5}
                    preserveAspectRatio="none"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                  />
                ) : null}
                <span style={{ position: "relative" }}>VS</span>
              </div>
            ) : null}

            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                padding: "34px 36px",
                textAlign: "left",
                ...(isPaper ? {} : surface(false, accent)),
                borderLeft: isPaper ? undefined : `10px solid ${index === 0 ? accent : theme.surfaceStrong}`,
                ...motionStyle(spec.motion, stagger(frame, index, 7), index % 2 === 0 ? -1 : 1),
              }}
            >
              {isPaper ? (
                <>
                  <PaperCard
                    seed={`comparison-card-${index}-${item.label}`}
                    fill={theme.surface}
                    stroke={theme.border}
                  />
                  <Shape
                    points={rectPoints(0, 0, 40, 600, 2)}
                    width={40}
                    height={600}
                    seed={`comparison-strip-${index}-${item.label}`}
                    fill={index === 0 ? accent : theme.surfaceStrong}
                    stroke={theme.border}
                    strokeWidth={4}
                    wobbleAmount={2}
                    preserveAspectRatio="none"
                    style={{ position: "absolute", left: 0, top: 0, width: 10, height: "100%" }}
                  />
                </>
              ) : null}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 16 }}>
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
              <div
                style={{
                  position: "relative",
                  fontSize: 62,
                  fontFamily: font.headingFamily,
                  fontWeight: font.headingWeight,
                  color: theme.text,
                  lineHeight: 1.1,
                }}
              >
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
