import React from "react";
import { interpolate } from "remotion";
import { BLOCK_TYPE, SPLIT_TEXT_BLOCKS, type Block, type SceneComposition } from "@shorts/contracts";
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

  const renderBlock = (block: Block, index: number, blockAlign: "left" | "center") => {
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
          alignItems: blockAlign === "left" ? "flex-start" : "center",
          textAlign: blockAlign,
          ...motionStyle(block.motion ?? spec.motion, progress, index % 2 === 0 ? 1 : -1),
        }}
      >
        <BlockView block={block} localFrame={localFrame} remainingFrames={durationInFrames - start} align={blockAlign} />
      </div>
    );
  };

  const column = (items: { block: Block; index: number }[], columnAlign: "left" | "center") => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: columnAlign === "left" ? "flex-start" : "center",
        gap: BLOCK_TYPE.gap,
      }}
    >
      {items.map(({ block, index }) => renderBlock(block, index, columnAlign))}
    </div>
  );

  // split: текст слева, визуал справа — то же разбиение, что у валидатора
  // (splitColumns). Если одна колонка пуста, сцена рисуется обычной стопкой.
  const indexed = spec.blocks.map((block, index) => ({ block, index }));
  const textSide = indexed.filter(({ block }) => SPLIT_TEXT_BLOCKS.has(block.block));
  const visualSide = indexed.filter(({ block }) => !SPLIT_TEXT_BLOCKS.has(block.block));
  if (spec.layout === "split" && textSide.length > 0 && visualSide.length > 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: BLOCK_TYPE.splitGutter,
          width: "100%",
          height: "100%",
          scale: String(drift),
        }}
      >
        {column(textSide, "left")}
        {column(visualSide, "center")}
      </div>
    );
  }

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
      {spec.blocks.map((block, index) => renderBlock(block, index, align))}
    </div>
  );
};

export const Composed: React.FC<{ spec: SceneComposition }> = ({ spec }) => (
  <SceneFrame presentation={spec} gap={0} wide>
    <Body spec={spec} />
  </SceneFrame>
);
