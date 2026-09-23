import React from "react";
import { useCurrentFrame } from "remotion";
import { wobble, type Point } from "./wobble.js";

/** Рисованная стрелка «следовательно»: дрожащий стебель и треугольный наконечник. */
export const Arrow: React.FC<{
  from: Point;
  to: Point;
  width: number;
  height: number;
  seed: string;
  stroke: string;
  strokeWidth?: number;
  wobbleAmount?: number;
  style?: React.CSSProperties;
}> = ({ from, to, width, height, seed, stroke, strokeWidth = 6, wobbleAmount = 3, style }) => {
  const frame = useCurrentFrame();
  const shaft = wobble([from, to], `${seed}-shaft`, wobbleAmount, frame);

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = Math.max(16, strokeWidth * 3.5);
  const headAngle = 0.5;
  const head = wobble(
    [
      to,
      {
        x: to.x - headLength * Math.cos(angle - headAngle),
        y: to.y - headLength * Math.sin(angle - headAngle),
      },
      {
        x: to.x - headLength * Math.cos(angle + headAngle),
        y: to.y - headLength * Math.sin(angle + headAngle),
      },
    ],
    `${seed}-head`,
    wobbleAmount,
    frame,
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible", display: "block", ...style }}
    >
      <polyline
        points={shaft.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <polygon points={head.map((p) => `${p.x},${p.y}`).join(" ")} fill={stroke} stroke={stroke} strokeLinejoin="round" />
    </svg>
  );
};
