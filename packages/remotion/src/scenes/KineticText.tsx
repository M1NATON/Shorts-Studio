import React from "react";
import { interpolate } from "remotion";
import type { KineticTextSpec } from "@shorts/contracts";
import { useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";

/**
 * Кинетическая типографика: строки выходят по очереди и занимают весь кадр.
 *
 * Тайминг привязан к длительности сцены, а не к фиксированным кадрам: на 3-секундной
 * озвучке четыре строки должны успеть показаться, на 8-секундной — не пролететь
 * за первую секунду и не оставить кадр статичным.
 *
 * Уже показанные строки не исчезают, а притухают и уменьшаются: зритель видит
 * всю фразу целиком, но взгляд держится на текущей строке.
 */
const Body: React.FC<{ spec: KineticTextSpec }> = ({ spec }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const motionStyle = useMotionStyle();
  const { frame, durationInFrames } = useSceneMotion();
  const accent = useAccent();
  const count = spec.lines.length;
  // Последнюю четверть сцены фраза стоит целиком — иначе финал читается как обрыв.
  const perLine = (durationInFrames * 0.75) / count;
  const longest = Math.max(...spec.lines.map((line) => line.length));
  const fontSize = longest <= 14 ? 132 : longest <= 20 ? 108 : 88;

  return (
    <>
      {spec.lines.map((line, index) => {
        const start = index * perLine;
        const appear = interpolate(frame, [start, start + 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const isCurrent = index === Math.min(count - 1, Math.floor(frame / perLine));
        const isEmphasized = spec.emphasisLine === index;
        const dim = isCurrent || isEmphasized ? 1 : 0.42;

        return (
          <div
            key={`${index}-${line}`}
            style={{
              fontSize,
              fontWeight: font.headingWeight,
              lineHeight: 1.02,
              letterSpacing: `${theme.letterSpacing}em`,
              color: isEmphasized ? accent : theme.text,
              textAlign: spec.layout === "left" ? "left" : "center",
              ...motionStyle(spec.motion, appear, index % 2 === 0 ? 1 : -1),
              opacity: appear * dim,
              // Масштаб — не перенос строки, поэтому соседние строки не двигаются.
              scale: interpolate(isCurrent || isEmphasized ? 1 : 0, [0, 1], [0.92, 1], {
                output: "perceptual-scale",
              }),
            }}
          >
            {line}
          </div>
        );
      })}
    </>
  );
};

export const KineticText: React.FC<{ spec: KineticTextSpec }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={10}>
    <Body spec={spec} />
  </SceneFrame>
);
