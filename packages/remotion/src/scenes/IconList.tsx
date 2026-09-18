import React from "react";

import type { IconListSpec } from "@shorts/contracts";
import { useTheme } from "../theme.js";
import { useSceneMotion, useStagger } from "../motion.js";
import { SceneFrame, useAccent, useMotionStyle } from "../presentation.js";
import { useStyle, useSurface } from "../styles.js";
import { Icon } from "../Icon.js";

/**
 * Список тезисов с иконками — самый универсальный тип сцены (27% сцен в замере).
 *
 * Пункты появляются по одному, каждый со своим сдвигом: сцена наполняется
 * постепенно, синхронно с перечислением в озвучке. Уже показанные пункты притухают,
 * поэтому взгляд держится на текущем, а не размазывается по списку.
 */
const Body: React.FC<{ spec: IconListSpec }> = ({ spec }) => {
  const theme = useTheme();
  const stagger = useStagger();
  const motionStyle = useMotionStyle();
  const { frame, durationInFrames } = useSceneMotion();
  const accent = useAccent();
  const style = useStyle();
  const surface = useSurface();
  const flatIconBox = style.surface === "none" || style.surface === "rule";
  const count = spec.items.length;
  // Раздаём сцену по числу пунктов, оставляя последнюю четверть на «весь список целиком».
  const perItem = (durationInFrames * 0.75) / count;
  const focused = Math.min(count - 1, Math.floor(frame / perItem));
  const fontSize = count >= 4 ? 52 : 60;

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
            textAlign: spec.layout === "left" ? "left" : "center",
            opacity: stagger(frame, 0, 2),
          }}
        >
          {spec.title}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%" }}>
        {spec.items.map((item, index) => {
          const appear = stagger(frame, index + (spec.title ? 1 : 0), 6);
          const isFocused = index === focused;
          return (
            <div
              key={`${index}-${item.text}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 30,
                padding: "22px 30px",
                textAlign: "left",
                ...surface(isFocused, accent),
                ...motionStyle(spec.motion, appear, -1),
                opacity: appear * (isFocused ? 1 : 0.62),
              }}
            >
              <div
                style={{
                  width: 92,
                  height: 92,
                  flexShrink: 0,
                  borderRadius: Math.round(theme.cornerRadius * 0.8),
                  backgroundColor: flatIconBox
                    ? "transparent"
                    : isFocused
                      ? theme.accentSoft
                      : theme.surfaceStrong,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={item.icon} size={52} color={isFocused ? accent : theme.muted} />
              </div>
              <div style={{ fontSize, fontWeight: 700, color: theme.text, lineHeight: 1.15 }}>
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export const IconList: React.FC<{ spec: IconListSpec }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={28}>
    <Body spec={spec} />
  </SceneFrame>
);

