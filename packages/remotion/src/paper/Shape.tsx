import React from "react";
import { useCurrentFrame } from "remotion";
import { wobble, type Point } from "./wobble.js";

/**
 * Замкнутый рисованный контур: заливка плюс чернильная обводка. Дрожание точек
 * применяется на каждый кадр рендера — уже после того, как родитель применил
 * свои transform (translate/scale входа сцены), поэтому «боление» не зависит
 * от анимации появления и не искажается ею.
 */
export const Shape: React.FC<{
  points: readonly Point[];
  width: number;
  height: number;
  seed: string;
  fill: string;
  stroke: string;
  strokeWidth?: number;
  wobbleAmount?: number;
  preserveAspectRatio?: string;
  style?: React.CSSProperties;
}> = ({
  points,
  width,
  height,
  seed,
  fill,
  stroke,
  strokeWidth = 6,
  wobbleAmount = 3,
  preserveAspectRatio,
  style,
}) => {
  const frame = useCurrentFrame();
  const jittered = wobble(points, seed, wobbleAmount, frame);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={preserveAspectRatio}
      style={{ overflow: "visible", display: "block", ...style }}
    >
      <polygon
        points={jittered.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        // Контур должен читаться как постоянные 6px чернил независимо от того,
        // что viewBox растянут неравномерно (preserveAspectRatio="none" у столбцов
        // и плашек): без этого атрибута толщина обводки растягивается вместе с формой.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
