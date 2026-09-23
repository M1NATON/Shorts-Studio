import React from "react";
import { useCurrentFrame } from "remotion";
import { wobble, type Point } from "./wobble.js";

/** Разомкнутая рисованная линия — разделитель, подчёркивание, стебель стрелки. */
export const Line: React.FC<{
  points: readonly Point[];
  width: number;
  height: number;
  seed: string;
  stroke: string;
  strokeWidth?: number;
  wobbleAmount?: number;
  style?: React.CSSProperties;
}> = ({ points, width, height, seed, stroke, strokeWidth = 6, wobbleAmount = 3, style }) => {
  const frame = useCurrentFrame();
  const jittered = wobble(points, seed, wobbleAmount, frame);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible", display: "block", ...style }}
    >
      <polyline
        points={jittered.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
