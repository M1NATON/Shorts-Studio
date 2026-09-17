import React from "react";
import { assertNever, type SceneVisualSpec } from "@shorts/contracts";
import { Comparison } from "./Comparison.js";
import { HookStatement } from "./HookStatement.js";
import { IconList } from "./IconList.js";
import { OutroCta } from "./OutroCta.js";
import { StatCounter } from "./StatCounter.js";

/**
 * Единственная точка сопоставления типа сцены и компонента.
 * Preview (@remotion/player) и финальный рендер используют именно её — поэтому
 * «preview = экспорт» выполняется по построению, без отдельной трансформации.
 *
 * assertNever в default гарантирует: новый kind в контрактах не соберётся,
 * пока для него не добавлен компонент.
 */
export const SceneVisual: React.FC<{ spec: SceneVisualSpec }> = ({ spec }) => {
  switch (spec.kind) {
    case "hook-statement":
      return <HookStatement spec={spec} />;
    case "stat-counter":
      return <StatCounter spec={spec} />;
    case "icon-list":
      return <IconList spec={spec} />;
    case "comparison":
      return <Comparison spec={spec} />;
    case "outro-cta":
      return <OutroCta spec={spec} />;
    default:
      return assertNever(spec);
  }
};
