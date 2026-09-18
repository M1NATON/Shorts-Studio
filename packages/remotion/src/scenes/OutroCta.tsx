import React from "react";
import { interpolate } from "remotion";
import { estimateLines, type OutroCtaSpec } from "@shorts/contracts";
import { useFormat, useTheme, useThemeFont } from "../theme.js";
import { useSceneMotion } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";
import { textZoom, useStyle } from "../styles.js";

/**
 * Финальная сцена.
 *
 * Здесь важна не очередная анимация, а остановка: текст приезжает один раз и
 * фиксируется, под ним прочерчивается акцентная линия. Выход не затемняем —
 * последний кадр должен остаться читаемым на превью.
 */
const outroFontSize = (text: string): number => (text.length <= 40 ? 96 : 76);

const Body: React.FC<{ spec: OutroCtaSpec }> = ({ spec }) => {
  const theme = useTheme();
  const font = useThemeFont();
  const motionStyle = useMotionStyle();
  const { frame } = useSceneMotion();
  const accent = useAccent();
  const appear = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });

  return (
    <>
      <div
        style={{
          fontSize: outroFontSize(spec.text),
          fontWeight: font.headingWeight,
          color: theme.text,
          lineHeight: 1.1,
          letterSpacing: `${theme.letterSpacing}em`,
          ...motionStyle(spec.motion, appear),
        }}
      >
        {spec.text}
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 999,
          backgroundColor: accent,
          alignSelf: spec.layout === "left" ? "flex-start" : "center",
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
            maxWidth: 780,
            alignSelf: spec.layout === "left" ? "flex-start" : "center",
            opacity: interpolate(frame, [18, 34], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {spec.subtext}
        </div>
      ) : null}
    </>
  );
};

export const OutroCta: React.FC<{ spec: OutroCtaSpec }> = ({ spec }) => {
  const format = useFormat();
  const style = useStyle();
  // extra: линия 8px, подпись 44px в maxWidth 780 и промежутки gap={34}.
  const extra = 8 + 34 + (spec.subtext ? estimateLines(spec.subtext, 44, 780) * 44 * 1.3 + 34 : 0);
  const zoom = textZoom([spec.text], outroFontSize(spec.text), format.name, style.maxZoom, extra);
  return (
    <SceneFrame presentation={spec} gap={34} zoom={zoom}>
      <Body spec={spec} />
    </SceneFrame>
  );
};
