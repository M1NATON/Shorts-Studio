import React from "react";
import { rectPoints } from "./points.js";
import { Shape } from "./Shape.js";

/**
 * Единица viewBox для карточек: реальный размер известен только в разметке
 * (100% родителя), а Shape рисует полигон в фиксированных координатах —
 * тот же приём, что и BAR_UNIT в BarsBlock (см. blocks/DataBlocks.tsx). Квадрат,
 * а не прямоугольник конкретного блока: preserveAspectRatio="none" всё равно
 * растягивает под реальную форму, а амплитуда дрожания в design-пикселях
 * читается одинаково при любых пропорциях родителя.
 */
const UNIT = 600;

/**
 * Бумажная карточка-плашка фоном под произвольным содержимым: дрожащий
 * прямоугольник во всю площадь родителя. Родитель должен быть
 * `position: relative` — то же соглашение, что и в PaperPlaque (StatCounter).
 */
export const PaperCard: React.FC<{
  seed: string;
  fill: string;
  stroke: string;
  strokeWidth?: number;
  wobbleAmount?: number;
  perSide?: number;
  style?: React.CSSProperties;
}> = ({ seed, fill, stroke, strokeWidth = 6, wobbleAmount = 3, perSide = 3, style }) => (
  <Shape
    points={rectPoints(0, 0, UNIT, UNIT, perSide)}
    width={UNIT}
    height={UNIT}
    seed={seed}
    fill={fill}
    stroke={stroke}
    strokeWidth={strokeWidth}
    wobbleAmount={wobbleAmount}
    preserveAspectRatio="none"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", ...style }}
  />
);
