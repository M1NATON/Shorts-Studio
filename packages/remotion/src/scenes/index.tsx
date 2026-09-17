import React from "react";
import { assertNever, type SceneVisualSpec } from "@shorts/contracts";
import { StatCounter } from "./StatCounter.js";
import { Placeholder } from "./Placeholder.js";

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
    case "stat-counter":
      return <StatCounter spec={spec} />;
    // TODO(Фаза 2A): полноценные компоненты. Placeholder показывает реальный контент
    // сцены, а не серый прямоугольник, чтобы пайплайн можно было проверять целиком.
    case "hook-statement":
      return <Placeholder kind={spec.kind} title={spec.text} />;
    case "icon-list":
      return <Placeholder kind={spec.kind} title={spec.title ?? ""} lines={spec.items.map((i) => i.text)} />;
    case "comparison":
      return (
        <Placeholder
          kind={spec.kind}
          title={spec.title ?? ""}
          lines={spec.items.map((i) => `${i.label}: ${i.value}`)}
        />
      );
    case "outro-cta":
      return <Placeholder kind={spec.kind} title={spec.text} lines={spec.subtext ? [spec.subtext] : []} />;
    default:
      return assertNever(spec);
  }
};
