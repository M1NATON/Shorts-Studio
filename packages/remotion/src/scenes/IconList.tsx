import React from "react";
import { interpolate } from "remotion";
import type { IconListSpec } from "@shorts/contracts";
import { CONTENT_INSET, theme } from "../theme.js";
import { stagger, useSceneMotion } from "../motion.js";
import { Icon } from "../Icon.js";

/**
 * Список тезисов с иконками — самый универсальный тип сцены (27% сцен в замере).
 *
 * Пункты выезжают по одному слева, каждый со своим сдвигом: сцена наполняется
 * постепенно, синхронно с тем, как диктор перечисляет. Уже показанные пункты
 * притухают, поэтому взгляд держится на текущем, а не размазывается по списку.
 */
export const IconList: React.FC<{ spec: IconListSpec }> = ({ spec }) => {
  const { frame, visible, durationInFrames } = useSceneMotion();
  const count = spec.items.length;
  // Раздаём сцену по числу пунктов, оставляя последнюю четверть на «весь список целиком».
  const perItem = (durationInFrames * 0.75) / count;
  const focused = Math.min(count - 1, Math.floor(frame / perItem));
  const fontSize = count >= 4 ? 52 : 60;

  return (
    <div
      style={{
        position: "absolute",
        inset: CONTENT_INSET,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 28,
        opacity: visible,
      }}
    >
      {spec.title ? (
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: theme.muted,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            marginBottom: 12,
            opacity: stagger(frame, 0, 2),
          }}
        >
          {spec.title}
        </div>
      ) : null}

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
              borderRadius: 28,
              backgroundColor: isFocused ? theme.surface2 : theme.surface,
              border: `2px solid ${isFocused ? theme.accent : theme.border}`,
              opacity: appear * (isFocused ? 1 : 0.62),
              translate: `${(1 - appear) * -70}px 0px`,
              scale: interpolate(isFocused ? 1 : 0, [0, 1], [1, 1.02], { output: "perceptual-scale" }),
            }}
          >
            <div
              style={{
                width: 92,
                height: 92,
                flexShrink: 0,
                borderRadius: 22,
                backgroundColor: isFocused ? theme.accentSoft : theme.surface3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={item.icon} size={52} color={isFocused ? theme.accent : theme.muted} />
            </div>
            <div style={{ fontSize, fontWeight: 700, color: theme.text, lineHeight: 1.15 }}>
              {item.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};
