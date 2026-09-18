import React from "react";
import { interpolate } from "remotion";
import { BLOCK_TYPE, type SceneComposition } from "@shorts/contracts";
import { useMotionProfile, useSceneMotion } from "../motion.js";
import { SceneFrame, useMotionStyle } from "../presentation.js";
import { BlockView } from "../blocks/index.js";

/**
 * Сцена, собранная моделью из блоков.
 *
 * Момент появления блока задан долей сцены (`at`), здесь он превращается в кадр.
 * Блоки, заявленные на один момент, идут каскадом, а не одним куском.
 *
 * Невидимый блок уже занимает своё место: кадр не перестраивается, когда входит
 * следующий, — иначе контент прыгал бы вверх на каждом появлении (та же причина,
 * по которой дёргались старые субтитры).
 */
const Body: React.FC<{ spec: SceneComposition }> = ({ spec }) => {
  const { frame, durationInFrames } = useSceneMotion();
  const { enterFrames, easing, staggerFrames } = useMotionProfile();
  const motionStyle = useMotionStyle();
  const align = spec.layout === "left" ? "left" : "center";

  let previousAt = -1;
  let indexInGroup = 0;
  const starts = spec.blocks.map((block) => {
    indexInGroup = block.at === previousAt ? indexInGroup + 1 : 0;
    previousAt = block.at;
    return Math.round(block.at * durationInFrames) + indexInGroup * staggerFrames * 2;
  });

  // Медленный наезд на всю сцену: после того как блоки вошли, кадр не замирает.
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.035], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "left" ? "flex-start" : "center",
        gap: BLOCK_TYPE.gap,
        width: "100%",
        scale: String(drift),
      }}
    >
      {spec.blocks.map((block, index) => {
        const start = starts[index]!;
        const localFrame = frame - start;
        const progress = interpolate(localFrame, [0, enterFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing,
        });
        return (
          <div
            key={`${index}-${block.block}`}
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: align === "left" ? "flex-start" : "center",
              textAlign: align,
              ...motionStyle(block.motion ?? spec.motion, progress, index % 2 === 0 ? 1 : -1),
            }}
          >
            <BlockView
              block={block}
              localFrame={localFrame}
              remainingFrames={durationInFrames - start}
              align={align}
            />
          </div>
        );
      })}
    </div>
  );
};

export const Composed: React.FC<{ spec: SceneComposition }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={0}>
    <Body spec={spec} />
  </SceneFrame>
);
