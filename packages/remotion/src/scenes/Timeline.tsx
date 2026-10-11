import React from "react";
import { interpolate } from "remotion";
import { themeStyle, type TimelineSpec } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion, useStagger } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";
import { ellipsePoints, Line, Shape, type Point } from "../paper/index.js";

/**
 * Волнистая рельса таймлайна: несколько точек с синусоидальным сдвигом по x —
 * «рука художника», а не идеальная прямая. Само дрожание кадр-за-кадром даёт
 * Line (см. paper/wobble.ts), здесь только базовая форма линии.
 */
const RAIL_UNIT_W = 60;
const RAIL_UNIT_H = 1000;
function railPoints(count = 14): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    points.push({ x: RAIL_UNIT_W / 2 + Math.sin(t * Math.PI * 3) * RAIL_UNIT_W * 0.32, y: t * RAIL_UNIT_H });
  }
  return points;
}

/**
 * Последовательность шагов с соединительной линией.
 *
 * Линия прочерчивается сверху вниз по ходу сцены, а узлы загораются по очереди:
 * порядок «сначала это, потом то» виден глазом, а не только из текста. Этим
 * таймлайн отличается от icon-list, где пункты равноправны.
 */
const Body: React.FC<{ spec: TimelineSpec }> = ({ spec }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const stagger = useStagger();
  const motionStyle = useMotionStyle();
  const { frame, durationInFrames } = useSceneMotion();
  const accent = useAccent();
  const isPaper = themeStyle(theme) === "paper";
  const count = spec.steps.length;
  // Два шага не должны занимать пятую часть кадра: масштаб растёт, когда шагов мало.
  const nodeSize = count <= 2 ? 118 : count === 3 ? 102 : 90;
  const stepFontSize = count <= 2 ? 62 : count === 3 ? 56 : 50;
  const stepGap = count <= 2 ? 64 : count === 3 ? 44 : 34;
  const perStep = (durationInFrames * 0.75) / count;
  const reached = Math.min(count - 1, Math.floor(frame / perStep));
  // Линия идёт чуть впереди узлов, иначе кажется, что она догоняет текст.
  const lineProgress = interpolate(frame, [4, durationInFrames * 0.7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
            textAlign: "left",
            opacity: stagger(frame, 0, 2),
          }}
        >
          {spec.title}
        </div>
      ) : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: stepGap,
          width: "100%",
        }}
      >
        {/* Рельс: серая подложка на всю высоту и акцентная часть, растущая по времени. */}
        {isPaper ? (
          <>
            <Line
              points={railPoints()}
              width={RAIL_UNIT_W}
              height={RAIL_UNIT_H}
              seed="timeline-rail"
              stroke={theme.surfaceStrong}
              strokeWidth={5}
              wobbleAmount={3}
              preserveAspectRatio="none"
              style={{
                position: "absolute",
                left: nodeSize / 2 - RAIL_UNIT_W / 2,
                top: 12,
                bottom: 12,
                width: RAIL_UNIT_W,
                height: "auto",
              }}
            />
            <Line
              points={railPoints()}
              width={RAIL_UNIT_W}
              height={RAIL_UNIT_H}
              seed="timeline-rail"
              stroke={accent}
              strokeWidth={6}
              wobbleAmount={3}
              preserveAspectRatio="none"
              style={{
                position: "absolute",
                left: nodeSize / 2 - RAIL_UNIT_W / 2,
                top: 12,
                bottom: 12,
                width: RAIL_UNIT_W,
                height: "auto",
                clipPath: `inset(0 0 ${(1 - lineProgress) * 100}% 0)`,
              }}
            />
          </>
        ) : (
          <>
            <div
              style={{
                position: "absolute",
                left: nodeSize / 2 - 2,
                top: 12,
                bottom: 12,
                width: 4,
                backgroundColor: theme.surfaceStrong,
                borderRadius: 999,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: nodeSize / 2 - 2,
                top: 12,
                width: 4,
                height: `${lineProgress * 100}%`,
                backgroundColor: accent,
                borderRadius: 999,
              }}
            />
          </>
        )}

        {spec.steps.map((step, index) => {
          const appear = stagger(frame, index, 7);
          const isActive = index <= reached;
          return (
            <div
              key={`${index}-${step.label}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 28,
                textAlign: "left",
                ...motionStyle(spec.motion, appear, -1),
                opacity: appear * (isActive ? 1 : 0.5),
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: nodeSize,
                  height: nodeSize,
                  flexShrink: 0,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: Math.round(nodeSize / 3),
                  fontFamily: isPaper ? font.headingFamily : undefined,
                  fontWeight: font.headingWeight,
                  color: isActive ? theme.canvas : theme.muted,
                  ...(isPaper
                    ? {}
                    : {
                        borderRadius: 999,
                        backgroundColor: isActive ? accent : theme.surfaceStrong,
                        border: `3px solid ${isActive ? accent : theme.border}`,
                      }),
                }}
              >
                {isPaper ? (
                  <Shape
                    points={ellipsePoints(nodeSize / 2, nodeSize / 2, nodeSize / 2 - 2, nodeSize / 2 - 2, 20)}
                    width={nodeSize}
                    height={nodeSize}
                    seed={`timeline-node-${index}`}
                    fill={isActive ? accent : theme.surfaceStrong}
                    stroke={theme.border}
                    strokeWidth={5}
                    wobbleAmount={2.5}
                    style={{ position: "absolute", inset: 0 }}
                  />
                ) : null}
                <span style={{ position: "relative" }}>{step.label.length <= 4 ? step.label : index + 1}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {step.label.length > 4 ? (
                  <div style={{ fontSize: 32, fontWeight: 700, color: theme.muted, letterSpacing: "0.04em" }}>
                    {step.label}
                  </div>
                ) : null}
                <div style={{ fontSize: stepFontSize, fontWeight: 700, color: theme.text, lineHeight: 1.12 }}>
                  {step.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export const Timeline: React.FC<{ spec: TimelineSpec }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={26}>
    <Body spec={spec} />
  </SceneFrame>
);
