import React from "react";
import { interpolate } from "remotion";
import type { TimelineSpec } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion, useStagger } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";

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
                  width: nodeSize,
                  height: nodeSize,
                  flexShrink: 0,
                  borderRadius: 999,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: Math.round(nodeSize / 3),
                  fontWeight: font.headingWeight,
                  color: isActive ? theme.canvas : theme.muted,
                  backgroundColor: isActive ? accent : theme.surfaceStrong,
                  border: `3px solid ${isActive ? accent : theme.border}`,
                }}
              >
                {step.label.length <= 4 ? step.label : index + 1}
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
